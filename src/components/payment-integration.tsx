"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
export function PaymentIntegration({ canManage }: { canManage: boolean }) {
  const [state, setState] = useState<{
      connected: boolean;
      configured: boolean;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const params = useSearchParams();
  useEffect(() => {
    fetch("/api/integrations/mercado-pago")
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw Error(b.error);
        setState(b);
      })
      .catch((e) => setError(e.message));
  }, []);
  async function act(action: string) {
    if (
      action === "disconnect" &&
      !confirm(
        "Desconectar o Mercado Pago? O PIX automático será desativado. Pagamentos pendentes precisarão de conferência.",
      )
    )
      return;
    setBusy(true);
    try {
      const r = await fetch("/api/integrations/mercado-pago", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const b = await r.json();
      if (!r.ok) throw Error(b.error);
      if (b.url) window.location.assign(b.url);
      else setState((s) => (s ? { ...s, connected: false } : s));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tente novamente.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card stack" style={{ padding: 24, marginBottom: 24 }}>
      <h2>Mercado Pago</h2>
      <p>
        Conecte a conta da sua pizzaria para gerar PIX e receber a confirmação
        automática dos pagamentos.
      </p>
      <span className="badge">
        {state?.connected
          ? "Conta conectada"
          : state?.configured
            ? "Aguardando conexão"
            : "Configuração pendente"}
      </span>
      {params.get("result") === "failed" && (
        <p role="alert">A conexão não foi concluída. Tente novamente.</p>
      )}
      {error && <p role="alert">{error}</p>}
      {canManage && (
        <button
          className="btn secondary"
          disabled={busy || !state?.configured}
          onClick={() => act(state?.connected ? "disconnect" : "connect")}
        >
          {state?.connected ? "Desconectar conta" : "Conectar Mercado Pago"}
        </button>
      )}
    </section>
  );
}
