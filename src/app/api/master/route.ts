import { z } from "zod";
import { requireMaster } from "@/lib/auth/context";
import { transaction, rows, one } from "@/lib/db";
import {
  apiError,
  json,
  verifyOrigin,
  readJson,
  rateLimit,
} from "@/lib/security/http";
import { audit } from "@/lib/audit";
import { invariant } from "@/lib/errors";
export async function GET(request: Request) {
  try {
    const user = await requireMaster();
    const u = new URL(request.url),
      page = z.coerce
        .number()
        .int()
        .min(1)
        .max(10000)
        .parse(u.searchParams.get("page") || 1);
    const search = (u.searchParams.get("q") || "").slice(0, 100),
      support = u.searchParams.get("support");
    return json(
      await transaction(async (db) => {
        await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
          user.id,
        ]);
        invariant(
          (
            await one<{ allowed: boolean }>(
              db,
              "select public.is_super_admin() allowed",
            )
          )?.allowed,
          "Acesso revogado.",
          403,
        );
        if (support) {
          z.uuid().parse(support);
          const session = await one<{ tenant_id: string }>(
            db,
            "select tenant_id from private.support_sessions where id=$1 and user_id=$2 and ended_at is null and expires_at>now()",
            [support, user.id],
          );
          invariant(session, "Sessão de suporte expirada.", 403);
          await audit(
            db,
            session.tenant_id,
            user.id,
            "master.support_read",
            "support_sessions",
            support,
          );
          return {
            support: {
              id: support,
              tenantId: session.tenant_id,
              orders: await rows(
                db,
                "select id,order_number,order_status,payment_status,total_cents,created_at from public.orders where tenant_id=$1 order by created_at desc limit 20",
                [session.tenant_id],
              ),
              whatsapp: await one(
                db,
                "select status,last_status_check_at from public.whatsapp_instances where tenant_id=$1 and archived_at is null",
                [session.tenant_id],
              ),
            },
          };
        }
        return {
          overview: await one(
            db,
            "select (select count(*)::int from public.tenants) tenants,(select count(*)::int from public.subscriptions where status='active' and (lifetime_access or current_period_end>now())) active,(select coalesce(sum(amount_cents),0)::bigint from private.billing_charges where status='paid' and credited_at>=date_trunc('month',now())) paid_month_cents,(select count(*)::int from private.webhook_events where status='failed') failed_webhooks,(select count(*)::int from private.outbox where status='failed') failed_jobs",
          ),
          tenants: await rows(
            db,
            "select t.id,t.name,t.manually_suspended,t.suspension_reason,t.created_at,s.status,s.current_period_end from public.tenants t left join public.subscriptions s on s.tenant_id=t.id where t.name ilike $1 order by t.created_at desc,t.id limit 20 offset $2",
            ["%" + search + "%", (page - 1) * 20],
          ),
          ...(await one(
            db,
            "select count(*)::int total from public.tenants where name ilike $1",
            ["%" + search + "%"],
          )),
          audit: await rows(
            db,
            "select id,tenant_id,user_id,action,resource_type,created_at from public.audit_logs where action like 'master.%' order by created_at desc limit 30",
          ),
        };
      }),
    );
  } catch (e) {
    return apiError(e);
  }
}
const action = z.discriminatedUnion("action", [
  z.object({
    action: z.enum(["suspend", "reactivate", "support"]),
    tenantId: z.uuid(),
    reason: z.string().trim().min(10).max(500),
  }),
  z.object({ action: z.literal("end_support"), id: z.uuid() }),
  z.object({
    action: z.literal("block_user"),
    userId: z.uuid(),
    blocked: z.boolean(),
    reason: z.string().trim().min(10).max(500),
  }),
]);
export async function POST(request: Request) {
  try {
    verifyOrigin(request);
    const user = await requireMaster();
    await rateLimit(user.id + ":master", 20, 60);
    const d = action.parse(await readJson(request));
    return json(
      await transaction(async (db) => {
        await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
          user.id,
        ]);
        invariant(
          (
            await one<{ allowed: boolean }>(
              db,
              "select public.is_super_admin() allowed",
            )
          )?.allowed,
          "Acesso revogado.",
          403,
        );
        if (d.action === "end_support") {
          await db.query(
            "update private.support_sessions set ended_at=now() where id=$1 and user_id=$2",
            [d.id, user.id],
          );
          await audit(
            db,
            null,
            user.id,
            "master.support_ended",
            "support_sessions",
            d.id,
          );
          return { ok: true };
        }
        if (d.action === "block_user") {
          invariant(
            d.userId !== user.id,
            "Você não pode bloquear sua própria conta.",
          );
          invariant(
            !(await one(
              db,
              "select user_id from private.super_admins where user_id=$1",
              [d.userId],
            )),
            "Contas administrativas são gerenciadas pelo operador do banco.",
            403,
          );
          await db.query("update public.profiles set blocked=$2 where id=$1", [
            d.userId,
            d.blocked,
          ]);
          await audit(
            db,
            null,
            user.id,
            "master.user_block",
            "profiles",
            d.userId,
            { reason: d.reason, blocked: d.blocked },
          );
          return { ok: true };
        }
        invariant(
          await one(
            db,
            "select id from public.tenants where id=$1 for update",
            [d.tenantId],
          ),
          "Loja não encontrada.",
          404,
        );
        if (d.action === "support") {
          const session = await one<{ id: string }>(
            db,
            "insert into private.support_sessions(user_id,tenant_id,reason,expires_at) values($1,$2,$3,now()+interval '15 minutes') returning id",
            [user.id, d.tenantId, d.reason],
          );
          await audit(
            db,
            d.tenantId,
            user.id,
            "master.support_started",
            "support_sessions",
            session!.id,
            { reason: d.reason },
          );
          return { supportId: session!.id };
        }
        await db.query(
          "update public.tenants set manually_suspended=$2,suspension_reason=$3,updated_at=now() where id=$1",
          [
            d.tenantId,
            d.action === "suspend",
            d.action === "suspend" ? d.reason : null,
          ],
        );
        await audit(
          db,
          d.tenantId,
          user.id,
          "master." + d.action,
          "tenants",
          d.tenantId,
          { reason: d.reason },
        );
        return { ok: true };
      }),
    );
  } catch (e) {
    return apiError(e);
  }
}
