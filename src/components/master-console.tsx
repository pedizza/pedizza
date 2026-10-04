"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "./ui/states";
import { formatCurrency } from "@/lib/domain/money";
type Tenant = {
  id: string;
  name: string;
  manually_suspended: boolean;
  status: string;
  current_period_end: string | null;
};
type State = {
  overview: {
    tenants: number;
    active: number;
    paid_month_cents: string;
    failed_webhooks: number;
    failed_jobs: number;
  };
  tenants: Tenant[];
  total: number;
  audit: { id: string; action: string; created_at: string }[];
};
export function MasterConsole() {
  const [state, setState] = useState<State | null>(null),
    [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [support, setSupport] = useState<{
      id: string;
      tenantId: string;
      orders: {
        id: string;
        order_number: number;
        order_status: string;
        payment_status: string;
        total_cents: number;
      }[];
      whatsapp: { status: string } | null;
    } | null>(null);
  const load = useCallback(
    () =>
      fetch(`/api/master?q=${encodeURIComponent(q)}&page=${page}`)
        .then(async (r) => {
          const b = await r.json();
          if (!r.ok) throw Error(b.error);
          setState(b);
        })
        .catch((e) => setError(e.message)),
    [q, page],
  );
  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);
  async function action(action: string, tenantId?: string, id?: string) {
    const reason =
      action === "end_support"
        ? ""
        : prompt("Informe o motivo desta ação (mínimo 10 caracteres):");
    if (reason === null) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...(tenantId ? { tenantId, reason } : { id }),
        }),
      });
      const b = await r.json();
      if (!r.ok) throw Error(b.error);
      if (b.supportId) {
        const response = await fetch("/api/master?support=" + b.supportId);
        const result = await response.json();
        if (!response.ok) throw Error(result.error);
        setSupport(result.support);
      }
      if (action === "end_support") setSupport(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha na operação.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: 28 }}>
      <Link href="/app">← Minha conta</Link>
      <PageHeader
        title="Pedizza Master"
        description="Administração da plataforma. As ações são registradas em auditoria."
      />
      {error && (
        <p role="alert" className="feedback">
          {error}
        </p>
      )}
      {state && (
        <>
          <div className="stats">
            {[
              ["Pizzarias", state.overview.tenants],
              ["Assinaturas ativas", state.overview.active],
              [
                "Recebido no mês",
                formatCurrency(Number(state.overview.paid_month_cents)),
              ],
              [
                "Falhas pendentes",
                state.overview.failed_jobs + state.overview.failed_webhooks,
              ],
            ].map(([label, value]) => (
              <div className="card" key={label}>
                <small>{label}</small>
                <h2>{value}</h2>
              </div>
            ))}
          </div>
          <input
            aria-label="Buscar pizzaria"
            placeholder="Buscar pizzaria"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            style={{ margin: "24px 0" }}
          />
          <div className="stack">
            {state.tenants.map((t) => (
              <article
                className="card row between"
                key={t.id}
                style={{ padding: 20, flexWrap: "wrap" }}
              >
                <div>
                  <h3>{t.name}</h3>
                  <p>
                    {t.manually_suspended
                      ? "Suspensa administrativamente"
                      : t.status}{" "}
                    ·{" "}
                    {t.current_period_end
                      ? new Date(t.current_period_end).toLocaleDateString(
                          "pt-BR",
                        )
                      : "Sem período pago"}
                  </p>
                </div>
                <div className="row">
                  <button
                    className="btn secondary"
                    disabled={busy}
                    onClick={() =>
                      action(
                        t.manually_suspended ? "reactivate" : "suspend",
                        t.id,
                      )
                    }
                  >
                    {t.manually_suspended ? "Remover suspensão" : "Suspender"}
                  </button>
                  <button
                    className="btn secondary"
                    disabled={busy}
                    onClick={() => action("support", t.id)}
                  >
                    Suporte
                  </button>
                </div>
              </article>
            ))}
          </div>
          <div className="row between" style={{ margin: "20px 0" }}>
            <button
              className="btn secondary"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </button>
            <span>Página {page}</span>
            <button
              className="btn secondary"
              disabled={page * 20 >= state.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </button>
          </div>
          {support && (
            <section
              className="card stack"
              style={{ padding: 24, marginBottom: 24 }}
            >
              <h2>Suporte — consulta por 15 minutos</h2>
              <p>
                Loja: {support.tenantId} · WhatsApp:{" "}
                {support.whatsapp?.status || "Não configurado"}
              </p>
              {support.orders.map((o) => (
                <p key={o.id}>
                  #{o.order_number} · {o.order_status} · {o.payment_status} ·{" "}
                  {formatCurrency(o.total_cents)}
                </p>
              ))}
              <button
                className="btn"
                disabled={busy}
                onClick={() => action("end_support", undefined, support.id)}
              >
                Encerrar suporte
              </button>
            </section>
          )}
          <section className="card" style={{ padding: 24 }}>
            <h2>Auditoria administrativa</h2>
            {state.audit.map((a) => (
              <p key={a.id}>
                {new Date(a.created_at).toLocaleString("pt-BR")} · {a.action}
              </p>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
