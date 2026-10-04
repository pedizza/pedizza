import { z } from "zod";
import { requireTenant, authorize } from "@/lib/auth/context";
import { transaction, rows, one } from "@/lib/db";
import {
  apiError,
  json,
  readJson,
  verifyOrigin,
  rateLimit,
} from "@/lib/security/http";
const preferences = z
  .object({
    sound_enabled: z.boolean(),
    push_enabled: z.boolean(),
    orders_enabled: z.boolean(),
    messages_enabled: z.boolean(),
    whatsapp_enabled: z.boolean(),
  })
  .strict();
const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read"), id: z.uuid().optional() }),
  z.object({ action: z.literal("preferences"), preferences }),
  z.object({
    action: z.literal("subscribe"),
    subscription: z.object({
      endpoint: z
        .url()
        .max(2048)
        .refine((value) => {
          const u = new URL(value);
          return (
            u.protocol === "https:" &&
            !u.username &&
            !u.password &&
            (!u.port || u.port === "443") &&
            [
              "fcm.googleapis.com",
              "updates.push.services.mozilla.com",
              "web.push.apple.com",
            ].some((h) => u.hostname === h || u.hostname.endsWith("." + h))
          );
        }, "Serviço de push não suportado."),
      keys: z.object({
        p256dh: z
          .string()
          .regex(/^[A-Za-z0-9_-]+={0,2}$/)
          .min(80)
          .max(128),
        auth: z
          .string()
          .regex(/^[A-Za-z0-9_-]+={0,2}$/)
          .min(20)
          .max(32),
      }),
    }),
  }),
  z.object({
    action: z.literal("unsubscribe"),
    endpoint: z.string().max(2048),
  }),
]);
export async function GET(request: Request) {
  try {
    const ctx = await requireTenant("notifications.view");
    const url = new URL(request.url);
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(url.searchParams.get("page") || 1);
    return json(
      await transaction(async (db) => {
        const condition =
          "tenant_id=$1 and user_id=$2 and (expires_at is null or expires_at>now())";
        const count = await one(
          db,
          `select count(*)::int total,count(*) filter(where read_at is null)::int unread from public.notifications where ${condition}`,
          [ctx.tenantId, ctx.userId],
        );
        return {
          ...count,
          data: await rows(
            db,
            `select id,type,title,body,action_url,read_at,created_at from public.notifications where ${condition} order by created_at desc,id limit 20 offset $3`,
            [ctx.tenantId, ctx.userId, (page - 1) * 20],
          ),
          preferences: await one(
            db,
            "select sound_enabled,push_enabled,orders_enabled,messages_enabled,whatsapp_enabled from public.notification_preferences where tenant_id=$1 and user_id=$2",
            [ctx.tenantId, ctx.userId],
          ),
          pushConfigured: !!(
            process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
            process.env.VAPID_PRIVATE_KEY &&
            process.env.VAPID_SUBJECT
          ),
        };
      }, ctx.userId),
    );
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(request: Request) {
  try {
    verifyOrigin(request);
    const ctx = await requireTenant("notifications.view");
    await rateLimit(ctx.userId + ":notifications", 60);
    const data = action.parse(await readJson(request));
    await transaction(async (db) => {
      await authorize(db, ctx, "notifications.view");
      if (data.action === "read") {
        await db.query(
          "update public.notifications set read_at=coalesce(read_at,now()) where tenant_id=$1 and user_id=$2 and ($3::uuid is null or id=$3) and private.has_permission(tenant_id,required_permission)",
          [ctx.tenantId, ctx.userId, data.id || null],
        );
      } else if (data.action === "preferences") {
        const p = data.preferences;
        await db.query(
          "insert into public.notification_preferences(tenant_id,user_id,sound_enabled,push_enabled,orders_enabled,messages_enabled,whatsapp_enabled) values($1,$2,$3,$4,$5,$6,$7) on conflict(tenant_id,user_id) do update set sound_enabled=$3,push_enabled=$4,orders_enabled=$5,messages_enabled=$6,whatsapp_enabled=$7",
          [
            ctx.tenantId,
            ctx.userId,
            p.sound_enabled,
            p.push_enabled,
            p.orders_enabled,
            p.messages_enabled,
            p.whatsapp_enabled,
          ],
        );
      } else if (data.action === "subscribe") {
        await db.query(
          "insert into private.push_subscriptions(tenant_id,user_id,endpoint,p256dh,auth) values($1,$2,$3,$4,$5) on conflict(tenant_id,user_id,endpoint) do update set p256dh=$4,auth=$5",
          [
            ctx.tenantId,
            ctx.userId,
            data.subscription.endpoint,
            data.subscription.keys.p256dh,
            data.subscription.keys.auth,
          ],
        );
        await db.query(
          "insert into public.notification_preferences(tenant_id,user_id,push_enabled) values($1,$2,true) on conflict(tenant_id,user_id) do update set push_enabled=true",
          [ctx.tenantId, ctx.userId],
        );
      } else {
        await db.query(
          "delete from private.push_subscriptions where tenant_id=$1 and user_id=$2 and endpoint=$3",
          [ctx.tenantId, ctx.userId, data.endpoint],
        );
      }
    });
    return json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
