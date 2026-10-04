import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { requireTenant, authorize } from "@/lib/auth/context";
import { transaction, one } from "@/lib/db";
import {
  apiError,
  json,
  verifyOrigin,
  readJson,
  rateLimit,
} from "@/lib/security/http";
import { appUrl, requiredEnv } from "@/lib/env";
import { audit } from "@/lib/audit";
export async function GET() {
  try {
    const ctx = await requireTenant("payments.view");
    const record = await transaction((db) =>
      one(
        db,
        "select updated_at from private.integration_credentials where tenant_id=$1 and provider='mercado_pago'",
        [ctx.tenantId],
      ),
    );
    return json({
      connected: !!record,
      configured: !!(
        process.env.MERCADO_PAGO_CLIENT_ID &&
        process.env.MERCADO_PAGO_CLIENT_SECRET &&
        process.env.INTEGRATION_ENCRYPTION_KEY &&
        process.env.MERCADO_PAGO_WEBHOOK_SECRET
      ),
    });
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(request: Request) {
  try {
    verifyOrigin(request);
    const ctx = await requireTenant("payments.manage");
    await rateLimit(ctx.userId + ":mp-oauth", 5, 300);
    const { action } = z
      .object({ action: z.enum(["connect", "disconnect"]) })
      .parse(await readJson(request));
    if (action === "disconnect") {
      await transaction(async (db) => {
        await authorize(db, ctx, "payments.manage");
        await db.query(
          "delete from private.integration_credentials where tenant_id=$1 and provider='mercado_pago'",
          [ctx.tenantId],
        );
        await db.query(
          "update public.payment_methods set active=false where tenant_id=$1 and type='pix_mercado_pago'",
          [ctx.tenantId],
        );
        await db.query(
          "update private.oauth_states set used_at=now() where tenant_id=$1 and used_at is null",
          [ctx.tenantId],
        );
        await audit(
          db,
          ctx.tenantId,
          ctx.userId,
          "mercado_pago.disconnected",
          "integration_credentials",
          null,
        );
      });
      return json({ ok: true });
    }
    const state = randomBytes(32).toString("hex");
    const url = new URL("https://auth.mercadopago.com.br/authorization");
    url.searchParams.set("client_id", requiredEnv("MERCADO_PAGO_CLIENT_ID"));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("platform_id", "mp");
    url.searchParams.set(
      "redirect_uri",
      appUrl() + "/api/integrations/mercado-pago/callback",
    );
    url.searchParams.set("state", state);
    await transaction(async (db) => {
      await authorize(db, ctx, "payments.manage");
      await db.query(
        "insert into private.oauth_states(tenant_id,user_id,state_hash) values($1,$2,$3)",
        [
          ctx.tenantId,
          ctx.userId,
          createHash("sha256").update(state).digest("hex"),
        ],
      );
    });
    return json({ url: url.toString() });
  } catch (e) {
    return apiError(e);
  }
}
