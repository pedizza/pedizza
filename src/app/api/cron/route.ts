import { safeEqual } from "@/lib/security/crypto";
import { apiError, json } from "@/lib/security/http";
import { AppError } from "@/lib/errors";
import { processWebhooks, processOutbox } from "@/lib/services/worker";
import { transaction, rows } from "@/lib/db";
import { notify } from "@/lib/services/events";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    if (
      !process.env.CRON_SECRET ||
      !safeEqual(
        request.headers.get("authorization") || "",
        "Bearer " + process.env.CRON_SECRET,
      )
    )
      throw new AppError(401, "Acesso negado.");
    await transaction(async (db) => {
      await db.query(
        "update public.subscriptions set status='past_due',updated_at=now() where status='active' and not lifetime_access and current_period_end<=now()",
      );
      await db.query(
        "update public.carts set status='expired' where status='active' and expires_at<now()",
      );
      await db.query("delete from private.rate_limits where expires_at<now()");
      await db.query("delete from private.geo_cache where expires_at<now()");
      await db.query(
        "delete from private.webhook_events where status='done' and created_at<now()-interval '7 days'",
      );
      await db.query(
        "delete from private.outbox where status='done' and created_at<now()-interval '7 days'",
      );
      const late = await rows<{
        id: string;
        tenant_id: string;
        order_number: number;
      }>(
        db,
        "select id,tenant_id,order_number from public.orders where order_status='new' and created_at<now()-interval '10 minutes' order by created_at limit 100",
      );
      for (const o of late)
        await notify(
          db,
          o.tenant_id,
          "order-late:" + o.id,
          "order.late",
          "Pedido aguardando aceite",
          `Pedido #${o.order_number} aguarda sua equipe.`,
          "/app/pedidos",
          "orders.view",
          o.id,
        );
    });
    await processWebhooks(6);
    await processOutbox(6);
    return json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
