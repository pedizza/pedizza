"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  Printer,
  MessageCircle,
  ArrowRight,
  Search,
  Inbox,
  ChefHat,
  CircleCheck,
  Bike,
  Store,
  PackageCheck,
  CheckCheck,
  Ban,
  CircleX,
} from "lucide-react";
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
  initialQuery = "",
}: {
  tenantId: string;
  permissions: Permission[];
  autoPrint?: boolean;
  showConversation?: boolean;
  initialOrders?: Order[];
  initialTotal?: number;
  initialObservedAt?: string;
  initialQuery?: string;
}) {
  const [orders, setOrders] = useState<Order[]>(initialOrders),
    [filter, setFilter] = useState(""),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(initialTotal),
    [search, setSearch] = useState(initialQuery),
    [query, setQuery] = useState(initialQuery),
    [error, setError] = useState(""),
    [detail, setDetail] = useState<Detail | null>(null),
    [action, setAction] = useState<{ order: Order; status: string } | null>(
      null,
    ),
    [busy, setBusy] = useState(false);
  const loading = useRef(false),
    skipInitialLoad = useRef(!!initialObservedAt && !initialQuery);

  function prepareAction(order: Order, status: string) {
    setAction({ order, status });
  }

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
    window.addEventListener("pedizza:order-change", onOrder);
    return () => {
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
        ? window.open(
            "about:blank",
            "pedizza-print-popup",
            "popup=yes,width=480,height=720,resizable=yes,scrollbars=yes",
          )
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
    {
      label: "Novos",
      description: "Pedidos recebidos agora",
      Icon: Inbox,
      statuses: ["new"],
    },
    {
      label: "Aceitos",
      description: "Aguardando início do preparo",
      Icon: CircleCheck,
      statuses: ["accepted"],
    },
    {
      label: "Em preparo",
      description: "Pedidos sendo preparados",
      Icon: ChefHat,
      statuses: ["preparing"],
    },
    {
      label: "Prontos",
      description: "Aguardando envio ao cliente",
      Icon: PackageCheck,
      statuses: ["ready"],
    },
    {
      label: "Prontos para retirada",
      description: "Aguardando retirada no balcão",
      Icon: Store,
      statuses: ["ready_for_pickup"],
    },
    {
      label: "Em entrega",
      description: "A caminho do cliente",
      Icon: Bike,
      statuses: ["out_for_delivery"],
    },
    {
      label: "Entregues",
      description: "Concluídos no endereço",
      Icon: CheckCheck,
      statuses: ["delivered"],
    },
    {
      label: "Retirados",
      description: "Concluídos no balcão",
      Icon: Store,
      statuses: ["picked_up"],
    },
    {
      label: "Cancelados",
      description: "Pedidos cancelados pela loja",
      Icon: Ban,
      statuses: ["cancelled"],
    },
    {
      label: "Recusados",
      description: "Pedidos não aceitos",
      Icon: CircleX,
      statuses: ["refused"],
    },
  ];
  return (
    <div className="orders-workspace">
      <div className="toolbar orders-toolbar">
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
          <span className="orders-search-shortcut" aria-hidden="true">
            ⌘ K
          </span>
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
          {groups.map((g, groupIndex) => (
            <section
              className={`kanban-column stage-${groupIndex}`}
              key={g.label}
            >
              <h2>
                <span className="kanban-heading-icon">
                  <g.Icon size={18} aria-hidden="true" />
                </span>
                <span className="kanban-heading-copy">
                  <strong>{g.label}</strong>
                  <small>{g.description}</small>
                </span>
                <span className="badge">
                  {
                    orders.filter((o) => g.statuses.includes(o.order_status))
                      .length
                  }
                </span>
              </h2>
              {!orders.some((order) =>
                g.statuses.includes(order.order_status),
              ) && (
                <div className="kanban-empty">
                  <g.Icon size={25} />
                  <span>Nenhum pedido nesta etapa</span>
                </div>
              )}
              {orders
                .filter((o) => g.statuses.includes(o.order_status))
                .map((o) => {
                  const nextStatus = nextOrderStatus(
                    o.order_status,
                    o.service_type,
                  );
                  const canAdvance =
                    !!nextStatus &&
                    permissions.includes(
                      o.order_status === "new"
                        ? "orders.accept"
                        : "orders.update_status",
                    );
                  const canRefuse =
                    o.order_status === "new" &&
                    permissions.includes("orders.refuse");
                  const canCancel =
                    ![
                      "new",
                      "cancelled",
                      "refused",
                      "delivered",
                      "picked_up",
                    ].includes(o.order_status) &&
                    permissions.includes("orders.cancel");
                  return (
                    <article className="order-card" key={o.id}>
                      <div className="row between">
                        <strong className="order-number">
                          #{o.order_number}
                        </strong>
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
                      <div className="order-service">
                        <span>
                          {o.service_type === "delivery" ? (
                            <Bike size={14} />
                          ) : (
                            <Store size={14} />
                          )}
                          {o.service_type === "delivery"
                            ? "Entrega"
                            : "Retirada"}
                        </span>
                        <small>{orderLabels[o.order_status]}</small>
                      </div>
                      <div className="row between order-payment">
                        <strong>{formatCurrency(o.total_cents)}</strong>
                        <span
                          className={`badge ${o.payment_status === "paid" ? "green" : "amber"}`}
                        >
                          {paymentLabels[o.payment_status]}
                        </span>
                      </div>
                      {o.payment_method_type === "cash" &&
                        o.change_for_cents && (
                          <p style={{ margin: "-8px 0 16px" }}>
                            Troco a devolver:{" "}
                            <strong>
                              {formatCurrency(
                                calculateChange(
                                  o.change_for_cents,
                                  o.total_cents,
                                ),
                              )}
                            </strong>
                          </p>
                        )}
                      <div className="order-card-actions">
                        {canAdvance && (
                          <button
                            className="btn small"
                            onClick={() => prepareAction(o, nextStatus)}
                          >
                            {o.order_status === "new"
                              ? "Aceitar pedido"
                              : orderLabels[nextStatus]}
                            <ArrowRight size={14} />
                          </button>
                        )}
                        {canRefuse && (
                          <button
                            className="btn danger small"
                            onClick={() => prepareAction(o, "refused")}
                          >
                            Recusar
                          </button>
                        )}
                        {canCancel && (
                          <button
                            className="btn danger small"
                            onClick={() => prepareAction(o, "cancelled")}
                          >
                            Cancelar
                          </button>
                        )}
                        <button
                          className="btn secondary small order-details-action"
                          onClick={() => inspect(o.id)}
                        >
                          {o.order_status === "new"
                            ? "Conferir pedido"
                            : "Ver detalhes"}
                        </button>
                        {permissions.includes("orders.print") && (
                          <Link
                            className="btn secondary small order-print-action"
                            href={`/app/pedidos/${o.id}/imprimir`}
                            target="_blank"
                            aria-label={`Imprimir pedido ${o.order_number}`}
                            title="Imprimir pedido"
                          >
                            <Printer size={15} />
                          </Link>
                        )}
                      </div>
                    </article>
                  );
                })}
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
    </div>
  );
}
