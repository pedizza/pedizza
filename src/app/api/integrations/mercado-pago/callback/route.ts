import { createHash } from "node:crypto";
import { z } from "zod";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/context";
import { transaction, one } from "@/lib/db";
import { externalJson } from "@/lib/integrations/http";
import { encrypt } from "@/lib/security/crypto";
import { appUrl, requiredEnv } from "@/lib/env";
import { invariant } from "@/lib/errors";
import { audit } from "@/lib/audit";
export async function GET(request: Request) {
  const dest = new URL("/app/configuracoes/pagamentos", appUrl());
  try {
    const user = await getCurrentUser();
    invariant(user, "Entre novamente na sua conta.", 401);
    const u = new URL(request.url),
      code = z.string().min(1).max(2048).parse(u.searchParams.get("code")),
      state = z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(u.searchParams.get("state"));
    const record = await transaction(async (db) => {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
        user.id,
      ]);
      return one<{ tenant_id: string }>(
        db,
        "update private.oauth_states set used_at=now() where state_hash=$1 and user_id=$2 and used_at is null and expires_at>now() and private.has_permission(tenant_id,'payments.manage') and private.subscription_active(tenant_id) returning tenant_id",
        [createHash("sha256").update(state).digest("hex"), user.id],
      );
    });
    invariant(record, "Autorização expirada.", 403);
    const token = z
      .object({
        access_token: z.string(),
        refresh_token: z.string(),
        expires_in: z.number(),
      })
      .parse(
        await externalJson(new URL("https://api.mercadopago.com/oauth/token"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: requiredEnv("MERCADO_PAGO_CLIENT_ID"),
            client_secret: requiredEnv("MERCADO_PAGO_CLIENT_SECRET"),
            grant_type: "authorization_code",
            code,
            redirect_uri: appUrl() + "/api/integrations/mercado-pago/callback",
          }),
        }),
      );
    await transaction(async (db) => {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
        user.id,
      ]);
      const access = await one<{ allowed: boolean }>(
        db,
        "select private.has_permission($1,'payments.manage') allowed",
        [record.tenant_id],
      );
      invariant(access?.allowed, "Acesso revogado.", 403);
      await db.query(
        "insert into private.integration_credentials(tenant_id,provider,encrypted_secret) values($1,'mercado_pago',$2) on conflict(tenant_id,provider) do update set encrypted_secret=excluded.encrypted_secret,updated_at=now()",
        [
          record.tenant_id,
          encrypt(
            JSON.stringify({
              access_token: token.access_token,
              refresh_token: token.refresh_token,
              expires_at: Date.now() + token.expires_in * 1000,
            }),
          ),
        ],
      );
      await audit(
        db,
        record.tenant_id,
        user.id,
        "mercado_pago.connected",
        "integration_credentials",
        null,
      );
    });
    dest.searchParams.set("result", "connected");
  } catch {
    dest.searchParams.set("result", "failed");
  }
  return NextResponse.redirect(dest);
}
