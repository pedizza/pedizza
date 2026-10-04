import "server-only";
import { z } from "zod";
import { externalJson } from "./http";
import { requiredEnv } from "@/lib/env";
import { transaction, one } from "@/lib/db";
import { authorize, type TenantContext } from "@/lib/auth/context";
import { invariant } from "@/lib/errors";
import { audit } from "@/lib/audit";
const txSchema = z.object({
  id: z.string(),
  status: z.enum(["PENDING", "PAID", "EXPIRED", "REFUNDED", "CHARGEBACK"]),
  amount_cents: z.number().int(),
  external_reference: z.string().nullable().optional(),
  paid_at: z.string().nullable().optional(),
  pix: z
    .object({ copy_paste: z.string(), expires_at: z.string().optional() })
    .nullable()
    .optional(),
  card: z.object({ hosted_url: z.url() }).nullable().optional(),
});
async function bravo(path: string, body?: unknown, key?: string) {
  return externalJson(new URL("https://bravopay.club/api/v1/" + path), {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + requiredEnv("BRAVOPAY_API_KEY"),
      "Content-Type": "application/json",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
export async function createBillingCharge(ctx: TenantContext) {
  invariant(
    process.env.BRAVOPAY_API_KEY &&
      process.env.BRAVOPAY_WEBHOOK_SECRET &&
      process.env.BRAVOPAY_PRODUCT_ID,
    "A assinatura está aguardando configuração do administrador.",
    503,
  );
  const charge = await transaction(async (db) => {
    await authorize(db, ctx, "subscription.manage", true);
    await db.query("select id from public.tenants where id=$1 for update", [
      ctx.tenantId,
    ]);
    const s = await one<{ id: string; price_cents: number }>(
      db,
      "select s.id,p.price_cents from public.subscriptions s join public.subscription_plans p on p.id=s.plan_id where s.tenant_id=$1",
      [ctx.tenantId],
    );
    invariant(s, "Plano não encontrado.");
    const existing = await one<{
      id: string;
      idempotency_key: string;
      provider_id: string | null;
      amount_cents: number;
      subscription_id: string;
    }>(
      db,
      "select id,idempotency_key,provider_id,amount_cents,subscription_id from private.billing_charges where tenant_id=$1 and status in ('pending','creating') order by created_at desc limit 1",
      [ctx.tenantId],
    );
    if (existing) return existing;
    return (await one<{
      id: string;
      idempotency_key: string;
      provider_id: string | null;
      amount_cents: number;
      subscription_id: string;
    }>(
      db,
      "insert into private.billing_charges(tenant_id,subscription_id,amount_cents,status) values($1,$2,$3,'creating') returning id,idempotency_key,provider_id,amount_cents,subscription_id",
      [ctx.tenantId, s.id, s.price_cents],
    ))!;
  });
  if (!charge.provider_id) {
    const result = txSchema.parse(
      await bravo(
        "transactions",
        {
          amount_cents: charge.amount_cents,
          method: "pix",
          product_id: requiredEnv("BRAVOPAY_PRODUCT_ID"),
          description: "Pedizza — mensalidade",
          external_reference: charge.subscription_id,
          customer: { email: ctx.email, name: ctx.name },
          metadata: { pedizza_charge_id: charge.id },
          subscription: { interval: "monthly", trial_days: 0 },
        },
        charge.idempotency_key,
      ),
    );
    invariant(
      result.amount_cents === charge.amount_cents,
      "Valor da cobrança divergente.",
    );
    await transaction(async (db) => {
      await db.query(
        "update private.billing_charges set provider_id=$2,status='pending',pix_copy_paste=$3,expires_at=$4 where id=$1",
        [
          charge.id,
          result.id,
          result.pix?.copy_paste || null,
          result.pix?.expires_at || null,
        ],
      );
      await audit(
        db,
        ctx.tenantId,
        ctx.userId,
        "subscription.charge_created",
        "subscriptions",
        charge.subscription_id,
      );
    });
  }
  return transaction((db) =>
    one(
      db,
      "select id,status,pix_copy_paste,expires_at,amount_cents from private.billing_charges where id=$1 and tenant_id=$2",
      [charge.id, ctx.tenantId],
    ),
  );
}
export async function reconcileBravoTransaction(id: string) {
  const result = txSchema.parse(
    await bravo("transactions/" + encodeURIComponent(id)),
  );
  if (!result.external_reference) return;
  await transaction(async (db) => {
    const s = await one<{ id: string; tenant_id: string; price_cents: number }>(
      db,
      "select s.id,s.tenant_id,p.price_cents from public.subscriptions s join public.subscription_plans p on p.id=s.plan_id where s.id::text=$1 for update of s",
      [result.external_reference],
    );
    if (!s) return;
    invariant(
      result.amount_cents === s.price_cents,
      "Cobrança com valor divergente.",
    );
    let charge = await one<{ id: string; credited_at: Date | null }>(
      db,
      "select id,credited_at from private.billing_charges where tenant_id=$1 and provider_id=$2 for update",
      [s.tenant_id, id],
    );
    if (!charge) {
      charge = await one<{ id: string; credited_at: Date | null }>(
        db,
        "insert into private.billing_charges(tenant_id,subscription_id,provider_id,amount_cents,status) values($1,$2,$3,$4,$5) returning id,credited_at",
        [
          s.tenant_id,
          s.id,
          id,
          result.amount_cents,
          result.status.toLowerCase(),
        ],
      );
    }
    invariant(charge, "Cobrança indisponível.");
    if (result.status === "PAID" && !charge.credited_at) {
      invariant(result.paid_at, "Pagamento sem data de confirmação.");
      await db.query(
        "update public.subscriptions set status='active',current_period_end=greatest(coalesce(current_period_end,$3::timestamptz),$3::timestamptz)+interval '1 month',provider_updated_at=now(),updated_at=now() where tenant_id=$1 and id=$2",
        [s.tenant_id, s.id, result.paid_at],
      );
      await db.query(
        "update private.billing_charges set credited_at=now() where id=$1",
        [charge.id],
      );
      await audit(
        db,
        s.tenant_id,
        null,
        "subscription.payment_confirmed",
        "subscriptions",
        s.id,
      );
    }
    if (
      ["REFUNDED", "CHARGEBACK"].includes(result.status) &&
      charge.credited_at
    )
      await db.query(
        "update public.subscriptions set status='suspended',updated_at=now() where id=$1",
        [s.id],
      );
    await db.query("update private.billing_charges set status=$2 where id=$1", [
      charge.id,
      result.status.toLowerCase(),
    ]);
  });
}
