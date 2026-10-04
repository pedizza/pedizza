import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePage } from "@/lib/auth/context";
import { transaction, one, rows } from "@/lib/db";
import { PageHeader } from "@/components/ui/states";
import { formatCurrency } from "@/lib/domain/money";
import { orderLabels, paymentLabels } from "@/lib/domain/orders";
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
  const result = await transaction(async (db) => {
    const customer = await one<{
      name: string;
      phone: string;
      email: string;
      notes: string;
      blocked: boolean;
    }>(
      db,
      "select name,phone,email,notes,blocked from public.customers where tenant_id=$1 and id=$2",
      [ctx.tenantId, id.data],
    );
    const addresses = await rows<{
      id: string;
      street: string;
      number: string;
      neighborhood: string;
      city: string;
      state: string;
      is_default: boolean;
    }>(
      db,
      "select id,street,number,neighborhood,city,state,is_default from public.customer_addresses where tenant_id=$1 and customer_id=$2 and archived_at is null",
      [ctx.tenantId, id.data],
    );
    const orders = ctx.permissions.includes("orders.view")
      ? await rows<{
          id: string;
          order_number: number;
          order_status: string;
          payment_status: string;
          total_cents: number;
          created_at: Date;
        }>(
          db,
          "select id,order_number,order_status,payment_status,total_cents,created_at from public.orders where tenant_id=$1 and customer_id=$2 order by created_at desc limit 20 offset $3",
          [ctx.tenantId, id.data, (page - 1) * 20],
        )
      : [];
    const metrics = ctx.permissions.includes("orders.view")
      ? await one<{ count: number; spent: string; average: string }>(
          db,
          "select count(*) filter(where order_status in ('delivered','picked_up'))::int count,coalesce(sum(total_cents) filter(where order_status in ('delivered','picked_up')),0)::text spent,coalesce(round(avg(total_cents) filter(where order_status in ('delivered','picked_up'))),0)::text average from public.orders where tenant_id=$1 and customer_id=$2",
          [ctx.tenantId, id.data],
        )
      : undefined;
    return { customer, addresses, orders, metrics };
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
            <small>Pedidos concluídos</small>
            <h2>{result.metrics.count}</h2>
          </div>
          {ctx.permissions.includes("dashboard.financial") && (
            <>
              <div className="card">
                <small>Total em pedidos concluídos</small>
                <h2>{formatCurrency(Number(result.metrics.spent))}</h2>
              </div>
              <div className="card">
                <small>Ticket médio</small>
                <h2>{formatCurrency(Number(result.metrics.average))}</h2>
              </div>
            </>
          )}
        </div>
      )}
      <section className="card" style={{ padding: 24, marginTop: 20 }}>
        <h2>Endereços</h2>
        {result.addresses.map((a) => (
          <p key={a.id}>
            {a.is_default ? "Padrão · " : ""}
            {a.street}, {a.number} · {a.neighborhood} · {a.city}/{a.state}
          </p>
        ))}
        {!result.addresses.length && <p>Nenhum endereço salvo.</p>}
        <h3>Observações</h3>
        <p>{result.customer.notes || "Nenhuma observação."}</p>
      </section>
      {ctx.permissions.includes("orders.view") && (
        <section className="card" style={{ padding: 24, marginTop: 20 }}>
          <h2>Histórico de pedidos</h2>
          {result.orders.map((o) => (
            <p key={o.id}>
              #{o.order_number} · {orderLabels[o.order_status]} ·{" "}
              {paymentLabels[o.payment_status]} ·{" "}
              {formatCurrency(o.total_cents)} ·{" "}
              {new Date(o.created_at).toLocaleDateString("pt-BR")}
            </p>
          ))}
          {!result.orders.length && <p>Nenhum pedido nesta página.</p>}
          <div className="row between">
            {page > 1 && <Link href={`?page=${page - 1}`}>Anterior</Link>}
            {result.orders.length === 20 && (
              <Link href={`?page=${page + 1}`}>Próxima</Link>
            )}
          </div>
        </section>
      )}
    </>
  );
}
