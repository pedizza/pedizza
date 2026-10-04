"use client";
import { useState, useEffect } from "react";
import Image from "next/image";
import { QrCode, RefreshCw, Unplug, MessageCircle } from "lucide-react";
import { ResponsiveModal } from "./ui/modal";
export function WhatsappSettings({ canManage }: { canManage: boolean }) {
  const [state, setState] = useState<{
      configured: boolean;
      instance: { display_name: string; phone: string; status: string } | null;
    } | null>(null),
    [qr, setQr] = useState(""),
    [expires, setExpires] = useState(""),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false);
  function load() {
    return fetch("/api/whatsapp")
      .then((r) => r.json())
      .then(setState);
  }
  useEffect(() => {
    void load();
  }, []);
  async function act(action: string, phone?: string) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, phone }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setQr(b.base64 || "");
      setExpires(b.expiresAt || "");
      setConfirm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível conectar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      {state && !state.configured && (
        <p className="notice">
          A conexão com o WhatsApp ainda não está configurada. O administrador
          do Pedizza precisa concluir a configuração da integração.
        </p>
      )}
      <div className="card">
        <div className="row between">
          <div className="row">
            <span className="icon-box">
              <MessageCircle size={23} />
            </span>
            <div>
              <h2 style={{ marginBottom: 5 }}>
                {state?.instance?.display_name || "WhatsApp da loja"}
              </h2>
              <small>
                {state?.instance?.phone ||
                  "Conecte o número que atende seus clientes."}
              </small>
            </div>
          </div>
          <span
            className={`badge ${state?.instance?.status === "connected" ? "green" : "amber"}`}
          >
            {state?.instance?.status === "connected"
              ? "Conectado"
              : state?.instance
                ? "Desconectado"
                : "Não conectado"}
          </span>
        </div>
        {canManage && (
          <div className="row" style={{ marginTop: 28 }}>
            <button
              className="btn"
              disabled={busy || !state?.configured}
              onClick={() => setOpen(true)}
            >
              <QrCode size={17} />
              Conectar WhatsApp
            </button>
            {state?.instance && (
              <>
                <button
                  className="btn secondary"
                  disabled={busy}
                  onClick={() => act("refresh")}
                >
                  <RefreshCw size={16} />
                  Verificar conexão
                </button>
                <button
                  className="btn secondary"
                  disabled={busy}
                  onClick={() => setConfirm(true)}
                >
                  <Unplug size={16} />
                  Remover conexão
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {error && (
        <p className="feedback" role="alert">
          {error}
        </p>
      )}
      <ResponsiveModal
        title="Conectar WhatsApp"
        open={open}
        onClose={() => {
          setOpen(false);
          setQr("");
        }}
      >
        {qr ? (
          <>
            <p>
              No WhatsApp, abra{" "}
              <strong>Aparelhos conectados → Conectar um aparelho</strong> e
              leia o QR Code.
            </p>
            <Image
              src={qr.startsWith("data:") ? qr : "data:image/png;base64," + qr}
              alt="QR Code temporário para conectar o WhatsApp"
              width={260}
              height={260}
              unoptimized
              style={{ margin: "auto" }}
            />
            <small>
              O código expira às {new Date(expires).toLocaleTimeString("pt-BR")}
              .
            </small>
            <button
              className="btn"
              disabled={busy}
              onClick={() => act("refresh")}
            >
              Atualizar QR / verificar conexão
            </button>
          </>
        ) : (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void act(
                "connect",
                String(new FormData(e.currentTarget).get("phone")),
              );
            }}
          >
            <label>
              Número do WhatsApp com DDD
              <input
                name="phone"
                type="tel"
                required
                defaultValue={state?.instance?.phone}
                placeholder="(11) 99999-9999"
              />
            </label>
            <p className="muted">
              Use o número de atendimento da pizzaria. Você precisará do celular
              para ler o código.
            </p>
            <button className="btn" disabled={busy}>
              {busy ? "Preparando conexão…" : "Gerar QR Code"}
            </button>
          </form>
        )}
      </ResponsiveModal>
      <ResponsiveModal
        open={confirm}
        title="Remover conexão?"
        onClose={() => setConfirm(false)}
      >
        <p>
          O WhatsApp será desconectado. Os clientes, pedidos e conversas já
          registrados serão preservados.
        </p>
        <button className="btn" disabled={busy} onClick={() => act("remove")}>
          Confirmar remoção
        </button>
      </ResponsiveModal>
    </div>
  );
}
