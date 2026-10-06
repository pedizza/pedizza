"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { Printer, MessageCircle, ArrowRight, Search } from "lucide-react";
import type { Order } from "@/lib/services/orders";
import type { Permission } from "@/lib/permissions";
import {
  orderLabels,
  paymentLabels,
  nextOrderStatus,
} from "@/lib/domain/orders";
import { calculateChange, formatCurrency } from "@/lib/domain/money";
import { ResponsiveModal } from "./ui/modal";
import { EmptyState } from "./ui/states";
import { useRealtime } from "./realtime";
type Detail = {
  order: Order;
  items: {
    id: string;
    name_snapshot: string;
    size_name_snapshot: string;
    border_name_snapshot: string;
    quantity: number;
    unit_price_cents: number;
    observation: string;
  }[];
  history: {
    id: string;
    to_status: string;
    created_at: string;
    note: string;
  }[];
};
export function OrdersBoard({
  tenantId,
  permissions,
  autoPrint = false,
  showConversation = true,
  initialOrders = [],
  initialTotal = 0,
  initialObservedAt,
}: {
  tenantId: string;
  permissions: Permission[];
  autoPrint?: boolean;
  showConversation?: boolean;
  initialOrders?: Order[];
  initialTotal?: number;
  initialObservedAt?: string;
}) {
  const [orders, setOrders] = useState<Order[]>(initialOrders),
    [filter, setFilter] = useState(""),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(initialTotal),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [realtimeConnected, setRealtimeConnected] = useState(false),
    [error, setError] = useState(""),
    [detail, setDetail] = useState<Detail | null>(null),
    [action, setAction] = useState<{ order: Order; status: string } | null>(
      null,
    ),
    [busy, setBusy] = useState(false);
  const loading = useRef(false),
    skipInitialLoad = useRef(!!initialObservedAt);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const response = await fetch(
        `/api/orders?status=${filter}&page=${page}&q=${encodeURIComponent(query)}`,
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      const next = body.data as Order[];
      setOrders(next);
      setTotal(body.total);
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Falha ao carregar pedidos.",
      );
    } finally {
      loading.current = false;
    }
  }, [filter, page, query]);
  useEffect(() => {
    if (skipInitialLoad.current) {
      skipInitialLoad.current = false;
      return;
    }
    void load();
  }, [load]);
  useRealtime(tenantId, "orders", () => void load(), undefined, 15000);
  useEffect(() => {
    const onState = (event: Event) =>
      setRealtimeConnected(
        !!(event as CustomEvent<{ connected: boolean }>).detail?.connected,
      );
    const onOrder = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          kind: "insert" | "update" | "delete";
          orderId: string;
          order: Order | null;
        }>
      ).detail;
      if (!detail) return;
      if (page !== 1 || filter || query || !detail.order) {
        void load();
        return;
      }
      setOrders((current) => {
        const exists = current.some((order) => order.id === detail.orderId);
        if (detail.kind === "delete")
          return current.filter((order) => order.id !== detail.orderId);
        if (detail.kind === "insert") {
          if (!exists) setTotal((value) => value + 1);
          return [
            detail.order!,
            ...current.filter((order) => order.id !== detail.orderId),
          ].slice(0, 20);
        }
        return exists
          ? current.map((order) =>
              order.id === detail.orderId ? detail.order! : order,
            )
          : current;
      });
      setError("");
    };
    window.addEventListener("pedizza:realtime-state", onState);
    window.addEventListener("pedizza:order-change", onOrder);
    return () => {
      window.removeEventListener("pedizza:realtime-state", onState);
      window.removeEventListener("pedizza:order-change", onOrder);
    };
  }, [filter, load, page, query]);
  async function inspect(id: string) {
    const r = await fetch("/api/orders?id=" + id);
    const b = await r.json();
    if (r.ok && b.order) setDetail(b);
    else setError(b.error || "Pedido indisponível.");
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!action) return;
    setError("");
    setBusy(true);
    const printWindow =
      autoPrint && action.status === "accepted"
        ? window.open("about:blank", "_blank")
        : null;
    const f = new FormData(e.currentTarget);
    try {
      const r = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: action.order.id,
          action: action.status === "paid" ? "payment" : "status",
          status: action.status,
          minutes: Number(f.get("minutes") || 40),
          note: String(f.get("note") || ""),
        }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      if (b?.id)
        window.dispatchEvent(
          new CustomEvent("pedizza:order-change", {
            detail: { kind: "update", orderId: b.id, order: b },
          }),
        );
      if (printWindow)
        printWindow.location.href = `/app/pedidos/${action.order.id}/imprimir?auto=1`;
      setAction(null);
      setDetail(null);
      setError("");
      await load();
    } catch (e) {
      printWindow?.close();
      setError(e instanceof Error ? e.message : "Falha ao atualizar.");
    } finally {
      setBusy(false);
    }
  }
  const groups = [
    { label: "Novos", statuses: ["new"] },
    { label: "Em preparo", statuses: ["accepted", "preparing"] },
    { label: "Prontos", statuses: ["ready", "ready_for_pickup"] },
    {
      label: "Em entrega / finalizados",
      statuses: [
        "out_for_delivery",
        "delivered",
        "picked_up",
        "cancelled",
        "refused",
      ],
    },
  ];
  return (
    <>
      <div className="toolbar">
        <div className="search">
          <Search size={17} />
          <input
            aria-label="Buscar pedido"
            placeholder="Buscar cliente ou número…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <select
          aria-label="Filtrar status"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(1);
          }}
          style={{ maxWidth: 230 }}
        >
          <option value="">Todas as etapas</option>
          {Object.entries(orderLabels).map(([k, v]) => (
            <option value={k} key={k}>
              {v}
            </option>
          ))}
        </select>
        <span className={`badge ${realtimeConnected ? "green" : "amber"}`}>
          {realtimeConnected ? "Tempo real conectado" : "Reconectando…"}
        </span>
      </div>
      {error && (
        <p className="feedback" role="alert">
          {error}
        </p>
      )}
      {!orders.length ? (
        <div className="card">
          <EmptyState
            title="Nenhum pedido por aqui"
            description="Os pedidos confirmados pelos clientes aparecerão aqui em tempo real."
          />
        </div>
      ) : (
        <div className="kanban">
          {groups.map((g) => (
            <section className="kanban-column" key={g.label}>
              <h2>
                {g.label}
                <span className="badge">
                  {
                    orders.filter((o) => g.statuses.includes(o.order_status))
                      .length
                  }
                </span>
              </h2>
              {orders
                .filter((o) => g.statuses.includes(o.order_status))
                .map((o) => (
                  <article className="order-card" key={o.id}>
                    <div className="row between">
                      <strong>#{o.order_number}</strong>
                      <small>
                        {new Date(o.created_at).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </small>
                    </div>
                    <h3 style={{ margin: "16px 0 5px" }}>
                      {o.customer_name_snapshot}
                    </h3>
                    <small>
                      {o.service_type === "delivery" ? "Entrega" : "Retirada"} ·{" "}
                      {orderLabels[o.order_status]}
                    </small>
                    <div className="row between" style={{ margin: "18px 0" }}>
                      <strong>{formatCurrency(o.total_cents)}</strong>
                      <span
                        className={`badge ${o.payment_status === "paid" ? "green" : "amber"}`}
                      >
                        {paymentLabels[o.payment_status]}
                      </span>
                    </div>
                    {o.payment_method_type === "cash" && o.change_for_cents && (
                      <p style={{ margin: "-8px 0 16px" }}>
                        Troco a devolver:{" "}
                        <strong>
                          {formatCurrency(
                            calculateChange(o.change_for_cents, o.total_cents),
                          )}
                        </strong>
                      </p>
                    )}
                    <button
                      className="btn secondary small"
                      style={{ width: "100%" }}
                      onClick={() => inspect(o.id)}
                    >
                      Ver pedido <ArrowRight size={14} />
                    </button>
                  </article>
                ))}
            </section>
          ))}
        </div>
      )}
      {total > 20 && (
        <div className="pagination">
          <button
            className="btn secondary"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            Anterior
          </button>
          <small>
            Página {page} · {total} pedidos
          </small>
          <button
            className="btn secondary"
            disabled={page * 20 >= total}
            onClick={() => setPage(page + 1)}
          >
            Próxima
          </button>
        </div>
      )}
      <ResponsiveModal
        open={!!detail && !action}
        title={`Pedido #${detail?.order.order_number || ""}`}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <>
            <div className="row between">
              <div>
                <h3>{detail.order.customer_name_snapshot}</h3>
                <small>{detail.order.customer_phone_snapshot}</small>
              </div>
              <span className="badge">
                {orderLabels[detail.order.order_status]}
              </span>
            </div>
            {detail.items.map((i) => (
              <div className="data-row" key={i.id}>
                <div>
                  <strong>
                    {i.quantity}x {i.size_name_snapshot} {i.name_snapshot}
                  </strong>
                  <small>{i.border_name_snapshot}</small>
                  <small>{i.observation}</small>
                </div>
                <strong>
                  {formatCurrency(i.quantity * i.unit_price_cents)}
                </strong>
              </div>
            ))}
            <div className="stack" style={{ gap: 8 }}>
              {[
                ["Subtotal", detail.order.subtotal_cents],
                ["Desconto", -detail.order.discount_cents],
                ["Entrega", detail.order.delivery_fee_cents],
                ["Total", detail.order.total_cents],
              ].map(([l, v]) => (
                <div className="row between" key={l}>
                  <span>{l}</span>
                  <strong>{formatCurrency(Number(v))}</strong>
                </div>
              ))}
            </div>
            <p>
              {detail.order.service_type === "pickup"
                ? "Retirada no local"
                : Object.values(detail.order.delivery_address_snapshot || {})
                    .filter(Boolean)
                    .join(", ")}
            </p>
            <span className="badge">
              {detail.order.payment_method_name_snapshot} ·{" "}
              {paymentLabels[detail.order.payment_status]}
            </span>
            {detail.order.payment_method_type === "cash" &&
              detail.order.change_for_cents && (
                <div className="data-row">
                  <span>
                    Cliente pagará{" "}
                    {formatCurrency(detail.order.change_for_cents)}
                  </span>
                  <strong>
                    Troco:{" "}
                    {formatCurrency(
                      calculateChange(
                        detail.order.change_for_cents,
                        detail.order.total_cents,
                      ),
                    )}
                  </strong>
                </div>
              )}
            <div className="row">
              {nextOrderStatus(
                detail.order.order_status,
                detail.order.service_type,
              ) &&
                permissions.includes(
                  detail.order.order_status === "new"
                    ? "orders.accept"
                    : "orders.update_status",
                ) && (
                  <button
                    className="btn"
                    onClick={() =>
                      setAction({
                        order: detail.order,
                        status: nextOrderStatus(
                          detail.order.order_status,
                          detail.order.service_type,
                        ),
                      })
                    }
                  >
                    {
                      orderLabels[
                        nextOrderStatus(
                          detail.order.order_status,
                          detail.order.service_type,
                        )
                      ]
                    }
                  </button>
                )}
              {detail.order.order_status === "new" &&
                permissions.includes("orders.refuse") && (
                  <button
                    className="btn danger"
                    onClick={() =>
                      setAction({ order: detail.order, status: "refused" })
                    }
                  >
                    Recusar
                  </button>
                )}
              {![
                "new",
                "cancelled",
                "refused",
                "delivered",
                "picked_up",
              ].includes(detail.order.order_status) &&
                permissions.includes("orders.cancel") && (
                  <button
                    className="btn danger"
                    onClick={() =>
                      setAction({ order: detail.order, status: "cancelled" })
                    }
                  >
                    Cancelar pedido
                  </button>
                )}
              {["awaiting_manual_confirmation", "pay_on_delivery"].includes(
                detail.order.payment_status,
              ) &&
                permissions.includes("payments.confirm_manual") && (
                  <button
                    className="btn secondary"
                    onClick={() =>
                      setAction({ order: detail.order, status: "paid" })
                    }
                  >
                    Confirmar recebimento
                  </button>
                )}
              {permissions.includes("orders.print") && (
                <Link
                  className="btn secondary"
                  href={`/app/pedidos/${detail.order.id}/imprimir`}
                  target="_blank"
                >
                  <Printer size={16} />
                  Imprimir
                </Link>
              )}
              {showConversation &&
                detail.order.conversation_id &&
                permissions.includes("conversations.view") && (
                  <Link
                    className="btn secondary"
                    href={"/app/conversas?id=" + detail.order.conversation_id}
                  >
                    <MessageCircle size={16} />
                    Conversar
                  </Link>
                )}
            </div>
            <h3>Histórico</h3>
            {detail.history.map((h) => (
              <div key={h.id}>
                <strong>{orderLabels[h.to_status]}</strong>
                <small>
                  {new Date(h.created_at).toLocaleString("pt-BR")} {h.note}
                </small>
              </div>
            ))}
          </>
        )}
      </ResponsiveModal>
      <ResponsiveModal
        open={!!action}
        title="Confirmar atualização"
        onClose={() => setAction(null)}
      >
        {action && (
          <form onSubmit={submit} className="stack">
            <p>
              Pedido #{action.order.order_number} →{" "}
              <strong>
                {orderLabels[action.status] || "Pagamento recebido"}
              </strong>
            </p>
            {action.status === "accepted" && (
              <label>
                Preparo estimado (minutos)
                <input
                  name="minutes"
                  type="number"
                  min={5}
                  max={300}
                  defaultValue={40}
                  required
                />
              </label>
            )}
            {["refused", "cancelled"].includes(action.status) && (
              <>
                <label>
                  Motivo
                  <textarea
                    name="note"
                    minLength={3}
                    maxLength={500}
                    required
                  />
                </label>
                {action.order.payment_status === "paid" && (
                  <p className="notice">
                    Este pedido já foi pago. Cancelar o pedido não realiza
                    reembolso automático.
                  </p>
                )}
              </>
            )}
            {action.status === "paid" && (
              <p>
                Confirme que você recebeu{" "}
                {formatCurrency(action.order.total_cents)} antes de continuar.
              </p>
            )}
            {error && (
              <p className="feedback" role="alert">
                {error}
              </p>
            )}
            <div className="modal-footer">
              <button
                type="button"
                className="btn secondary"
                onClick={() => setAction(null)}
              >
                Voltar
              </button>
              <button className="btn" disabled={busy}>
                {busy ? "Atualizando…" : "Confirmar"}
              </button>
            </div>
          </form>
        )}
      </ResponsiveModal>
    </>
  );
}
