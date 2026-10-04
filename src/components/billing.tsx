"use client";
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, CheckCircle2, ShieldCheck } from "lucide-react";
import { formatCurrency } from "@/lib/domain/money";
export function Billing({
  status,
  lifetime = false,
  price,
  period,
  canManage,
  configured,
}: {
  status: string;
  lifetime?: boolean;
  price: number;
  period: string | null;
  canManage: boolean;
  configured: boolean;
}) {
  const [charge, setCharge] = useState<{
      pix_copy_paste: string;
      amount_cents: number;
      expires_at: string;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false);
  async function create() {
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const r = await fetch("/api/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setCharge(b);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Não foi possível gerar a cobrança.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid-2">
      <section className="card">
        <span className="eyebrow">PLANO PEDIZZA</span>
        <h1 style={{ fontSize: 45, margin: "20px 0 8px" }}>
          {lifetime ? "Vitalício" : formatCurrency(price)}
          {!lifetime && (
            <small style={{ display: "inline", marginLeft: 8 }}>/mês</small>
          )}
        </h1>
        <p className="muted">
          Uma plataforma para cuidar de toda a sua pizzaria.
        </p>
        <div className="stack" style={{ margin: "25px 0", gap: 13 }}>
          {[
            "Pedidos e atendimento no mesmo lugar",
            "Cardápio, clientes e entrega",
            "Equipe com acesso personalizado",
            "Seu espaço seguro, em qualquer tela",
          ].map((t) => (
            <div className="row" key={t}>
              <CheckCircle2 size={17} color="var(--green)" />
              {t}
            </div>
          ))}
        </div>
        <span className={`badge ${status === "active" ? "green" : "amber"}`}>
          {(
            {
              active: "Ativa",
              pending: "Aguardando pagamento",
              past_due: "Pagamento pendente",
              suspended: "Suspensa",
              cancelled: "Cancelada",
            } as Record<string, string>
          )[status] || status}
        </span>
        {period && (
          <p className="muted" style={{ marginTop: 15 }}>
            Período atual até {new Date(period).toLocaleDateString("pt-BR")}.
          </p>
        )}
        {canManage && !lifetime && status !== "active" && (
          <button
            className="btn"
            style={{ width: "100%", marginTop: 25 }}
            onClick={create}
            disabled={busy || !configured}
          >
            {busy ? "Gerando cobrança…" : "Regularizar assinatura"}
          </button>
        )}
        {!configured && !lifetime && (
          <p className="notice" style={{ marginTop: 20 }}>
            O pagamento da assinatura está aguardando configuração. Seus dados
            permanecem protegidos.
          </p>
        )}
      </section>
      <section className="card">
        <span className="icon-box">
          <ShieldCheck size={24} />
        </span>
        <h2 style={{ marginTop: 20 }}>
          {lifetime ? "Acesso vitalício" : "Pagamento da assinatura"}
        </h2>
        <p className="muted">
          {lifetime
            ? "Esta loja possui acesso sem vencimento e sem mensalidade."
            : "A liberação acontece após a confirmação da BravoPay. Voltar para esta página não altera o status da assinatura."}
        </p>
        {charge && (
          <div className="stack">
            <strong>{formatCurrency(charge.amount_cents)}</strong>
            {charge.pix_copy_paste && (
              <figure style={{ margin: "8px 0", textAlign: "center" }}>
                <QRCodeSVG
                  value={charge.pix_copy_paste}
                  size={280}
                  marginSize={4}
                  level="M"
                  title="QR Code para pagar a assinatura via PIX"
                  role="img"
                  style={{ maxWidth: "100%", height: "auto" }}
                />
                <figcaption className="muted">
                  Abra o aplicativo do seu banco e escaneie o QR Code para
                  pagar.
                </figcaption>
              </figure>
            )}
            <label>
              PIX copia e cola
              <textarea readOnly value={charge.pix_copy_paste || ""} />
            </label>
            <button
              className="btn secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(charge.pix_copy_paste);
                setCopied(true);
              }}
            >
              <Copy size={16} />
              {copied ? "Copiado" : "Copiar código PIX"}
            </button>
            <small>
              Após pagar, atualize a página para consultar a liberação.
            </small>
            <button className="btn" onClick={() => window.location.reload()}>
              Verificar assinatura
            </button>
          </div>
        )}
        {error && (
          <p className="feedback" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
