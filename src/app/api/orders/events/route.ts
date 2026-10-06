import { requireTenant } from "@/lib/auth/context";
import { subscribeOrderEvents, type OrderEvent } from "@/lib/order-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const ctx = await requireTenant("orders.view");
  const encoder = new TextEncoder();
  let dispose = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let lifetime: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (value: string) => {
        if (!closed) controller.enqueue(encoder.encode(value));
      };
      send("retry: 1000\nevent: ready\ndata: {}\n\n");
      dispose = subscribeOrderEvents((event: OrderEvent) => {
        if (event.tenantId !== ctx.tenantId) return;
        send(`event: order\ndata: ${JSON.stringify(event)}\n\n`);
      });
      heartbeat = setInterval(() => send(": keepalive\n\n"), 15000);
      lifetime = setTimeout(() => {
        closed = true;
        dispose();
        if (heartbeat) clearInterval(heartbeat);
        controller.close();
      }, 50000);
    },
    cancel() {
      closed = true;
      dispose();
      if (heartbeat) clearInterval(heartbeat);
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
