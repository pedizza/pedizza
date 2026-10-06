import "server-only";

import pg from "pg";
import { readFileSync } from "node:fs";
import path from "node:path";
import { requiredEnv } from "@/lib/env";
import { orderColumns, type Order } from "@/lib/services/orders";

export type OrderEvent = {
  tenantId: string;
  orderId: string;
  kind: "insert" | "update" | "delete";
  order: Order | null;
};

type Listener = (event: OrderEvent) => void;

const listeners = new Set<Listener>();
let client: pg.Client | null = null;
let connecting: Promise<void> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleReconnect() {
  if (reconnectTimer || !listeners.size) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, 1000);
}

async function connect() {
  if (client || connecting) return connecting;
  connecting = (async () => {
    const next = new pg.Client({
      connectionString: requiredEnv("DIRECT_URL"),
      ssl: {
        rejectUnauthorized: true,
        ca:
          process.env.SUPABASE_DB_CA?.replace(/\\n/g, "\n") ||
          readFileSync(
            path.join(process.cwd(), "config/supabase-ca.crt"),
            "utf8",
          ),
      },
    });
    next.on("notification", (message) => {
      if (message.channel !== "pedizza_orders" || !message.payload) return;
      void forward(next, message.payload);
    });
    next.on("error", () => {
      if (client === next) client = null;
      scheduleReconnect();
    });
    next.on("end", () => {
      if (client === next) client = null;
      scheduleReconnect();
    });
    try {
      await next.connect();
      await next.query("listen pedizza_orders");
      client = next;
    } catch {
      await next.end().catch(() => {});
      scheduleReconnect();
    }
  })().finally(() => {
    connecting = null;
  });
  return connecting;
}

async function forward(connection: pg.Client, payload: string) {
  try {
    const metadata = JSON.parse(payload) as Omit<OrderEvent, "order">;
    if (
      !metadata.tenantId ||
      !metadata.orderId ||
      !["insert", "update", "delete"].includes(metadata.kind)
    )
      return;
    const order =
      metadata.kind === "delete"
        ? null
        : (
            await connection.query<Order>(
              `select ${orderColumns} from public.orders where tenant_id=$1 and id=$2`,
              [metadata.tenantId, metadata.orderId],
            )
          ).rows[0] || null;
    const event: OrderEvent = { ...metadata, order };
    for (const listener of listeners) listener(event);
  } catch {
    // A malformed notification must not interrupt future order events.
  }
}

export function subscribeOrderEvents(listener: Listener) {
  listeners.add(listener);
  void connect();
  return () => listeners.delete(listener);
}
