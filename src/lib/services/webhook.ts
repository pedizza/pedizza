import "server-only";
import { transaction } from "@/lib/db";
import { after } from "next/server";
import { processWebhooks } from "./worker";
export async function acceptWebhook(
  provider: string,
  key: string,
  payload: unknown,
  tenantId: string | null = null,
) {
  await transaction((db) =>
    db.query(
      "insert into private.webhook_events(provider,event_key,payload,tenant_id) values($1,$2,$3,$4) on conflict(provider,event_key) do nothing",
      [provider, key, JSON.stringify(payload), tenantId],
    ),
  );
  after(() => processWebhooks(5));
  return { received: true };
}
