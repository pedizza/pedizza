import Link from "next/link";
import {
  Banknote,
  ClipboardList,
  TrendingUp,
  Users,
  ArrowUpRight,
  Clock,
  MessageCircle,
} from "lucide-react";
import { requirePage } from "@/lib/auth/context";
import { transaction, one, rows } from "@/lib/db";
import { formatCurrency } from "@/lib/domain/money";
import { orderLabels } from "@/lib/domain/orders";
import { PageHeader, EmptyState } from "@/components/ui/states";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const ctx = await requirePage("dashboard.view");
  const days = [1, 7, 30].includes(Number((await searchParams).days))
    ? Number((await searchParams).days)
    : 1;
  const financial = ctx.permissions.includes("dashboard.financial");
  const result = await transaction(async (db) => {
    const stats = await one<{
      sales: number;
      orders: number;
      average: number;
      customers: number;
      active: number;
    }>(
      db,
      `with period as (select (date_trunc('day',now() at time zone timezone) - ($2::int-1)*interval '1 day') at time zone timezone start_at from public.store_settings where tenant_id=$1), summary as (select coalesce(sum(total_cents) filter(where order_status in ('delivered','picked_up')),0)::bigint sales,count(*)::int orders,coalesce(round(avg(total_cents) filter(where order_status in ('delivered','picked_up'))),0)::int average from public.orders,period where tenant_id=$1 and created_at>=period.start_at) select sales,orders,average,(select count(*)::int from public.customers,period where tenant_id=$1 and created_at>=period.start_at) customers,(select count(*)::int from public.orders where tenant_id=$1 and order_status not in ('delivered','picked_up','cancelled','refused')) active from summary`,
      [ctx.tenantId, days],
    );
    const recent = ctx.permissions.includes("orders.view")
      ? await rows<{
          id: string;
          order_number: number;
          customer_name_snapshot: string;
          order_status: string;
          total_cents: number;
        }>(
          db,
          "select id,order_number,customer_name_snapshot,order_status,total_cents from public.orders where tenant_id=$1 order by created_at desc limit 5",
          [ctx.tenantId],
        )
      : [];
    const customers = ctx.permissions.includes("customers.view")
      ? await rows<{ id: string; name: string; created_at: string }>(
          db,
          "select id,name,created_at from public.customers where tenant_id=$1 and archived_at is null order by created_at desc limit 4",
          [ctx.tenantId],
        )
      : [];
    const chart = financial
      ? await rows<{ day: string; total: number }>(
          db,
          `select to_char(o.created_at at time zone s.timezone,'DD/MM') as "day",sum(o.total_cents)::bigint total from public.orders o join public.store_settings s on s.tenant_id=o.tenant_id where o.tenant_id=$1 and o.order_status in ('delivered','picked_up') and o.created_at>=now()-$2*interval '1 day' group by 1 order by min(o.created_at)`,
          [ctx.tenantId, days],
        )
      : [];
    const top = await rows<{ name: string; quantity: number }>(
      db,
      `select i.name_snapshot name,sum(i.quantity)::int quantity from public.order_items i join public.orders o on o.id=i.order_id and o.tenant_id=i.tenant_id where i.tenant_id=$1 and o.order_status in ('delivered','picked_up') and o.created_at>=now()-$2*interval '1 day' group by i.name_snapshot order by quantity desc limit 5`,
      [ctx.tenantId, days],
    );
    const whatsapp = ctx.permissions.includes("whatsapp.view")
      ? await one<{ status: string }>(
          db,
          "select status from public.whatsapp_instances where tenant_id=$1 and archived_at is null",
          [ctx.tenantId],
        )
      : undefined;
    return { stats, recent, customers, chart, top, whatsapp };
  });
  const stats = result.stats;
  const cards = [
    ...(financial
      ? [
          {
            label: "Vendas no período",
            value: formatCurrency(Number(stats?.sales || 0)),
            Icon: Banknote,
            note: "Pedidos concluídos",
          },
        ]
      : []),
    {
      label: "Pedidos no período",
      value: stats?.orders || 0,
      Icon: ClipboardList,
      note: "Todos os pedidos recebidos",
    },
    ...(financial
      ? [
          {
            label: "Ticket médio",
            value: formatCurrency(stats?.average || 0),
            Icon: TrendingUp,
            note: "Por pedido concluído",
          },
        ]
      : []),
    {
      label: "Novos clientes",
      value: stats?.customers || 0,
      Icon: Users,
      note: "Clientes cadastrados no período",
    },
  ];
  const max = Math.max(1, ...result.chart.map((x) => Number(x.total)));
  return (
    <>
      <PageHeader
        title={`Olá, ${ctx.name.split(" ")[0]}.`}
        description="Vamos acompanhar o movimento da sua pizzaria?"
        action={
          <div className="row">
            {[1, 7, 30].map((n) => (
              <Link
                key={n}
                href={`?days=${n}`}
                className={`btn small ${days === n ? "" : "secondary"}`}
              >
                {n === 1 ? "Hoje" : n + " dias"}
              </Link>
            ))}
          </div>
        }
      />
      <div className="stats">
        {cards.map((c) => (
          <article className="stat-card" key={c.label}>
            <div className="stat-label">
              {c.label}
              <c.Icon size={18} />
            </div>
            <div className="stat-value">{c.value}</div>
            <small>{c.note}</small>
          </article>
        ))}
      </div>
      <div className="dashboard-grid">
        <div className="stack">
          {financial && (
            <section className="card">
              <div className="card-heading">
                <h2>Vendas ao longo do período</h2>
                <span className="badge">Pedidos concluídos</span>
              </div>
              {result.chart.length ? (
                <div className="chart" role="img" aria-label="Vendas por dia">
                  {result.chart.map((v) => (
                    <div
                      className="chart-bar"
                      key={v.day}
                      style={{
                        height: Math.max(4, (Number(v.total) / max) * 175),
                      }}
                      title={`${v.day}: ${formatCurrency(Number(v.total))}`}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="Seu movimento começa no primeiro pedido"
                  description="As vendas concluídas vão dar vida a este gráfico."
                />
              )}
            </section>
          )}
          <section className="card">
            <div className="card-heading">
              <h2>Últimos pedidos</h2>
              {ctx.permissions.includes("orders.view") && (
                <Link href="/app/pedidos">
                  Ver todos{" "}
                  <ArrowUpRight size={12} style={{ display: "inline" }} />
                </Link>
              )}
            </div>
            {result.recent.length ? (
              <div className="data-list">
                {result.recent.map((o) => (
                  <Link href="/app/pedidos" className="data-row" key={o.id}>
                    <div>
                      <strong>
                        #{o.order_number} · {o.customer_name_snapshot}
                      </strong>
                      <small>{orderLabels[o.order_status]}</small>
                    </div>
                    {financial && (
                      <strong>{formatCurrency(o.total_cents)}</strong>
                    )}
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState
                title="Nenhum pedido ainda"
                description="Os últimos pedidos da sua loja aparecerão aqui."
              />
            )}
          </section>
        </div>
        <div className="stack">
          <section className="card">
            <div className="card-heading">
              <h2>Agora na operação</h2>
              <Clock size={17} className="muted" />
            </div>
            <div className="row between">
              <span className="muted">Pedidos em andamento</span>
              <strong>{stats?.active || 0}</strong>
            </div>
            {ctx.permissions.includes("whatsapp.view") && (
              <div className="row between" style={{ marginTop: 20 }}>
                <span className="row muted">
                  <MessageCircle size={16} />
                  WhatsApp
                </span>
                <span
                  className={`badge ${result.whatsapp?.status === "connected" ? "green" : "amber"}`}
                >
                  {result.whatsapp?.status === "connected"
                    ? "Conectado"
                    : result.whatsapp
                      ? "Desconectado"
                      : "Não configurado"}
                </span>
              </div>
            )}
          </section>
          <section className="card">
            <div className="card-heading">
              <h2>Produtos mais vendidos</h2>
            </div>
            {result.top.length ? (
              result.top.map((p, i) => (
                <div className="data-row" key={p.name}>
                  <span className="badge">{i + 1}</span>
                  <span>{p.name}</span>
                  <strong>{p.quantity}</strong>
                </div>
              ))
            ) : (
              <EmptyState
                title="Seus favoritos vão aparecer aqui"
                description="O ranking é formado pelos pedidos concluídos."
              />
            )}
          </section>
          <section className="card">
            <div className="card-heading">
              <h2>Clientes recentes</h2>
              {ctx.permissions.includes("customers.view") && (
                <Link href="/app/clientes">Ver todos</Link>
              )}
            </div>
            {result.customers.length ? (
              result.customers.map((c) => (
                <div className="row" key={c.id} style={{ marginTop: 15 }}>
                  <span className="avatar">
                    {c.name.slice(0, 2).toUpperCase() || "CL"}
                  </span>
                  <div>
                    <strong>{c.name || "Cliente"}</strong>
                    <small>
                      {new Date(c.created_at).toLocaleDateString("pt-BR")}
                    </small>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState
                title="Novas histórias por aqui"
                description="Seus clientes aparecerão conforme forem cadastrados."
              />
            )}
          </section>
        </div>
      </div>
    </>
  );
}
