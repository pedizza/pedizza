import { requireTenant } from "@/lib/auth/context";
import { transaction, one, rows } from "@/lib/db";
import { subscribeOrderEvents, type OrderEvent } from "@/lib/order-events";
import { orderColumns, type Order } from "@/lib/services/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const ctx = await requireTenant("orders.view");
  const observed = await transaction((db) =>
    one<{ observed_at: string }>(
      db,
      `select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') observed_at`,
    ),
  );
  const encoder = new TextEncoder();
  let dispose = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let poller: ReturnType<typeof setInterval> | undefined;
  let lifetime: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let polling = false;
  let cursor = observed?.observed_at || new Date().toISOString();
  const sentVersions = new Map<string, string>();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (value: string) => {
        if (!closed) controller.enqueue(encoder.encode(value));
      };
      const sendOrder = (event: OrderEvent) => {
        const version = event.order
          ? new Date(event.order.updated_at).toISOString()
          : event.kind;
        if (sentVersions.get(event.orderId) === version) return;
        sentVersions.set(event.orderId, version);
        if (sentVersions.size > 500) sentVersions.clear();
        send(`event: order\ndata: ${JSON.stringify(event)}\n\n`);
      };
      send("retry: 1000\nevent: ready\ndata: {}\n\n");
      dispose = subscribeOrderEvents((event: OrderEvent) => {
        if (event.tenantId === ctx.tenantId) sendOrder(event);
      });
      heartbeat = setInterval(() => send(": keepalive\n\n"), 15000);
      poller = setInterval(() => {
        if (polling || closed) return;
        polling = true;
        void transaction((db) =>
          rows<Order>(
            db,
            `select ${orderColumns} from public.orders where tenant_id=$1 and updated_at>$2::timestamptz order by updated_at,id limit 100`,
            [ctx.tenantId, cursor],
          ),
        )
          .then((changed) => {
            for (const order of changed) {
              const updatedAt = new Date(order.updated_at).toISOString();
              if (updatedAt > cursor) cursor = updatedAt;
              sendOrder({
                tenantId: ctx.tenantId,
                orderId: order.id,
                kind:
                  Math.abs(
                    new Date(order.updated_at).getTime() -
                      new Date(order.created_at).getTime(),
                  ) < 1000
                    ? "insert"
                    : "update",
                order,
              });
            }
          })
          .catch(() => {})
          .finally(() => {
            polling = false;
          });
      }, 1000);
      lifetime = setTimeout(() => {
        closed = true;
        dispose();
        if (heartbeat) clearInterval(heartbeat);
        if (poller) clearInterval(poller);
        controller.close();
      }, 50000);
    },
    cancel() {
      closed = true;
      dispose();
      if (heartbeat) clearInterval(heartbeat);
      if (poller) clearInterval(poller);
      if (lifetime) clearTimeout(lifetime);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
