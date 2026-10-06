"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { AudioRecorder } from "./audio-recorder";
import { useSearchParams } from "next/navigation";
import {
  Send,
  ArrowLeft,
  Ban,
  Bot,
  Check,
  CheckCheck,
  Download,
  FileText,
  MoreVertical,
  Paperclip,
  Search,
  Trash2,
  UserRound,
  Volume2,
} from "lucide-react";
import type { Permission } from "@/lib/permissions";
import { useRealtime } from "./realtime";
import { EmptyState } from "./ui/states";
import { ResponsiveModal } from "./ui/modal";
type Conversation = {
  id: string;
  name: string;
  phone: string;
  status: string;
  bot_paused: boolean;
  blocked: boolean;
  last_message_at?: string | null;
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
  media_mime: string | null;
  media_name: string | null;
  message_type: string;
};
function initials(name: string, phone: string) {
  const words = (name?.trim() || phone).split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] || "C") + (words[1]?.[0] || "")).toUpperCase();
}
function listTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
function MessageStatus({ status }: { status: string }) {
  if (status === "read" || status === "delivered")
    return (
      <CheckCheck
        size={15}
        aria-label={status === "read" ? "Lida" : "Entregue"}
      />
    );
  if (status === "sent") return <Check size={15} aria-label="Enviada" />;
  return null;
}
function MessageMedia({ message }: { message: Message }) {
  if (!message.media_path) return null;
  const source = `/api/media?id=${message.id}&inline=1`;
  const mime = message.media_mime || "";
  if (mime.startsWith("audio/") || message.message_type === "audio")
    return (
      <div className="conversation-audio">
        <Volume2 size={18} aria-hidden="true" />
        <audio controls preload="metadata" src={source}>
          Seu navegador não consegue reproduzir este áudio.
        </audio>
      </div>
    );
  if (mime.startsWith("image/") || message.message_type === "image")
    return (
      <a
        href={source}
        target="_blank"
        rel="noopener noreferrer"
        className="conversation-image"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- mídia autenticada */}
        <img src={source} alt={message.media_name || "Imagem da conversa"} />
      </a>
    );
  if (mime.startsWith("video/") || message.message_type === "video")
    return (
      <video
        controls
        preload="metadata"
        src={source}
        className="conversation-video"
      />
    );
  return (
    <a href={`/api/media?id=${message.id}`} className="conversation-file">
      {mime === "application/pdf" ? (
        <FileText size={22} />
      ) : (
        <Download size={22} />
      )}
      <span>{message.media_name || "Baixar anexo"}</span>
    </a>
  );
}
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
    [listLoaded, setListLoaded] = useState(false),
    [menuOpen, setMenuOpen] = useState(false),
    [confirmAction, setConfirmAction] = useState<
      "archive" | "block" | "unblock" | null
    >(null);
  const messageKey = useRef(crypto.randomUUID());
  const messagesEnd = useRef<HTMLDivElement>(null);
  const lastNewestId = useRef("");
  const lastSelected = useRef("");
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
  useRealtime(tenantId, "conversations", loadList, undefined, 2500);
  useRealtime(
    tenantId,
    "conversation_messages",
    loadDetail,
    selected ? `conversation_id=eq.${selected}` : undefined,
    1500,
  );
  const newestId = messages.at(-1)?.id || "";
  useLayoutEffect(() => {
    if (!newestId) return;
    const conversationChanged = lastSelected.current !== selected;
    if (conversationChanged || lastNewestId.current !== newestId)
      messagesEnd.current?.scrollIntoView({
        block: "end",
        behavior: conversationChanged ? "auto" : "smooth",
      });
    lastSelected.current = selected;
    lastNewestId.current = newestId;
  }, [newestId, selected]);
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
      if (action === "archive") {
        setSelected("");
        setDetail(null);
        setMessages([]);
        await loadList();
      } else {
        await Promise.all([loadList(), loadDetail()]);
      }
      setConfirmAction(null);
      setMenuOpen(false);
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
    setMenuOpen(false);
    lastNewestId.current = "";
    messageKey.current = crypto.randomUUID();
  }
  return (
    <>
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
          <div className="conversation-list-head">
            <strong>Conversas</strong>
            <span>{total}</span>
          </div>
          <div className="conversation-controls">
            <label className="conversation-search">
              <Search size={17} aria-hidden="true" />
              <input
                aria-label="Buscar conversa"
                placeholder="Buscar"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
              />
            </label>
            <select
              aria-label="Filtrar atendimento"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">Todas</option>
              <option value="waiting_human">Aguardando</option>
              <option value="human">Equipe</option>
              <option value="bot">Assistente</option>
              <option value="closed">Finalizadas</option>
            </select>
          </div>
          <div className="conversation-items">
            {!listLoaded && !listError && (
              <p role="status" className="conversation-loading">
                Carregando…
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
                <span className="conversation-avatar">
                  {initials(c.name, c.phone)}
                </span>
                <span className="conversation-item-content">
                  <span className="conversation-item-top">
                    <strong>{c.name || c.phone}</strong>
                    <time>{listTime(c.last_message_at)}</time>
                  </span>
                  <span className="conversation-item-bottom">
                    <span>{c.last_message_preview || "Nova conversa"}</span>
                    {c.unread_count > 0 && <b>{c.unread_count}</b>}
                  </span>
                  <small>
                    {c.blocked
                      ? "Cliente bloqueado"
                      : c.bot_paused
                        ? "Atendimento humano"
                        : "Assistente ativo"}
                  </small>
                </span>
              </button>
            ))}
          </div>
          <div className="conversation-pagination">
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
            <div className="conversation-empty">
              <div className="conversation-empty-icon">
                <Bot size={28} />
              </div>
              <h2>Pedizza Conversas</h2>
              <p>Selecione uma conversa para atender seus clientes.</p>
            </div>
          ) : (
            <>
              <header className="conversation-chat-head">
                <button
                  className="icon-button conversation-back"
                  onClick={() => setSelected("")}
                  aria-label="Voltar à lista"
                >
                  <ArrowLeft size={18} />
                </button>
                <span className="conversation-avatar">
                  {initials(detail.name, detail.phone)}
                </span>
                <div className="conversation-contact">
                  <strong>{detail.name || detail.phone}</strong>
                  <span>
                    {detail.phone} ·{" "}
                    {detail.blocked
                      ? "Bloqueado"
                      : detail.bot_paused
                        ? "Equipe atendendo"
                        : "Assistente ativo"}
                  </span>
                </div>
                <div className="conversation-head-actions">
                  {permissions.includes("conversations.assign") &&
                    !detail.blocked && (
                      <button
                        className="btn secondary small"
                        disabled={busy}
                        onClick={() => action("take")}
                      >
                        <UserRound size={16} /> Assumir
                      </button>
                    )}
                  {permissions.includes("conversations.resume_bot") &&
                    detail.bot_paused &&
                    !detail.blocked && (
                      <button
                        className="btn secondary small"
                        disabled={busy}
                        onClick={() => action("resume")}
                      >
                        <Bot size={16} /> Retomar
                      </button>
                    )}
                  <div className="conversation-menu-wrap">
                    <button
                      className="icon-button"
                      onClick={() => setMenuOpen((value) => !value)}
                      aria-label="Mais opções"
                      aria-expanded={menuOpen}
                    >
                      <MoreVertical size={20} />
                    </button>
                    {menuOpen && (
                      <div className="conversation-menu">
                        <button disabled={busy} onClick={() => action("read")}>
                          <CheckCheck size={17} /> Marcar como lida
                        </button>
                        {permissions.includes("customers.edit") && (
                          <button
                            onClick={() =>
                              setConfirmAction(
                                detail.blocked ? "unblock" : "block",
                              )
                            }
                          >
                            <Ban size={17} />{" "}
                            {detail.blocked
                              ? "Desbloquear cliente"
                              : "Bloquear cliente"}
                          </button>
                        )}
                        {permissions.includes("conversations.archive") && (
                          <button
                            className="danger"
                            onClick={() => setConfirmAction("archive")}
                          >
                            <Trash2 size={17} /> Excluir conversa
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </header>
              <div className="conversation-messages">
                {hasMore && (
                  <button
                    className="conversation-history-button"
                    onClick={() => setHistoryPage((p) => p + 1)}
                  >
                    Carregar mensagens anteriores
                  </button>
                )}
                {messages.map((m) => (
                  <article
                    className={`message-bubble ${m.direction}`}
                    key={m.id}
                  >
                    <MessageMedia message={m} />
                    {m.body && <p>{m.body}</p>}
                    <span className="message-meta">
                      {new Date(m.created_at).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {m.direction === "outbound" && (
                        <MessageStatus status={m.status} />
                      )}
                    </span>
                    {m.status === "failed" && (
                      <small className="message-failed">Falha no envio</small>
                    )}
                  </article>
                ))}
                <div ref={messagesEnd} aria-hidden="true" />
              </div>
              {permissions.includes("conversations.send") &&
                !detail.blocked && (
                  <form
                    className="conversation-composer"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void action("send");
                    }}
                  >
                    <label className="icon-button conversation-attach">
                      <Paperclip size={21} />
                      <input
                        aria-label="Anexar arquivo de até 3 MB"
                        type="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf,audio/mpeg,audio/ogg,audio/wav,audio/webm,audio/mp4,video/mp4"
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
                      aria-label="Mensagem"
                      placeholder="Digite uma mensagem"
                      maxLength={10000}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      rows={1}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          if (text.trim() && !busy) void action("send");
                        }
                      }}
                    />
                    <button
                      className="conversation-send"
                      disabled={busy || !text.trim()}
                      aria-label="Enviar mensagem"
                    >
                      <Send size={20} />
                    </button>
                  </form>
                )}
              {detail.blocked && (
                <div className="conversation-blocked">
                  <Ban size={17} /> Cliente bloqueado. Desbloqueie para
                  responder.
                </div>
              )}
            </>
          )}
        </section>
      </div>
      <ResponsiveModal
        open={confirmAction !== null}
        title={
          confirmAction === "archive"
            ? "Excluir conversa"
            : confirmAction === "unblock"
              ? "Desbloquear cliente"
              : "Bloquear cliente"
        }
        onClose={() => setConfirmAction(null)}
      >
        <div className="stack">
          <p>
            {confirmAction === "archive"
              ? "A conversa será removida desta caixa de entrada."
              : confirmAction === "unblock"
                ? "O cliente poderá voltar a conversar com a loja e receber respostas."
                : "O cliente deixará de receber respostas automáticas e da equipe até ser desbloqueado."}
          </p>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => setConfirmAction(null)}
            >
              Cancelar
            </button>
            <button
              className="btn primary"
              disabled={busy || !confirmAction}
              onClick={() => confirmAction && void action(confirmAction)}
            >
              {busy
                ? "Aguarde…"
                : confirmAction === "archive"
                  ? "Excluir conversa"
                  : confirmAction === "unblock"
                    ? "Desbloquear"
                    : "Bloquear"}
            </button>
          </div>
        </div>
      </ResponsiveModal>
    </>
  );
}
