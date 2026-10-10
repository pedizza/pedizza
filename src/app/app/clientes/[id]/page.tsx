import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePage } from "@/lib/auth/context";
import { transaction, one, rows } from "@/lib/db";
import { PageHeader } from "@/components/ui/states";
import { calculateChange, formatCurrency } from "@/lib/domain/money";
import { formatAddress } from "@/lib/domain/address";
import { orderLabels, paymentLabels } from "@/lib/domain/orders";

type CustomerOrder = {
  id: string;
  order_number: number;
  order_status: string;
  payment_status: string;
  service_type: string;
  subtotal_cents: number;
  discount_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  payment_method_name_snapshot: string;
  delivery_address_snapshot: Record<string, string> | null;
  change_for_cents: number | null;
  delivery_distance_meters: number | null;
  preparation_minutes: number | null;
  coupon_code_snapshot: string | null;
  created_at: Date;
  items: {
    id: string;
    name_snapshot: string;
    size_name_snapshot: string | null;
    border_name_snapshot: string | null;
    quantity: number;
    unit_price_cents: number;
    observation: string;
  }[];
  history: {
    id: string;
    from_status: string | null;
    to_status: string;
    created_at: Date;
    note: string | null;
  }[];
};

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const ctx = await requirePage("customers.view");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const page = Math.max(
    1,
    Math.min(10000, Number((await searchParams).page) || 1),
  );
  const canViewOrders = ctx.permissions.includes("orders.view");
  const result = await transaction(async (db) => {
    const customer = await one<{
      name: string;
      phone: string;
      email: string | null;
      notes: string | null;
      blocked: boolean;
    }>(
      db,
      "select name,phone,email,notes,blocked from public.customers where tenant_id=$1 and id=$2",
      [ctx.tenantId, id.data],
    );
    const addresses = await rows<{
      id: string;
      label: string;
      postal_code: string;
      street: string;
      number: string;
      complement: string | null;
      neighborhood: string;
      city: string;
      state: string;
      is_default: boolean;
    }>(
      db,
      "select id,label,postal_code,street,number,complement,neighborhood,city,state,is_default from public.customer_addresses where tenant_id=$1 and customer_id=$2 and archived_at is null order by is_default desc,created_at desc",
      [ctx.tenantId, id.data],
    );
    const orders = canViewOrders
      ? await rows<Omit<CustomerOrder, "items" | "history">>(
          db,
          "select id,order_number,order_status,payment_status,service_type,subtotal_cents,discount_cents,delivery_fee_cents,total_cents,payment_method_name_snapshot,delivery_address_snapshot,change_for_cents,delivery_distance_meters,preparation_minutes,coupon_code_snapshot,created_at from public.orders where tenant_id=$1 and customer_id=$2 order by created_at desc limit 20 offset $3",
          [ctx.tenantId, id.data, (page - 1) * 20],
        )
      : [];
    const items = orders.length
      ? await rows<CustomerOrder["items"][number] & { order_id: string }>(
          db,
          "select id,order_id,name_snapshot,size_name_snapshot,border_name_snapshot,quantity,unit_price_cents,observation from public.order_items where tenant_id=$1 and order_id=any($2::uuid[]) order by created_at",
          [ctx.tenantId, orders.map((order) => order.id)],
        )
      : [];
    const itemsByOrder = new Map<string, CustomerOrder["items"]>();
    for (const item of items) {
      const orderItems = itemsByOrder.get(item.order_id) || [];
      orderItems.push(item);
      itemsByOrder.set(item.order_id, orderItems);
    }
    const history = orders.length
      ? await rows<CustomerOrder["history"][number] & { order_id: string }>(
          db,
          "select id,order_id,from_status,to_status,created_at,note from public.order_status_history where tenant_id=$1 and order_id=any($2::uuid[]) order by created_at",
          [ctx.tenantId, orders.map((order) => order.id)],
        )
      : [];
    const historyByOrder = new Map<string, CustomerOrder["history"]>();
    for (const entry of history) {
      const orderHistory = historyByOrder.get(entry.order_id) || [];
      orderHistory.push(entry);
      historyByOrder.set(entry.order_id, orderHistory);
    }
    const metrics = canViewOrders
      ? await one<{
          total_orders: number;
          completed_orders: number;
          spent: string;
          average: string;
        }>(
          db,
          "select count(*)::int total_orders,count(*) filter(where order_status in ('delivered','picked_up'))::int completed_orders,coalesce(sum(total_cents) filter(where order_status in ('delivered','picked_up')),0)::text spent,coalesce(round(avg(total_cents) filter(where order_status in ('delivered','picked_up'))),0)::text average from public.orders where tenant_id=$1 and customer_id=$2",
          [ctx.tenantId, id.data],
        )
      : undefined;
    return {
      customer,
      addresses,
      orders: orders.map((order) => ({
        ...order,
        items: itemsByOrder.get(order.id) || [],
        history: historyByOrder.get(order.id) || [],
      })),
      metrics,
    };
  }, ctx.userId);
  if (!result.customer) notFound();

  return (
    <>
      <Link href="/app/clientes">← Clientes</Link>
      <PageHeader
        title={result.customer.name}
        description={`${result.customer.phone} · ${result.customer.email || "E-mail não informado"}`}
      />
      {result.customer.blocked && (
        <p className="feedback">Assistente bloqueado para este cliente.</p>
      )}
      {result.metrics && (
        <div className="stats">
          <div className="card">
            <small>Total de pedidos</small>
            <h2>{result.metrics.total_orders}</h2>
          </div>
          <div className="card">
            <small>Pedidos concluídos</small>
            <h2>{result.metrics.completed_orders}</h2>
          </div>
          {ctx.permissions.includes("dashboard.financial") && (
            <>
              <div className="card">
                <small>Total em pedidos concluídos</small>
                <h2>{formatCurrency(Number(result.metrics.spent))}</h2>
              </div>
              <div className="card">
                <small>Ticket médio concluído</small>
                <h2>{formatCurrency(Number(result.metrics.average))}</h2>
              </div>
            </>
          )}
        </div>
      )}

      <section className="card customer-profile-section">
        <div className="customer-profile-heading">
          <h2>Endereços do cliente</h2>
          <span>{result.addresses.length}</span>
        </div>
        {result.addresses.length ? (
          <div className="customer-address-list">
            {result.addresses.map((address) => (
              <article className="customer-address" key={address.id}>
                <strong>
                  {address.label || "Endereço"}
                  {address.is_default && (
                    <span className="badge green">Padrão</span>
                  )}
                </strong>
                <p>
                  {formatAddress({
                    ...address,
                    complement: address.complement || undefined,
                  })}
                </p>
                {address.postal_code && (
                  <small>CEP {address.postal_code}</small>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">Nenhum endereço cadastrado para este cliente.</p>
        )}
        <h3>Observações do cliente</h3>
        <p>{result.customer.notes || "Nenhuma observação cadastrada."}</p>
      </section>

      {canViewOrders && (
        <section className="customer-order-section">
          <div className="customer-profile-heading">
            <div>
              <h2>Histórico de pedidos</h2>
              <p className="muted">Pedidos mais recentes deste cliente.</p>
            </div>
            <span>{result.metrics?.total_orders || 0} no total</span>
          </div>
          {result.orders.length ? (
            <div className="customer-order-list">
              {result.orders.map((order) => (
                <article className="card customer-order-card" key={order.id}>
                  <header className="customer-order-header">
                    <div>
                      <h3>Pedido #{order.order_number}</h3>
                      <time dateTime={new Date(order.created_at).toISOString()}>
                        {new Date(order.created_at).toLocaleString("pt-BR", {
                          timeZone: "America/Sao_Paulo",
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </time>
                    </div>
                    <div className="customer-order-statuses">
                      <span className="badge">
                        {orderLabels[order.order_status] || order.order_status}
                      </span>
                      <span className="badge">
                        {paymentLabels[order.payment_status] ||
                          order.payment_status}
                      </span>
                    </div>
                  </header>
                  <div className="customer-order-items">
                    <strong>Itens do pedido</strong>
                    {order.items.length ? (
                      order.items.map((item) => (
                        <div className="customer-order-item" key={item.id}>
                          <div>
                            <strong>
                              {item.quantity}×{" "}
                              {item.size_name_snapshot &&
                                `${item.size_name_snapshot} `}
                              {item.name_snapshot}
                            </strong>
                            {item.border_name_snapshot && (
                              <p>Borda: {item.border_name_snapshot}</p>
                            )}
                            {item.observation && (
                              <p>Observação: {item.observation}</p>
                            )}
                          </div>
                          <span>
                            {formatCurrency(
                              item.quantity * item.unit_price_cents,
                            )}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="muted">Itens não disponíveis.</p>
                    )}
                  </div>
                  <dl className="customer-order-totals">
                    <div>
                      <dt>Subtotal</dt>
                      <dd>{formatCurrency(order.subtotal_cents)}</dd>
                    </div>
                    <div>
                      <dt>
                        Desconto
                        {order.coupon_code_snapshot
                          ? ` · ${order.coupon_code_snapshot}`
                          : ""}
                      </dt>
                      <dd>{formatCurrency(order.discount_cents)}</dd>
                    </div>
                    <div>
                      <dt>Entrega</dt>
                      <dd>{formatCurrency(order.delivery_fee_cents)}</dd>
                    </div>
                    <div className="customer-order-total">
                      <dt>Total</dt>
                      <dd>{formatCurrency(order.total_cents)}</dd>
                    </div>
                  </dl>
                  <div className="customer-order-meta">
                    <p>
                      <strong>Recebimento:</strong>{" "}
                      {order.service_type === "delivery"
                        ? "Entrega"
                        : "Retirada"}
                    </p>
                    <p>
                      <strong>Pagamento:</strong>{" "}
                      {order.payment_method_name_snapshot || "Não informado"}
                    </p>
                    {order.change_for_cents != null &&
                      order.change_for_cents > 0 && (
                        <>
                          <p>
                            <strong>Troco para:</strong>{" "}
                            {formatCurrency(order.change_for_cents)}
                          </p>
                          <p>
                            <strong>Troco a devolver:</strong>{" "}
                            {formatCurrency(
                              calculateChange(
                                order.change_for_cents,
                                order.total_cents,
                              ),
                            )}
                          </p>
                        </>
                      )}
                    {order.preparation_minutes && (
                      <p>
                        <strong>Preparo estimado:</strong>{" "}
                        {order.preparation_minutes} minutos
                      </p>
                    )}
                    {order.delivery_distance_meters != null && (
                      <p>
                        <strong>Distância da entrega:</strong>{" "}
                        {(order.delivery_distance_meters / 1000)
                          .toFixed(1)
                          .replace(".", ",")}{" "}
                        km
                      </p>
                    )}
                    {order.service_type === "delivery" &&
                      order.delivery_address_snapshot && (
                        <p>
                          <strong>Endereço da entrega:</strong>{" "}
                          {formatAddress(order.delivery_address_snapshot)}
                        </p>
                      )}
                  </div>
                  {order.history.length > 0 && (
                    <div className="customer-order-history">
                      <strong>Atualizações do pedido</strong>
                      {order.history.map((entry) => (
                        <p key={entry.id}>
                          <span>
                            {orderLabels[entry.to_status] || entry.to_status}
                            {entry.note ? ` · ${entry.note}` : ""}
                          </span>
                          <time>
                            {new Date(entry.created_at).toLocaleString(
                              "pt-BR",
                              {
                                timeZone: "America/Sao_Paulo",
                                dateStyle: "short",
                                timeStyle: "short",
                              },
                            )}
                          </time>
                        </p>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="card customer-order-empty">
              Este cliente ainda não tem pedidos.
            </div>
          )}
          <div className="row between customer-order-pagination">
            {page > 1 && (
              <Link href={`?page=${page - 1}`}>Pedidos anteriores</Link>
            )}
            {result.orders.length === 20 && (
              <Link href={`?page=${page + 1}`}>Pedidos mais antigos</Link>
            )}
          </div>
        </section>
      )}
    </>
  );
}
