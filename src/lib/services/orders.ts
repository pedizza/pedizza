import "server-only";
import { transaction, rows, one, type DB } from "@/lib/db";
import { authorize, type TenantContext } from "@/lib/auth/context";
import { invariant } from "@/lib/errors";
import {
  canConfirmManually,
  canTransition,
  orderLabels,
  paymentLabels,
} from "@/lib/domain/orders";
import { calculateChange, formatChatCurrency } from "@/lib/domain/money";
import { formatAddress } from "@/lib/domain/address";
import { getStoreOpenStatus, type BusinessHour } from "@/lib/domain/hours";
import { priceCart } from "./pricing";
import { enqueue, notify } from "./events";
import { audit } from "@/lib/audit";
export type Order = {
  id: string;
  tenant_id: string;
  order_number: number;
  customer_id: string;
  conversation_id: string | null;
  order_status: string;
  payment_status: string;
  service_type: string;
  total_cents: number;
  subtotal_cents: number;
  discount_cents: number;
  delivery_fee_cents: number;
  customer_name_snapshot: string;
  customer_phone_snapshot: string;
  payment_method_type: string;
  payment_method_name_snapshot: string;
  delivery_address_snapshot: Record<string, string> | null;
  preparation_minutes: number | null;
  created_at: string;
  updated_at: string;
  change_for_cents: number | null;
  coupon_code_snapshot: string | null;
};
export const orderColumns =
  "id,tenant_id,order_number,customer_id,conversation_id,order_status,payment_status,service_type,total_cents,subtotal_cents,discount_cents,delivery_fee_cents,customer_name_snapshot,customer_phone_snapshot,payment_method_type,payment_method_name_snapshot,delivery_address_snapshot,preparation_minutes,created_at,updated_at,change_for_cents,coupon_code_snapshot";

