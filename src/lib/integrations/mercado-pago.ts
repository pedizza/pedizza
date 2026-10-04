import "server-only";
import { z } from "zod";
import { createHmac } from "node:crypto";
import { transaction, one } from "@/lib/db";
import { decrypt, encrypt, safeEqual } from "@/lib/security/crypto";
import { requiredEnv, appUrl } from "@/lib/env";
import { externalJson } from "./http";
import { invariant } from "@/lib/errors";
import { enqueue, notify } from "@/lib/services/events";
const credential = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_at: z.number().optional(),
});
export async function mpToken(tenant: string) {
  const record = await transaction((db) =>
    one<{ encrypted_secret: string }>(
      db,
      "select encrypted_secret from private.integration_credentials where tenant_id=$1 and provider='mercado_pago'",
      [tenant],
    ),
  );
  invariant(record, "Mercado Pago não conectado.", 503);
  let saved = credential.parse(JSON.parse(decrypt(record.encrypted_secret)));
  if (
    saved.expires_at &&
    saved.expires_at < Date.now() + 60000 &&
    saved.refresh_token
  ) {
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
            grant_type: "refresh_token",
            refresh_token: saved.refresh_token,
          }),
        }),
      );
    saved = {
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: Date.now() + token.expires_in * 1000,
    };
    await transaction((db) =>
      db.query(
        "update private.integration_credentials set encrypted_secret=$2 where tenant_id=$1 and provider='mercado_pago' and encrypted_secret=$3",
        [tenant, encrypt(JSON.stringify(saved)), record.encrypted_secret],
      ),
    );
  }
  return saved.access_token;
}
const paymentSchema = z.object({
  id: z.union([z.number(), z.string()]),
  status: z.string(),
  transaction_amount: z.number(),
  external_reference: z.string().nullable().optional(),
  date_last_updated: z.string().optional(),
  date_of_expiration: z.string().nullable().optional(),
  point_of_interaction: z
    .object({
      transaction_data: z.object({ qr_code: z.string().optional() }).optional(),
    })
    .optional(),
});
export async function createOrderPix(tenant: string, orderId: string) {
  const order = await transaction((db) =>
    one<{
      total_cents: number;
      email: string;
      conversation_id: string | null;
      provider_payment_id: string | null;
    }>(
      db,
      "select o.total_cents,c.email,o.conversation_id,p.provider_payment_id from public.orders o join public.customers c on c.id=o.customer_id and c.tenant_id=o.tenant_id join public.payments p on p.order_id=o.id and p.tenant_id=o.tenant_id where o.tenant_id=$1 and o.id=$2",
      [tenant, orderId],
    ),
  );
  invariant(order, "Pedido não encontrado.");
  if (order.provider_payment_id) {
    await reconcileMpPayment(order.provider_payment_id);
    return;
  }
  invariant(
    z.email().safeParse(order.email).success,
    "É necessário informar o e-mail do cliente para o PIX.",
  );
  const token = await mpToken(tenant);
  const result = paymentSchema.parse(
    await externalJson(new URL("https://api.mercadopago.com/v1/payments"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": orderId,
      },
      body: JSON.stringify({
        transaction_amount: order.total_cents / 100,
        payment_method_id: "pix",
        payer: { email: order.email },
        external_reference: orderId,
        description: "Pedido da pizzaria",
        notification_url: appUrl() + "/api/webhooks/mercado-pago",
      }),
    }),
  );
  invariant(
    Math.round(result.transaction_amount * 100) === order.total_cents &&
      result.external_reference === orderId,
    "Retorno de pagamento inválido.",
  );
  await transaction(async (db) => {
    await db.query(
      "update public.payments set provider_payment_id=$3,pix_copy_paste=$4,expires_at=$5 where tenant_id=$1 and order_id=$2",
      [
        tenant,
        orderId,
        String(result.id),
        result.point_of_interaction?.transaction_data?.qr_code || null,
        result.date_of_expiration || null,
      ],
    );
    if (
      order.conversation_id &&
      result.point_of_interaction?.transaction_data?.qr_code
    )
      await enqueue(db, tenant, "message", "pix:" + orderId, {
        conversationId: order.conversation_id,
        sender: "system",
        text:
          "PIX copia e cola:\n" +
          result.point_of_interaction.transaction_data.qr_code +
          "\nA confirmação será automática após o pagamento.",
      });
  });
  await reconcileMpPayment(String(result.id));
}
export function verifyMpSignature(
  id: string,
  requestId: string,
  header: string,
  secret: string,
  now = Date.now(),
) {
  const pairs = Object.fromEntries(
    header.split(",").map((s) => s.trim().split("=")),
  );
  const timestamp = Number(pairs.ts);
  if (
    !timestamp ||
    !pairs.v1 ||
    Math.abs(now - (timestamp > 1e12 ? timestamp : timestamp * 1000)) > 300000
  )
    return false;
  const manifest = `id:${id.toLowerCase()};request-id:${requestId};ts:${pairs.ts};`;
  return safeEqual(
    createHmac("sha256", secret).update(manifest).digest("hex"),
    pairs.v1,
  );
}
export async function reconcileMpPayment(providerId: string) {
  const record = await transaction((db) =>
    one<{ tenant_id: string; order_id: string; amount_cents: number }>(
      db,
      "select tenant_id,order_id,amount_cents from public.payments where provider_payment_id=$1",
      [providerId],
    ),
  );
  if (!record) return;
  const token = await mpToken(record.tenant_id);
  const result = paymentSchema.parse(
    await externalJson(
      new URL(
        "https://api.mercadopago.com/v1/payments/" +
          encodeURIComponent(providerId),
      ),
      { headers: { Authorization: `Bearer ${token}` } },
    ),
  );
  invariant(
    result.external_reference === record.order_id &&
      Math.round(result.transaction_amount * 100) === record.amount_cents,
    "Pagamento não corresponde ao pedido.",
  );
  const status = (
    {
      approved: "paid",
      pending: "pending",
      in_process: "pending",
      rejected: "failed",
      cancelled: "expired",
      refunded: "refunded",
      charged_back: "refunded",
    } as Record<string, string>
  )[result.status];
  if (!status) return;
  await transaction(async (db) => {
    const current = await one<{
      status: string;
      provider_updated_at: Date | null;
    }>(
      db,
      "select status,provider_updated_at from public.payments where tenant_id=$1 and order_id=$2 for update",
      [record.tenant_id, record.order_id],
    );
    if (!current) return;
    const updated = result.date_last_updated
      ? new Date(result.date_last_updated)
      : new Date();
    if (current.provider_updated_at && current.provider_updated_at > updated)
      return;
    await db.query(
      "update public.payments set status=$3,provider_updated_at=$4,paid_at=case when $3='paid' then coalesce(paid_at,now()) else paid_at end where tenant_id=$1 and order_id=$2",
      [record.tenant_id, record.order_id, status, updated],
    );
    await db.query(
      "update public.orders set payment_status=$3 where tenant_id=$1 and id=$2",
      [record.tenant_id, record.order_id, status],
    );
    if (status === "paid" && current.status !== "paid")
      await notify(
        db,
        record.tenant_id,
        "mp-paid:" + providerId,
        "payment.paid",
        "PIX confirmado",
        "Um pagamento foi confirmado automaticamente.",
        "/app/pedidos",
        "orders.view",
        record.order_id,
      );
  });
}
