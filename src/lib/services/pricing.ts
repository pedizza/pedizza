import "server-only";
import { createHash } from "node:crypto";
import { one, rows, type DB } from "@/lib/db";
import { invariant } from "@/lib/errors";
import { splitPrice, discountAmount } from "@/lib/domain/money";
export type CartItem = {
  id: string;
  product_ids: string[];
  size_id: string | null;
  border_id: string | null;
  quantity: number;
  observation: string;
};
export type PricedItem = CartItem & {
  category_id: string;
  name_snapshot: string;
  flavors_snapshot: { id: string; name: string; price_cents: number }[];
  size_name_snapshot: string | null;
  border_name_snapshot: string | null;
  unit_price_cents: number;
  border_price_cents: number;
};
export async function priceItem(
  db: DB,
  tenant: string,
  item: CartItem,
): Promise<PricedItem> {
  invariant(
    item.product_ids.length >= 1 && item.product_ids.length <= 2,
    "Escolha um ou dois sabores.",
  );
  const products = await rows<{
    id: string;
    name: string;
    category_id: string;
    base_price_cents: number | null;
    allow_split: boolean;
    split_pricing: "highest" | "proportional";
  }>(
    db,
    `select i.id,i.name,i.category_id,i.base_price_cents,c.allow_split,c.split_pricing from public.menu_items i join public.menu_categories c on c.tenant_id=i.tenant_id and c.id=i.category_id where i.tenant_id=$1 and i.id=any($2::uuid[]) and i.active and i.available and i.archived_at is null and c.active and c.archived_at is null order by array_position($2::uuid[],i.id)`,
    [tenant, item.product_ids],
  );
  invariant(
    products.length === item.product_ids.length,
    "Um produto ficou indisponível. Revise o carrinho.",
  );
  const first = products[0];
  invariant(
    products.length === 1 || products.every((product) => product.allow_split),
    "Uma das categorias não permite dois sabores.",
  );
  invariant(
    products.every(
      (product) => product.split_pricing === first.split_pricing,
    ),
    "As categorias possuem regras de preço incompatíveis.",
  );
  const flavors: { id: string; name: string; price_cents: number }[] = [];
  let sizeName: string | null = null;
  if (item.size_id) {
    const size = await one<{
      name: string;
      max_flavors: number;
      category_id: string;
    }>(
      db,
      "select name,max_flavors,category_id from public.menu_sizes where tenant_id=$1 and id=$2 and category_id=$3 and active and archived_at is null",
      [tenant, item.size_id, first.category_id],
    );
    invariant(
      size && products.length <= size.max_flavors,
      "Tamanho indisponível para esta combinação.",
    );
    sizeName = size.name;
    const prices = await rows<{
      item_id: string;
      price_cents: number;
      max_flavors: number;
    }>(
      db,
      `select distinct on(p.item_id) p.item_id,p.price_cents,s.max_flavors
       from public.menu_item_prices p
       join public.menu_sizes s on s.tenant_id=p.tenant_id and s.id=p.size_id and s.active and s.archived_at is null
       join public.menu_items i on i.tenant_id=p.tenant_id and i.id=p.item_id and i.category_id=s.category_id
       where p.tenant_id=$1 and p.item_id=any($2::uuid[]) and p.active and lower(s.name)=lower($3)
       order by p.item_id,case when s.id=$4 then 0 else 1 end,s.sort_order,s.id`,
      [tenant, item.product_ids, size.name, item.size_id],
    );
    for (const p of products) {
      const price = prices.find((x) => x.item_id === p.id);
      invariant(price, "Um sabor não possui preço neste tamanho.");
      invariant(
        products.length <= price.max_flavors,
        "O tamanho não permite esta quantidade de sabores.",
      );
      flavors.push({ id: p.id, name: p.name, price_cents: price.price_cents });
    }
  } else
    for (const p of products) {
      invariant(p.base_price_cents !== null, "Escolha um tamanho.");
      flavors.push({ id: p.id, name: p.name, price_cents: p.base_price_cents });
    }
  let borderName: string | null = null,
    borderPrice = 0;
  if (item.border_id) {
    const border = await one<{ name: string; price_cents: number }>(
      db,
      `select g.name || ' — ' || b.name name,coalesce(bp.price_cents,b.base_price_cents) price_cents from public.menu_borders b join public.menu_border_groups g on g.tenant_id=b.tenant_id and g.id=b.group_id join public.menu_border_group_categories bc on bc.tenant_id=g.tenant_id and bc.group_id=g.id and bc.category_id=$3 left join public.menu_border_prices bp on bp.tenant_id=b.tenant_id and bp.border_id=b.id and bp.size_id=$4 where b.tenant_id=$1 and b.id=$2 and b.active and g.active and b.archived_at is null and g.archived_at is null`,
      [tenant, item.border_id, first.category_id, item.size_id],
    );
    invariant(border, "Borda indisponível para esta categoria.");
    borderName = border.name;
    borderPrice = border.price_cents;
  }
  return {
    ...item,
    category_id: first.category_id,
    name_snapshot: flavors.map((f) => f.name).join(" / "),
    flavors_snapshot: flavors,
    size_name_snapshot: sizeName,
    border_name_snapshot: borderName,
    unit_price_cents:
      splitPrice(
        flavors.map((f) => f.price_cents),
        first.split_pricing,
      ) + borderPrice,
    border_price_cents: borderPrice,
  };
}
export async function priceCart(db: DB, tenant: string, cartId: string) {
  const cart = await one<{
    id: string;
    customer_id: string;
    delivery_fee_cents: number;
    coupon_code: string | null;
  }>(
    db,
    "select id,customer_id,delivery_fee_cents,coupon_code from public.carts where tenant_id=$1 and id=$2",
    [tenant, cartId],
  );
  invariant(cart, "Carrinho não encontrado.");
  const raw = await rows<CartItem>(
    db,
    "select id,product_ids,size_id,border_id,quantity,observation from public.cart_items where tenant_id=$1 and cart_id=$2 order by created_at,id limit 101",
    [tenant, cartId],
  );
  invariant(raw.length, "Seu carrinho está vazio.");
  invariant(raw.length <= 100, "O carrinho pode ter até 100 itens.");
  const items: PricedItem[] = [];
  for (const item of raw) items.push(await priceItem(db, tenant, item));
  const subtotal = items.reduce(
    (sum, i) => sum + i.quantity * i.unit_price_cents,
    0,
  );
  let discount = 0,
    eligible = 0,
    couponId: string | null = null;
  if (cart.coupon_code) {
    const coupon = await one<{
      id: string;
      discount_type: "fixed" | "percentage";
      discount_value: number;
      minimum_order_cents: number;
      total_usage_limit: number | null;
      per_customer_usage_limit: number | null;
    }>(
      db,
      `select c.id,c.discount_type,c.discount_value,c.minimum_order_cents,c.total_usage_limit,c.per_customer_usage_limit from public.coupons c join public.campaigns p on p.id=c.campaign_id and p.tenant_id=c.tenant_id where c.tenant_id=$1 and c.code=$2 and c.active and c.archived_at is null and p.active and p.archived_at is null and p.starts_at<=now() and (p.ends_at is null or p.ends_at>now()) for update of c`,
      [tenant, cart.coupon_code],
    );
    invariant(coupon, "Cupom indisponível. Remova-o para continuar.");
    invariant(
      subtotal >= coupon.minimum_order_cents,
      "O subtotal não atende ao mínimo do cupom.",
    );
    const usage = await one<{ total: number; customer: number }>(
      db,
      "select count(*)::int total,count(*) filter(where customer_id=$3)::int customer from public.coupon_redemptions where tenant_id=$1 and coupon_id=$2 and status='applied'",
      [tenant, coupon.id, cart.customer_id],
    );
    invariant(
      !coupon.total_usage_limit ||
        (usage?.total || 0) < coupon.total_usage_limit,
      "Cupom esgotado.",
    );
    invariant(
      !coupon.per_customer_usage_limit ||
        (usage?.customer || 0) < coupon.per_customer_usage_limit,
      "Limite de usos por cliente atingido.",
    );
    const categories = await rows<{ category_id: string }>(
      db,
      "select category_id from public.coupon_categories where tenant_id=$1 and coupon_id=$2",
      [tenant, coupon.id],
    );
    const products = await rows<{ product_id: string }>(
      db,
      "select product_id from public.coupon_products where tenant_id=$1 and coupon_id=$2",
      [tenant, coupon.id],
    );
    for (const item of items) {
      const full =
        (!categories.length && !products.length) ||
        categories.some((c) => c.category_id === item.category_id);
      const portion = full
        ? 1
        : item.product_ids.filter((p) =>
            products.some((x) => x.product_id === p),
          ).length / item.product_ids.length;
      eligible += Math.floor(item.unit_price_cents * item.quantity * portion);
    }
    invariant(eligible > 0, "Cupom não se aplica aos itens do carrinho.");
    discount = discountAmount(
      eligible,
      coupon.discount_type,
      coupon.discount_value,
    );
    couponId = coupon.id;
  }
  const total = subtotal - discount + cart.delivery_fee_cents;
  invariant(
    Number.isSafeInteger(total) && total <= 100000000,
    "Pedido acima do limite.",
  );
  const quote = {
    items,
    subtotal_cents: subtotal,
    discount_cents: discount,
    delivery_fee_cents: cart.delivery_fee_cents,
    total_cents: total,
    coupon_id: couponId,
    eligible_subtotal_cents: eligible,
  };
  return {
    ...quote,
    hash: createHash("sha256").update(JSON.stringify(quote)).digest("hex"),
  };
}