export async function listOrders(
  db: DB,
  tenantId: string,
  {
    status = "",
    search = "",
    page = 1,
  }: { status?: string; search?: string; page?: number } = {},
) {
  const found = await rows<Order & { total_count: number }>(
    db,
    `select ${orderColumns},count(*) over()::int total_count
     from public.orders
     where tenant_id=$1
       and ($2='' or order_status=$2)
       and (customer_name_snapshot ilike $3 or order_number::text ilike $3)
     order by created_at desc,id
     limit 20 offset $4`,
    [tenantId, status, "%" + search + "%", (page - 1) * 20],
  );
  return {
    data: found.map(({ total_count, ...order }) => {
      void total_count;
      return order;
    }),
    total: found[0]?.total_count || 0,
  };
}
export async function orderSummary(db: DB, order: Order) {
  const items = await rows<{
    name_snapshot: string;
    size_name_snapshot: string | null;
    border_name_snapshot: string | null;
    quantity: number;
    unit_price_cents: number;
    observation: string;
  }>(
    db,
    "select name_snapshot,size_name_snapshot,border_name_snapshot,quantity,unit_price_cents,observation from public.order_items where tenant_id=$1 and order_id=$2 order by created_at",
    [order.tenant_id, order.id],
  );
  return [
    `Pedido #${order.order_number} — ${orderLabels[order.order_status]}`,
    `Cliente: ${order.customer_name_snapshot}`,
    ...items.map(
      (i) =>
        `${i.quantity}x ${i.size_name_snapshot || ""} ${i.name_snapshot}${i.border_name_snapshot ? " · " + i.border_name_snapshot : ""} — ${formatChatCurrency(i.quantity * i.unit_price_cents)}${i.observation ? "\nObservação do Pedido: " + i.observation : ""}`,
    ),
    `Subtotal: ${formatChatCurrency(order.subtotal_cents)}`,
    order.discount_cents > 0
      ? `Desconto${order.coupon_code_snapshot ? " (" + order.coupon_code_snapshot + ")" : ""}: ${formatChatCurrency(order.discount_cents)}`
      : "Desconto: Sem desconto aplicado",
    `Entrega: ${formatChatCurrency(order.delivery_fee_cents)}`,
    `Total: ${formatChatCurrency(order.total_cents)}`,
    order.service_type === "delivery"
      ? `Endereço: ${formatAddress(order.delivery_address_snapshot)}`
      : "Retirada no local",
    `Pagamento: ${order.payment_method_name_snapshot} · ${paymentLabels[order.payment_status] || order.payment_status}`,
    order.change_for_cents
      ? `Troco para ${formatChatCurrency(order.change_for_cents)}\nTroco a devolver: ${formatChatCurrency(calculateChange(order.change_for_cents, order.total_cents))}`
      : "",
    order.preparation_minutes
      ? `Preparo estimado: ${order.preparation_minutes} minutos`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
export async function finalizeCart(
  db: DB,
  tenant: string,
  cartId: string,
  expectedHash: string,
) {
  await db.query("select id from public.tenants where id=$1 for update", [
    tenant,
  ]);
  const existing = await one<Order>(
    db,
    `select ${orderColumns} from public.orders where tenant_id=$1 and cart_id=$2`,
    [tenant, cartId],
  );
  if (existing) return existing;
  const cart = await one<{
    customer_id: string;
    conversation_id: string;
    payment_method_id: string;
    service_type: string;
    address_snapshot: unknown;
    distance_meters: number | null;
    delivery_fee_cents: number;
    change_for_cents: number | null;
    coupon_code: string | null;
  }>(
    db,
    "select customer_id,conversation_id,payment_method_id,service_type,address_snapshot,distance_meters,delivery_fee_cents,change_for_cents,coupon_code from public.carts where tenant_id=$1 and id=$2 and status='active' and expires_at>now() for update",
    [tenant, cartId],
  );
  invariant(cart, "Carrinho expirado ou indisponível.");
  const access = await one<{ active: boolean }>(
    db,
    "select private.subscription_active($1) active",
    [tenant],
  );
  invariant(access?.active, "Esta loja está indisponível.");
  const store = await one<{
    timezone: string;
    status_mode: string;
    minimum_order_cents: number;
    delivery_enabled: boolean;
    pickup_enabled: boolean;
  }>(
    db,
    "select timezone,status_mode,minimum_order_cents,delivery_enabled,pickup_enabled from public.store_settings where tenant_id=$1",
    [tenant],
  );
  const hours = await rows<BusinessHour>(
    db,
    "select day_of_week,start_time::text,end_time::text from public.store_business_hours where tenant_id=$1",
    [tenant],
  );
  invariant(
    store &&
      getStoreOpenStatus(hours, store.timezone, store.status_mode).isOpen,
    "A loja está fechada neste momento.",
  );
  invariant(
    cart.service_type === "delivery"
      ? store.delivery_enabled && cart.address_snapshot
      : store.pickup_enabled,
    "Modalidade indisponível.",
  );
  const quote = await priceCart(db, tenant, cartId);
  invariant(
    quote.hash === expectedHash,
    "Os valores mudaram. Confira o novo resumo e confirme novamente.",
    409,
  );
  invariant(
    quote.subtotal_cents >= store.minimum_order_cents,
    "Pedido abaixo do valor mínimo da loja.",
  );
  const method = await one<{
    id: string;
    type: string;
    name: string;
    requires_manual_confirmation: boolean;
  }>(
    db,
    "select id,type,name,requires_manual_confirmation from public.payment_methods where tenant_id=$1 and id=$2 and active and archived_at is null",
    [tenant, cart.payment_method_id],
  );
  invariant(
    method && method.type !== "pix_mercado_pago",
    "Escolha uma forma de pagamento disponível.",
  );
  const customer = await one<{ name: string; phone: string }>(
    db,
    "select name,phone from public.customers where tenant_id=$1 and id=$2 and active and not blocked and archived_at is null",
    [tenant, cart.customer_id],
  );
  invariant(customer, "Cliente indisponível.");
  invariant(
    method.type !== "cash" ||
      !cart.change_for_cents ||
      cart.change_for_cents >= quote.total_cents,
    "O troco deve cobrir o total do pedido.",
  );
  const number = await one<{ n: number }>(
    db,
    "select coalesce(max(order_number),0)+1 n from public.orders where tenant_id=$1",
    [tenant],
  );
  const status =
    method.type === "pix_mercado_pago"
      ? "pending"
      : method.type === "pix_manual" || method.requires_manual_confirmation
        ? "awaiting_manual_confirmation"
        : "pay_on_delivery";
  const order = await one<Order>(
    db,
    `insert into public.orders(tenant_id,customer_id,conversation_id,cart_id,order_number,service_type,payment_status,subtotal_cents,discount_cents,delivery_fee_cents,total_cents,coupon_id,coupon_code_snapshot,payment_method_id,payment_method_type,payment_method_name_snapshot,change_for_cents,customer_name_snapshot,customer_phone_snapshot,delivery_address_snapshot,delivery_distance_meters) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) returning ${orderColumns}`,
    [
      tenant,
      cart.customer_id,
      cart.conversation_id,
      cartId,
      number?.n,
      cart.service_type,
      status,
      quote.subtotal_cents,
      quote.discount_cents,
      quote.delivery_fee_cents,
      quote.total_cents,
      quote.coupon_id,
      cart.coupon_code,
      method.id,
      method.type,
      method.name,
      cart.change_for_cents,
      customer.name,
      customer.phone,
      JSON.stringify(cart.address_snapshot),
      cart.distance_meters,
    ],
  );
  invariant(order, "Não foi possível criar o pedido.");
  for (const i of quote.items)
    await db.query(
      "insert into public.order_items(tenant_id,order_id,category_id,product_ids,name_snapshot,flavors_snapshot,size_name_snapshot,border_name_snapshot,quantity,unit_price_cents,border_price_cents,observation) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [
        tenant,
        order.id,
        i.category_id,
        i.product_ids,
        i.name_snapshot,
        JSON.stringify(i.flavors_snapshot),
        i.size_name_snapshot,
        i.border_name_snapshot,
        i.quantity,
        i.unit_price_cents,
        i.border_price_cents,
        i.observation,
      ],
    );
  await db.query(
    "insert into public.payments(tenant_id,order_id,provider,amount_cents,status) values($1,$2,$3,$4,$5)",
    [tenant, order.id, method.type, quote.total_cents, status],
  );
  if (quote.coupon_id)
    await db.query(
      "insert into public.coupon_redemptions(tenant_id,coupon_id,customer_id,order_id,discount_cents,eligible_subtotal_cents) values($1,$2,$3,$4,$5,$6)",
      [
        tenant,
        quote.coupon_id,
        cart.customer_id,
        order.id,
        quote.discount_cents,
        quote.eligible_subtotal_cents,
      ],
    );
  await db.query(
    "update public.carts set status='confirmed' where tenant_id=$1 and id=$2",
    [tenant, cartId],
  );
  await db.query(
    "insert into public.order_status_history(tenant_id,order_id,to_status,source) values($1,$2,'new','chatbot')",
    [tenant, order.id],
  );
  await notify(
    db,
    tenant,
    "new-order:" + order.id,
    "order.new",
    "Novo pedido",
    `Pedido #${order.order_number} aguardando aceite.`,
    "/app/pedidos",
    "orders.view",
    order.id,
  );
  if (method.type === "pix_mercado_pago")
    await enqueue(db, tenant, "payment", "payment:" + order.id, {
      orderId: order.id,
    });
  await audit(db, tenant, null, "order.created", "orders", order.id);
  return order;
}
export async function changeOrder(
  ctx: TenantContext,
  id: string,
  to: string,
  note: string,
  minutes: number,
) {
  const permission =
    to === "accepted"
      ? "orders.accept"
      : to === "refused"
        ? "orders.refuse"
        : to === "cancelled"
          ? "orders.cancel"
          : "orders.update_status";
  return transaction(async (db) => {
    await authorize(db, ctx, permission);
    const order = await one<Order>(
      db,
      `select ${orderColumns} from public.orders where tenant_id=$1 and id=$2 for update`,
      [ctx.tenantId, id],
    );
    invariant(order, "Pedido não encontrado.", 404);
    invariant(
      canTransition(order.order_status, to, order.service_type),
      "O pedido já mudou de etapa. Atualize a tela.",
      409,
    );
    if (["refused", "cancelled"].includes(to))
      invariant(note.trim().length >= 3, "Informe o motivo.");
    const result = await one<Order>(
      db,
      `update public.orders set order_status=$3,preparation_minutes=case when $3='accepted' then $4 else preparation_minutes end,accepted_at=case when $3='accepted' then now() else accepted_at end,completed_at=case when $3 in ('delivered','picked_up') then now() else completed_at end,cancelled_at=case when $3 in ('cancelled','refused') then now() else cancelled_at end,cancellation_reason=case when $3 in ('cancelled','refused') then $5 else cancellation_reason end where tenant_id=$1 and id=$2 returning ${orderColumns}`,
      [ctx.tenantId, id, to, minutes, note],
    );
    invariant(result, "Pedido indisponível.");
    await db.query(
      "insert into public.order_status_history(tenant_id,order_id,from_status,to_status,user_id,note) values($1,$2,$3,$4,$5,$6)",
      [ctx.tenantId, id, order.order_status, to, ctx.userId, note],
    );
    if (["cancelled", "refused"].includes(to))
      await db.query(
        "update public.coupon_redemptions set status='reversed',reversed_at=now() where tenant_id=$1 and order_id=$2 and status='applied'",
        [ctx.tenantId, id],
      );
    if (order.conversation_id)
      await enqueue(db, ctx.tenantId, "message", `order:${id}:${to}`, {
        conversationId: order.conversation_id,
        sender: "system",
        text:
          to === "accepted"
            ? await orderSummary(db, result)
            : `Pedido #${order.order_number}: ${orderLabels[to]}.${note ? " Motivo: " + note : ""}`,
      });
    await audit(
      db,
      ctx.tenantId,
      ctx.userId,
      "order.status_changed",
      "orders",
      id,
      { from: order.order_status, to },
    );
    return result;
  });
}
export async function confirmManualPayment(ctx: TenantContext, id: string) {
  return transaction(async (db) => {
    await authorize(db, ctx, "payments.confirm_manual");
    const p = await one<{
      id: string;
      status: string;
      order_payment_status: string;
      payment_method_type: string;
      requires_manual_confirmation: boolean | null;
    }>(
      db,
      "select p.id,p.status,o.payment_status order_payment_status,o.payment_method_type,m.requires_manual_confirmation from public.payments p join public.orders o on o.tenant_id=p.tenant_id and o.id=p.order_id left join public.payment_methods m on m.tenant_id=o.tenant_id and m.id=o.payment_method_id where p.tenant_id=$1 and p.order_id=$2 for update of p,o",
      [ctx.tenantId, id],
    );
    invariant(
      p &&
        canConfirmManually(
          p.payment_method_type,
          p.requires_manual_confirmation || false,
        ) &&
        p.status !== "refunded" &&
        p.order_payment_status !== "refunded",
      "Pagamento não pode ser confirmado manualmente.",
      409,
    );
    if (p.status === "paid" && p.order_payment_status === "paid")
      return { ok: true };
    await db.query(
      "update public.payments set status='paid',paid_at=now(),confirmed_by=$3 where tenant_id=$1 and id=$2",
      [ctx.tenantId, p.id, ctx.userId],
    );
    await db.query(
      "update public.orders set payment_status='paid' where tenant_id=$1 and id=$2",
      [ctx.tenantId, id],
    );
    await audit(
      db,
      ctx.tenantId,
      ctx.userId,
      "payment.manually_confirmed",
      "payments",
      p.id,
    );
    await notify(
      db,
      ctx.tenantId,
      "payment:" + p.id,
      "payment.paid",
      "Pagamento confirmado",
      "O pagamento do pedido foi confirmado.",
      "/app/pedidos",
      "orders.view",
      id,
    );
    return { ok: true };
  });
}
