import { z } from "zod";
import { createHash } from "node:crypto";
import { safeEqual } from "@/lib/security/crypto";
import { apiError, json, readJson } from "@/lib/security/http";
import { AppError } from "@/lib/errors";
import { acceptWebhook } from "@/lib/services/webhook";
import { transaction, one } from "@/lib/db";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const secret = process.env.EVOLUTION_WEBHOOK_SECRET;
    if (
      !secret ||
      !safeEqual(request.headers.get("x-webhook-secret") || "", secret)
    )
      throw new AppError(401, "Webhook inválido.");
    const payload = z
      .object({
        event: z.string().max(60),
        instance: z.string().regex(/^pedizza_[a-f0-9_]+$/),
        data: z.unknown(),
      })
      .parse(await readJson(request, 1048576));
    const instance = await transaction((db) =>
      one<{ tenant_id: string }>(
        db,
        "select tenant_id from public.whatsapp_instances where instance_name=$1 and archived_at is null",
        [payload.instance],
      ),
    );
    if (!instance) return json({ received: true });
    const event = payload.event.toLowerCase().replaceAll("_", ".");
    if (
      !["messages.upsert", "messages.update", "connection.update"].includes(
        event,
      )
    )
      return json({ received: true });
    let data: unknown;
    if (event === "messages.upsert")
      data = z
        .object({
          key: z.object({
            id: z.string().max(200),
            remoteJid: z.string().max(100),
            fromMe: z.boolean().optional(),
          }),
          pushName: z.string().max(120).optional(),
          message: z.record(z.string(), z.unknown()),
          messageType: z.string().optional(),
        })
        .parse(payload.data);
    else data = payload.data;
    const safe = { event, instance: payload.instance, data };
    const key = createHash("sha256").update(JSON.stringify(safe)).digest("hex");
    return json(
      await acceptWebhook("evolution", key, safe, instance.tenant_id),
    );
  } catch (e) {
    return apiError(e);
  }
}
