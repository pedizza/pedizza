"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AudioRecorder } from "./audio-recorder";
import { useSearchParams } from "next/navigation";
import { Send, ArrowLeft } from "lucide-react";
import type { Permission } from "@/lib/permissions";
import { useRealtime } from "./realtime";
import { PageHeader, EmptyState } from "./ui/states";
type Conversation = {
  id: string;
  name: string;
  phone: string;
  status: string;
  bot_paused: boolean;
  last_message_preview: string;
  unread_count: number;
};
type Message = {
  id: string;
  direction: string;
  sender_type: string;
  body: string;
  status: string;
  created_at: string;
  media_path: string | null;
  message_type: string;
};
export function Conversations({
  tenantId,
  permissions,
}: {
  tenantId: string;
  permissions: Permission[];
}) {
  const params = useSearchParams();
  const [selected, setSelected] = useState(params.get("id") || ""),
    [list, setList] = useState<Conversation[]>([]),
    [detail, setDetail] = useState<Conversation | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [q, setQ] = useState(""),
    [status, setStatus] = useState("all"),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [historyPage, setHistoryPage] = useState(1),
    [hasMore, setHasMore] = useState(false),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [listError, setListError] = useState(""),
    [detailError, setDetailError] = useState(""),
    [listLoaded, setListLoaded] = useState(false);
  const messageKey = useRef(crypto.randomUUID());
  const loadList = useCallback(
    () =>
      fetch(
        `/api/conversations?q=${encodeURIComponent(q)}&status=${status}&page=${page}`,
      )
        .then(async (r) => {
          const b = await r.json();
          if (!r.ok) throw Error(b.error);
          setList(b.data);
          setTotal(b.total);
          setListLoaded(true);
          setListError("");
        })
        .catch((e) =>
          setListError(
            e instanceof TypeError
              ? "Não foi possível carregar as conversas. Verifique sua conexão e tente novamente."
              : e.message,
          ),
        ),
    [q, status, page],
  );
  const loadDetail = useCallback(() => {
    if (!selected) return Promise.resolve();
    return fetch(`/api/conversations?id=${selected}&page=${historyPage}`)
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw Error(b.error);
        setDetail(b.conversation);
        setMessages(b.messages);
        setHasMore(b.hasMore);
        setDetailError("");
      })
      .catch((e) =>
        setDetailError(
          e instanceof TypeError
            ? "Não foi possível carregar as mensagens. Verifique sua conexão e tente novamente."
            : e.message,
        ),
      );
  }, [selected, historyPage]);
  useEffect(() => {
    const timer = setTimeout(() => void loadList(), 200);
    return () => clearTimeout(timer);
  }, [loadList]);
  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);
  useRealtime(tenantId, "conversations", loadList);
  useRealtime(
    tenantId,
    "conversation_messages",
    loadDetail,
    selected ? `conversation_id=eq.${selected}` : undefined,
  );
  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      if (file.size > 3 * 1024 * 1024)
        throw Error("O limite para envio é 3 MB.");
      const r = await fetch(
        `/api/media?conversation=${selected}&name=${encodeURIComponent(file.name)}`,
        { method: "POST", body: file },
      );
      const b = await r.json();
      if (!r.ok) throw Error(b.error);
      await loadDetail();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao enviar arquivo.");
    } finally {
      setBusy(false);
    }
  }
  async function action(action: string) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          id: selected,
          ...(action === "send" ? { text, clientId: messageKey.current } : {}),
        }),
      });
      const b = await r.json();
      if (!r.ok) throw Error(b.error);
      if (action === "send") {
        setText("");
        messageKey.current = crypto.randomUUID();
      }
      await Promise.all([loadList(), loadDetail()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tente novamente.");
    } finally {
      setBusy(false);
    }
  }
  function select(c: Conversation) {
    setSelected(c.id);
    setHistoryPage(1);
    setMessages([]);
    setDetail(c);
    setText("");
    messageKey.current = crypto.randomUUID();
  }
  return (
    <>
      <PageHeader
        title="Conversas"
        description="Atenda seus clientes e acompanhe o assistente de pedidos."
      />
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {(listError || detailError) && (
        <div className="alert error" role="alert">
          <p>{listError || detailError}</p>
          <button
            className="btn ghost small"
            onClick={() => void Promise.all([loadList(), loadDetail()])}
          >
            Tentar novamente
          </button>
        </div>
      )}
      <div className={`conversation-layout ${selected ? "has-selection" : ""}`}>
        <aside className="conversation-list card">
          <div className="stack" style={{ padding: 16 }}>
            <input
              aria-label="Buscar conversa"
              placeholder="Buscar nome ou telefone"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
            <select
              aria-label="Filtrar atendimento"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">Todas</option>
              <option value="waiting_human">Aguardando equipe</option>
              <option value="human">Em atendimento</option>
              <option value="bot">Assistente ativo</option>
              <option value="closed">Finalizadas</option>
            </select>
          </div>
          {!listLoaded && !listError && (
            <p role="status" style={{ padding: 16 }}>
              Carregando conversas…
            </p>
          )}
          {listLoaded && !listError && list.length === 0 && (
            <EmptyState
              title="Nenhuma conversa"
              description="Mensagens recebidas pelo WhatsApp aparecerão aqui."
            />
          )}
          {list.map((c) => (
            <button
              key={c.id}
              className={`conversation-item ${c.id === selected ? "active" : ""}`}
              onClick={() => select(c)}
            >
              <div className="row between">
                <strong>{c.name || c.phone}</strong>
                {c.unread_count > 0 && (
                  <span className="badge">{c.unread_count}</span>
                )}
              </div>
              <p>{c.last_message_preview || "Nova conversa"}</p>
              <small>
                {c.bot_paused ? "Atendimento humano" : "Assistente ativo"}
              </small>
            </button>
          ))}
          <div className="row between" style={{ padding: 12 }}>
            <button
              className="btn ghost small"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </button>
            <button
              className="btn ghost small"
              disabled={page * 20 >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </button>
          </div>
        </aside>
        <section className="conversation-detail card">
          {!selected || !detail ? (
            <EmptyState
              title="Selecione uma conversa"
              description="O histórico e as ações de atendimento ficam neste espaço."
            />
          ) : (
            <>
              <header
                className="stack"
                style={{ padding: 16, borderBottom: "1px solid var(--border)" }}
              >
                <div className="row">
                  <button
                    className="icon-button"
                    onClick={() => setSelected("")}
                    aria-label="Voltar à lista"
                  >
                    <ArrowLeft size={18} />
                  </button>
                  <div>
                    <strong>{detail.name || detail.phone}</strong>
                    <small className="muted"> {detail.phone}</small>
                  </div>
                  <span className="badge">
                    {detail.bot_paused ? "Equipe" : "Assistente"}
                  </span>
                </div>
                <div className="row" style={{ flexWrap: "wrap" }}>
                  {permissions.includes("conversations.assign") && (
                    <button
                      className="btn secondary small"
                      disabled={busy}
                      onClick={() => action("take")}
                    >
                      Assumir atendimento
                    </button>
                  )}
                  {permissions.includes("conversations.resume_bot") &&
                    detail.bot_paused && (
                      <button
                        className="btn secondary small"
                        disabled={busy}
                        onClick={() => action("resume")}
                      >
                        Retomar assistente
                      </button>
                    )}
                  <button
                    className="btn ghost small"
                    disabled={busy}
                    onClick={() => action("read")}
                  >
                    Marcar lida
                  </button>
                  {permissions.includes("conversations.archive") && (
                    <button
                      className="btn ghost small"
                      disabled={busy}
                      onClick={() => action("close")}
                    >
                      Finalizar
                    </button>
                  )}
                </div>
              </header>
              <div className="conversation-messages">
                <div className="row between">
                  <button
                    className="btn ghost small"
                    disabled={!hasMore}
                    onClick={() => setHistoryPage((p) => p + 1)}
                  >
                    Mensagens anteriores
                  </button>
                  {historyPage > 1 && (
                    <button
                      className="btn ghost small"
                      onClick={() => setHistoryPage((p) => p - 1)}
                    >
                      Mais recentes
                    </button>
                  )}
                </div>
                {messages.map((m) => (
                  <article
                    className={`message-bubble ${m.direction}`}
                    key={m.id}
                  >
                    <small className="muted">
                      {m.sender_type === "customer"
                        ? "Cliente"
                        : m.sender_type === "bot"
                          ? "Assistente"
                          : m.sender_type === "system"
                            ? "Sistema"
                            : "Equipe"}
                    </small>
                    <p
                      style={{
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {m.body}
                    </p>
                    {m.media_path && (
                      <a
                        href={`/api/media?id=${m.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn secondary small"
                      >
                        Abrir anexo
                      </a>
                    )}
                    <small className="muted">
                      {new Date(m.created_at).toLocaleString("pt-BR")} ·{" "}
                      {(
                        {
                          pending: "Pendente",
                          sent: "Enviada",
                          delivered: "Entregue",
                          read: "Lida",
                          failed: "Falha no envio",
                        } as Record<string, string>
                      )[m.status] || m.status}
                    </small>
                    {m.status === "failed" && (
                      <p>Confira a conexão e o WhatsApp antes de reenviar.</p>
                    )}
                  </article>
                ))}
              </div>
              {permissions.includes("conversations.send") && (
                <form
                  className="row"
                  style={{ padding: 16, borderTop: "1px solid var(--border)" }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action("send");
                  }}
                >
                  <label className="btn secondary small">
                    Anexar
                    <input
                      aria-label="Anexar arquivo de até 3 MB"
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf,audio/mpeg,audio/ogg,audio/wav,video/mp4"
                      disabled={busy}
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void upload(file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <AudioRecorder
                    key={selected}
                    disabled={busy}
                    onRecorded={upload}
                  />
                  <textarea
                    aria-label="Sua mensagem"
                    placeholder="Digite uma mensagem. O envio pausa o assistente."
                    maxLength={10000}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={2}
                    style={{ flex: 1 }}
                  />
                  <button
                    className="btn primary"
                    disabled={busy || !text.trim()}
                    aria-label="Enviar mensagem"
                  >
                    <Send size={18} />
                  </button>
                </form>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
