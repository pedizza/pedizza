"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { SlidersHorizontal, Trash2 } from "lucide-react";
import { EmptyState } from "./ui/states";
import { useRealtime } from "./realtime";
import { ResponsiveModal } from "./ui/modal";
type Preferences = {
  sound_enabled: boolean;
  push_enabled: boolean;
  orders_enabled: boolean;
  messages_enabled: boolean;
  whatsapp_enabled: boolean;
};
type Notice = {
  id: string;
  title: string;
  body: string;
  action_url: string;
  read_at: string | null;
  created_at: string;
};
const defaults: Preferences = {
  sound_enabled: false,
  push_enabled: false,
  orders_enabled: true,
  messages_enabled: true,
  whatsapp_enabled: true,
};
export function Notifications({ tenantId }: { tenantId: string }) {
  const [items, setItems] = useState<Notice[]>([]),
    [preferences, setPreferences] = useState(defaults),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [unread, setUnread] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [preferencesOpen, setPreferencesOpen] = useState(false),
    [deleteOpen, setDeleteOpen] = useState(false),
    [configured, setConfigured] = useState(false);
  const load = useCallback(() => {
    return fetch(`/api/notifications?page=${page}`)
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw Error(b.error);
        setItems(b.data);
        setTotal(b.total);
        setUnread(b.unread);
        setPreferences(b.preferences || defaults);
        setConfigured(b.pushConfigured);
      })
      .catch((e) => setError(e.message));
  }, [page]);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime(tenantId, "notifications", load);
  async function post(body: unknown) {
    setError("");
    const r = await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const b = await r.json();
    if (!r.ok) throw Error(b.error);
    await load();
  }
  async function run(body: unknown) {
    setBusy(true);
    try {
      await post(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tente novamente.");
    } finally {
      setBusy(false);
    }
  }
  async function enablePush() {
    setBusy(true);
    setError("");
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window))
        throw Error(
          "Este navegador não oferece notificações push. No iPhone, instale o aplicativo na tela inicial.",
        );
      if ((await Notification.requestPermission()) !== "granted")
        throw Error("Permita as notificações nas configurações do navegador.");
      const reg = await navigator.serviceWorker.ready;
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) throw Error("Push ainda não configurado.");
      const raw = atob(key.replace(/-/g, "+").replace(/_/g, "/"));
      const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
      const subscription =
        (await reg.pushManager.getSubscription()) ||
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: bytes,
        }));
      await post({ action: "subscribe", subscription: subscription.toJSON() });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível ativar.");
    } finally {
      setBusy(false);
    }
  }
  async function deleteHistory() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/notifications", { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw Error(body.error);
      setDeleteOpen(false);
      setPage(1);
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Não foi possível excluir.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="notifications-toolbar">
        <button
          className="btn secondary"
          onClick={() => setPreferencesOpen(true)}
        >
          <SlidersHorizontal size={16} /> Minhas preferências
        </button>
        <div className="row">
          <button
            className="btn secondary"
            disabled={busy || !unread}
            onClick={() => run({ action: "read" })}
          >
            Marcar todas como lidas
          </button>
          <button
            className="btn ghost danger-text"
            disabled={busy || !total}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 size={16} /> Excluir histórico
          </button>
        </div>
      </div>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      <div className="card">
        {items.length === 0 ? (
          <EmptyState
            title="Tudo em dia"
            description="Suas próximas notificações aparecerão aqui."
          />
        ) : (
          items.map((n) => (
            <article
              key={n.id}
              style={{
                padding: 20,
                borderBottom: "1px solid var(--border)",
                background: n.read_at ? undefined : "var(--surface-soft)",
              }}
            >
              <div className="row between">
                <strong>{n.title}</strong>
                <time className="muted">
                  {new Date(n.created_at).toLocaleString("pt-BR")}
                </time>
              </div>
              <p>{n.body}</p>
              <div className="row">
                {n.action_url.startsWith("/app/") &&
                  !n.action_url.startsWith("//") && (
                    <Link
                      href={n.action_url}
                      className="btn ghost small"
                      onClick={() => void run({ action: "read", id: n.id })}
                    >
                      Ver detalhes
                    </Link>
                  )}
                {!n.read_at && (
                  <button
                    disabled={busy}
                    className="btn ghost small"
                    onClick={() => run({ action: "read", id: n.id })}
                  >
                    Marcar como lida
                  </button>
                )}
              </div>
            </article>
          ))
        )}
      </div>
      <div className="row between" style={{ marginTop: 16 }}>
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
          disabled={page * 20 >= total}
          onClick={() => setPage((p) => p + 1)}
        >
          Próxima
        </button>
      </div>
      <ResponsiveModal
        open={preferencesOpen}
        title="Minhas preferências"
        onClose={() => setPreferencesOpen(false)}
      >
        <div className="stack notification-preferences">
          {(
            [
              "orders_enabled",
              "messages_enabled",
              "whatsapp_enabled",
              "sound_enabled",
            ] as const
          ).map((key, index) => (
            <label className="preference-option" key={key}>
              <span>
                <strong>
                  {
                    [
                      "Pedidos",
                      "Conversas",
                      "Conexão WhatsApp",
                      "Som de alerta",
                    ][index]
                  }
                </strong>
                <small>
                  {
                    [
                      "Receba avisos sobre novos pedidos e mudanças de status.",
                      "Receba avisos sobre novas mensagens dos clientes.",
                      "Acompanhe alterações na conexão do WhatsApp.",
                      "Toque um alerta quando houver um novo pedido.",
                    ][index]
                  }
                </small>
              </span>
              <input
                type="checkbox"
                checked={preferences[key]}
                disabled={busy}
                onChange={(event) =>
                  run({
                    action: "preferences",
                    preferences: {
                      ...preferences,
                      [key]: event.target.checked,
                    },
                  })
                }
              />
            </label>
          ))}
          {configured && (
            <div className="preference-push">
              <div>
                <strong>Notificações neste dispositivo</strong>
                <small>
                  Receba avisos mesmo com o Pedizza em segundo plano.
                </small>
              </div>
              {preferences.push_enabled ? (
                <button
                  className="btn secondary"
                  disabled={busy}
                  onClick={() =>
                    run({
                      action: "preferences",
                      preferences: { ...preferences, push_enabled: false },
                    })
                  }
                >
                  Pausar push
                </button>
              ) : (
                <button className="btn" disabled={busy} onClick={enablePush}>
                  Ativar push
                </button>
              )}
            </div>
          )}
        </div>
      </ResponsiveModal>
      <ResponsiveModal
        open={deleteOpen}
        title="Excluir histórico de notificações?"
        onClose={() => setDeleteOpen(false)}
      >
        <div className="stack">
          <p>
            Todas as notificações desta conta serão removidas permanentemente.
          </p>
          <div className="modal-actions">
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => setDeleteOpen(false)}
            >
              Cancelar
            </button>
            <button
              className="btn danger"
              disabled={busy}
              onClick={() => void deleteHistory()}
            >
              <Trash2 size={16} /> Excluir histórico
            </button>
          </div>
        </div>
      </ResponsiveModal>
    </>
  );
}
