import Link from "next/link";
import {
  Banknote,
  ClipboardList,
  TrendingUp,
  Users,
  ArrowUpRight,
  MessageCircle,
  Search,
  CalendarDays,
  ChevronDown,
  Bike,
  Store,
  FileText,
  ChartNoAxesColumnIncreasing,
  Trophy,
} from "lucide-react";
import { requirePage } from "@/lib/auth/context";
import { transaction, one, rows } from "@/lib/db";
import { formatCurrency } from "@/lib/domain/money";
import { orderLabels } from "@/lib/domain/orders";
import { PageHeader, EmptyState } from "@/components/ui/states";
import { NotificationBell } from "@/components/notification-bell";
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
      deliveries: number;
      completed: number;
      previous_sales: number;
      previous_orders: number;
      previous_average: number;
      previous_customers: number;
    }>(
      db,
      `with period as (
         select (date_trunc('day',now() at time zone timezone) - ($2::int-1)*interval '1 day') at time zone timezone start_at
         from public.store_settings where tenant_id=$1
       ), bounds as (
         select start_at,
                case when $2::int=1 then now()-interval '1 day' else start_at end previous_end,
                (case when $2::int=1 then now()-interval '1 day' else start_at end) - ($2::int * interval '1 day') previous_start
         from period
       ), summary as (
         select
           coalesce(sum(o.total_cents) filter(where o.order_status in ('delivered','picked_up') and o.created_at>=b.start_at),0)::bigint sales,
           count(*) filter(where o.created_at>=b.start_at)::int orders,
           count(*) filter(where o.order_status in ('delivered','picked_up') and o.created_at>=b.start_at)::int completed,
           coalesce(round(avg(o.total_cents) filter(where o.order_status in ('delivered','picked_up') and o.created_at>=b.start_at)),0)::int average,
           coalesce(sum(o.total_cents) filter(where o.order_status in ('delivered','picked_up') and o.created_at>=b.previous_start and o.created_at<b.previous_end),0)::bigint previous_sales,
           count(*) filter(where o.created_at>=b.previous_start and o.created_at<b.previous_end)::int previous_orders,
           coalesce(round(avg(o.total_cents) filter(where o.order_status in ('delivered','picked_up') and o.created_at>=b.previous_start and o.created_at<b.previous_end)),0)::int previous_average
         from public.orders o cross join bounds b where o.tenant_id=$1
       )
       select summary.*,
         (select count(*)::int from public.customers c cross join bounds b where c.tenant_id=$1 and c.created_at>=b.start_at) customers,
         (select count(*)::int from public.customers c cross join bounds b where c.tenant_id=$1 and c.created_at>=b.previous_start and c.created_at<b.previous_end) previous_customers,
         (select count(*)::int from public.orders o where o.tenant_id=$1 and o.order_status not in ('delivered','picked_up','cancelled','refused')) active,
         (select count(*)::int from public.orders o where o.tenant_id=$1 and o.service_type='delivery' and o.order_status in ('accepted','preparing','ready','out_for_delivery')) deliveries
       from summary`,
      [ctx.tenantId, days],
    );
    const recent = ctx.permissions.includes("orders.view")
      ? await rows<{
          id: string;
          order_number: number;
          customer_name_snapshot: string;
          customer_phone_snapshot: string;
          order_status: string;
          total_cents: number;
          service_type: string;
          created_at: string;
        }>(
          db,
          "select id,order_number,customer_name_snapshot,customer_phone_snapshot,order_status,total_cents,service_type,created_at from public.orders where tenant_id=$1 order by created_at desc limit 3",
          [ctx.tenantId],
        )
      : [];
    const chart = financial
      ? days === 1
        ? await rows<{ day: string; total: number }>(
            db,
            `select lpad(extract(hour from o.created_at at time zone s.timezone)::int::text,2,'0')||'h' day,
                    count(*)::int total
             from public.orders o join public.store_settings s on s.tenant_id=o.tenant_id
             where o.tenant_id=$1 and o.order_status in ('delivered','picked_up')
               and o.created_at >= (date_trunc('day',now() at time zone s.timezone) at time zone s.timezone)
             group by extract(hour from o.created_at at time zone s.timezone)
             order by extract(hour from o.created_at at time zone s.timezone)`,
            [ctx.tenantId],
          )
        : await rows<{ day: string; total: number }>(
            db,
            `select to_char(o.created_at at time zone s.timezone,'DD/MM') as "day",count(*)::int total
             from public.orders o join public.store_settings s on s.tenant_id=o.tenant_id
             where o.tenant_id=$1 and o.order_status in ('delivered','picked_up') and o.created_at>=now()-$2*interval '1 day'
             group by 1 order by min(o.created_at)`,
            [ctx.tenantId, days],
          )
      : [];
    const top = await rows<{ name: string; quantity: number }>(
      db,
      `select i.name_snapshot name,sum(i.quantity)::int quantity from public.order_items i join public.orders o on o.id=i.order_id and o.tenant_id=i.tenant_id where i.tenant_id=$1 and o.order_status in ('delivered','picked_up') and o.created_at>=now()-$2*interval '1 day' group by i.name_snapshot order by quantity desc limit 3`,
      [ctx.tenantId, days],
    );
    const whatsapp = ctx.permissions.includes("whatsapp.view")
      ? await one<{ status: string }>(
          db,
          "select status from public.whatsapp_instances where tenant_id=$1 and archived_at is null",
          [ctx.tenantId],
        )
      : undefined;
    return { stats, recent, chart, top, whatsapp };
  });
  const stats = result.stats;
  const percentChange = (current: number, previous: number) =>
    previous > 0
      ? Math.round(((current - previous) / previous) * 100)
      : current > 0
        ? null
        : 0;
  const cards = [
    ...(financial
      ? [
          {
            label: "Vendas no período",
            value: formatCurrency(Number(stats?.sales || 0)),
            Icon: Banknote,
            note: "Pedidos concluídos",
            detail: `${stats?.completed || 0}`,
            change: percentChange(
              Number(stats?.sales || 0),
              Number(stats?.previous_sales || 0),
            ),
          },
        ]
      : []),
    {
      label: "Pedidos no período",
      value: stats?.orders || 0,
      Icon: ClipboardList,
      note: "Todos os pedidos recebidos",
      change: percentChange(
        Number(stats?.orders || 0),
        Number(stats?.previous_orders || 0),
      ),
    },
    ...(financial
      ? [
          {
            label: "Ticket médio",
            value: formatCurrency(stats?.average || 0),
            Icon: TrendingUp,
            note: "Por pedido concluído",
            change: percentChange(
              Number(stats?.average || 0),
              Number(stats?.previous_average || 0),
            ),
          },
        ]
      : []),
    {
      label: "Novos clientes",
      value: stats?.customers || 0,
      Icon: Users,
      note: "Clientes cadastrados no período",
      change: percentChange(
        Number(stats?.customers || 0),
        Number(stats?.previous_customers || 0),
      ),
    },
  ];
  const chartData =
    days === 1
      ? Array.from({ length: 24 }, (_, hour) => {
          const day = `${String(hour).padStart(2, "0")}h`;
          return {
            day,
            total: Number(
              result.chart.find((point) => point.day === day)?.total || 0,
            ),
          };
        })
      : result.chart.map((point) => ({
          day: point.day,
          total: Number(point.total),
        }));
  const max = Math.max(1, ...chartData.map((point) => point.total));
  const plot = chartData.map((point, index) => ({
    ...point,
    x: 42 + (index * 740) / Math.max(chartData.length - 1, 1),
    y: 154 - (point.total / max) * 125,
  }));
  const linePath = plot
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");
  const areaPath = plot.length
    ? `${linePath} L${plot.at(-1)?.x},154 L${plot[0].x},154 Z`
    : "";
  const dateLabel = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
  return (
    <div className="overview-workspace">
      <div className="dashboard-toolbar">
        {ctx.permissions.includes("orders.view") ? (
          <form action="/app/pedidos" className="dashboard-search">
            <Search size={18} aria-hidden="true" />
            <input
              name="q"
              aria-label="Buscar pedidos, clientes ou produtos"
              placeholder="Buscar pedidos, clientes ou produtos..."
            />
          </form>
        ) : (
          <div />
        )}
        <div className="dashboard-toolbar-controls">
          <div className="period-switch" aria-label="Período do dashboard">
            {[1, 7, 30].map((n) => (
              <Link
                key={n}
                href={`?days=${n}`}
                className={`dashboard-period ${days === n ? "active" : ""}`}
                aria-current={days === n ? "date" : undefined}
              >
                {n === 1 ? "Hoje" : `${n} dias`}
              </Link>
            ))}
          </div>
          <div
            className="dashboard-date"
            aria-label={`Data atual: ${dateLabel}`}
          >
            <CalendarDays size={17} aria-hidden="true" />
            <span>{dateLabel}</span>
            <ChevronDown size={15} aria-hidden="true" />
          </div>
          {ctx.permissions.includes("notifications.view") && (
            <span className="dashboard-notification-bell">
              <NotificationBell tenantId={ctx.tenantId} />
            </span>
          )}
        </div>
      </div>
      <PageHeader
        title={`Olá, ${ctx.tenantName.split(" ")[0]}.`}
        description="Vamos acompanhar o movimento da sua pizzaria?"
      />
      <div className={`stats dashboard-stats count-${cards.length}`}>
        {cards.map((c) => (
          <article
            className={`stat-card ${c.Icon === Banknote ? "stat-sales" : c.Icon === ClipboardList ? "stat-orders" : c.Icon === TrendingUp ? "stat-ticket" : "stat-customers"}`}
            key={c.label}
          >
            <span
              className={`stat-icon ${c.Icon === Banknote ? "sales" : c.Icon === ClipboardList ? "orders" : c.Icon === TrendingUp ? "ticket" : "customers"}`}
            >
              <c.Icon size={23} aria-hidden="true" />
            </span>
            <div className="stat-content">
              <div className="stat-label">
                <span>{c.label}</span>
                <span
                  className={`stat-trend ${c.change === null ? "neutral" : c.change > 0 ? "positive" : c.change < 0 ? "negative" : "neutral"}`}
                >
                  {c.change === null
                    ? "—"
                    : `${c.change > 0 ? "↗" : c.change < 0 || c.Icon === ClipboardList ? "↘" : "↗"} ${Math.abs(c.change)}%`}
                </span>
              </div>
              <div className="stat-value">{c.value}</div>
              <small>
                {c.note}
                {c.detail ? `: ${c.detail}` : ""}
              </small>
            </div>
          </article>
        ))}
      </div>
      <div className="dashboard-grid">
        <div className="stack">
          {financial && (
            <section className="card dashboard-chart-card">
              <div className="card-heading">
                <h2>
                  <ChartNoAxesColumnIncreasing size={19} aria-hidden="true" />
                  Vendas ao longo do período
                </h2>
                <span className="chart-filter">
                  Pedidos concluídos{" "}
                  <ChevronDown size={13} aria-hidden="true" />
                </span>
              </div>
              <div className="dashboard-chart-wrap">
                <svg
                  className="dashboard-chart"
                  viewBox="0 0 800 205"
                  role="img"
                  aria-label={
                    days === 1
                      ? "Vendas concluídas por hora hoje"
                      : "Vendas concluídas por dia no período"
                  }
                  preserveAspectRatio="none"
                >
                  <defs>
                    <linearGradient id="sales-area" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#e21b24" stopOpacity=".16" />
                      <stop offset="100%" stopColor="#e21b24" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {[0, 1, 2, 3, 4].map((line) => {
                    const y = 29 + line * 31;
                    return (
                      <g key={line}>
                        <line x1="42" x2="782" y1={y} y2={y} />
                        <text x="2" y={y + 4}>
                          {Math.round((max * (4 - line)) / 4)}
                        </text>
                      </g>
                    );
                  })}
                  {plot.map((point, index) => {
                    const every =
                      days === 1 ? 2 : Math.max(1, Math.ceil(plot.length / 8));
                    if (
                      index % every !== 0 &&
                      !(days !== 1 && index === plot.length - 1)
                    )
                      return null;
                    return (
                      <g key={`x-${point.day}`}>
                        <line
                          x1={point.x}
                          x2={point.x}
                          y1="20"
                          y2="154"
                          className="chart-guide"
                        />
                        <text x={point.x} y="184" textAnchor="middle">
                          {point.day}
                        </text>
                      </g>
                    );
                  })}
                  <path d={areaPath} fill="url(#sales-area)" />
                  <path d={linePath} className="chart-line" />
                  {plot
                    .filter((_, index) => chartData[index]?.total > 0)
                    .map((point) => (
                      <circle
                        key={`point-${point.day}`}
                        cx={point.x}
                        cy={point.y}
                        r="3.4"
                      />
                    ))}
                </svg>
                {!result.chart.some((point) => Number(point.total) > 0) && (
                  <span className="chart-empty-note">
                    As vendas concluídas aparecerão aqui
                  </span>
                )}
              </div>
            </section>
          )}
          <section className="card">
            <div className="card-heading">
              <h2>
                <FileText size={19} aria-hidden="true" />
                Últimos pedidos
              </h2>
              {ctx.permissions.includes("orders.view") && (
                <Link href="/app/pedidos">
                  Ver todos{" "}
                  <ArrowUpRight size={12} style={{ display: "inline" }} />
                </Link>
              )}
            </div>
            {result.recent.length ? (
              <div
                className={`recent-orders-table ${financial ? "financial" : ""}`}
              >
                <div className="recent-orders-head">
                  <span>#</span>
                  <span>Cliente</span>
                  <span>Status</span>
                  <span>Tipo</span>
                  {financial && <span>Valor</span>}
                  <span>Horário</span>
                </div>
                {result.recent.map((o) => (
                  <Link
                    href="/app/pedidos"
                    className="recent-order-row"
                    key={o.id}
                  >
                    <strong>#{o.order_number}</strong>
                    <span className="recent-order-customer">
                      <strong>{o.customer_name_snapshot}</strong>
                      <small>{o.customer_phone_snapshot}</small>
                    </span>
                    <span
                      className={`recent-order-status status-${o.order_status}`}
                    >
                      <span className="recent-order-status-dot" />
                      {orderLabels[o.order_status]}
                    </span>
                    <span className="recent-order-type">
                      {o.service_type === "delivery" ? (
                        <Bike size={15} aria-hidden="true" />
                      ) : (
                        <Store size={15} aria-hidden="true" />
                      )}
                      {o.service_type === "delivery" ? "Entrega" : "Retirada"}
                    </span>
                    {financial && (
                      <strong>{formatCurrency(o.total_cents)}</strong>
                    )}
                    <span className="recent-order-time">
                      Hoje,{" "}
                      {new Intl.DateTimeFormat("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "America/Sao_Paulo",
                      }).format(new Date(o.created_at))}
                      <ArrowUpRight size={14} aria-hidden="true" />
                    </span>
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
          <section className="card operation-panel">
            <div className="card-heading">
              <h2>
                <FileText size={19} aria-hidden="true" />
                Agora na operação
              </h2>
              <span className="system-online">
                <span /> Sistema online
              </span>
            </div>
            <Link href="/app/pedidos" className="operation-row">
              <span className="operation-icon red">
                <ClipboardList size={17} />
              </span>
              <span>Pedidos em andamento</span>
              <strong>{stats?.active || 0}</strong>
              <ArrowUpRight size={15} />
            </Link>
            {ctx.permissions.includes("whatsapp.view") && (
              <div className="operation-row">
                <span className="operation-icon green">
                  <MessageCircle size={17} />
                </span>
                <span>WhatsApp</span>
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
            <Link href="/app/pedidos" className="operation-row">
              <span className="operation-icon red">
                <Bike size={17} />
              </span>
              <span>Entregas ativas</span>
              <strong>{stats?.deliveries || 0}</strong>
              <ArrowUpRight size={15} />
            </Link>
          </section>
          <section className="card">
            <div className="card-heading">
              <h2>
                <Trophy size={19} aria-hidden="true" />
                Produtos mais vendidos
              </h2>
              <Link href="?days=1" className="chart-filter">
                {days === 1 ? "Hoje" : `${days} dias`}{" "}
                <ChevronDown size={13} aria-hidden="true" />
              </Link>
            </div>
            {result.top.length ? (
              result.top.map((p, i) => (
                <div className="top-product-row" key={p.name}>
                  <span className={`top-product-rank rank-${i + 1}`}>
                    {i + 1}
                  </span>
                  <span>{p.name}</span>
                  <small>{p.quantity} vendas</small>
                  <ArrowUpRight size={14} aria-hidden="true" />
                </div>
              ))
            ) : (
              <EmptyState
                title="Seus favoritos vão aparecer aqui"
                description="O ranking é formado pelos pedidos concluídos."
              />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
