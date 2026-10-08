"use client";
import { useState } from "react";
import Link from "next/link";
import { Check, Copy, ExternalLink, Eye, Link2, Radio } from "lucide-react";

export function PublicMenuSettings({
  slug: initialSlug,
  enabled: initialEnabled,
  canEdit,
}: {
  slug: string;
  enabled: boolean;
  canEdit: boolean;
}) {
  const [slug, setSlug] = useState(initialSlug);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [savedSlug, setSavedSlug] = useState(initialSlug);
  const [savedEnabled, setSavedEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const address =
    typeof window === "undefined"
      ? `https://www.pedizza.com.br/cardapio/${savedSlug}`
      : `${window.location.origin}/cardapio/${savedSlug}`;
  const hasChanges = slug !== savedSlug || enabled !== savedEnabled;
  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    setCopied(false);
    try {
      const response = await fetch("/api/public/menu-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, enabled }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Não foi possível salvar o link.");
      setSlug(body.public_menu_slug);
      setEnabled(body.public_menu_enabled);
      setNotice("Link do cardápio atualizado.");
      setSavedSlug(body.public_menu_slug);
      setSavedEnabled(body.public_menu_enabled);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Não foi possível salvar.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setNotice("Link copiado para compartilhar.");
      setError("");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Não foi possível copiar o link neste dispositivo.");
    }
  }
  return (
    <div className="public-menu-settings">
      <section className="public-share-hero">
        <div className="public-share-icon">
          <Link2 size={23} />
        </div>
        <div className="public-share-copy">
          <span>PARA ENVIAR AOS SEUS CLIENTES</span>
          <h2>Seu cardápio, em um link.</h2>
          <p>
            Compartilhe seus produtos por WhatsApp, redes sociais ou onde
            preferir. O cliente navega pelas categorias sem precisar entrar no
            sistema.
          </p>
        </div>
        <div className={`public-share-status ${enabled ? "is-on" : ""}`}>
          <i />
          {enabled ? "Publicado" : "Desativado"}
        </div>
      </section>
      <section className="card public-share-card">
        <div className="public-share-card-head">
          <div>
            <h2>Link público</h2>
            <p>
              Personalize o endereço e escolha quando deixar o cardápio
              disponível.
            </p>
          </div>
          <span className="public-share-card-symbol">
            <Radio size={19} />
          </span>
        </div>
        <label className="public-slug-field">
          Endereço do cardápio
          <div className="public-slug-input">
            <span>www.pedizza.com.br/cardapio/</span>
            <input
              aria-label="Endereço personalizado do cardápio"
              value={slug}
              disabled={!canEdit || busy}
              onChange={(event) =>
                setSlug(
                  event.target.value
                    .toLowerCase()
                    .trim()
                    .replace(/[^a-z0-9-]/g, ""),
                )
              }
              maxLength={80}
            />
          </div>
          <small>Use letras minúsculas, números e hífens.</small>
        </label>
        <div className="public-share-switch-row">
          <div>
            <strong>Disponibilizar cardápio</strong>
            <span>
              Quando ativado, qualquer pessoa com o link pode visualizar seus
              produtos.
            </span>
          </div>
          <label className="public-switch">
            <input
              aria-label="Disponibilizar cardápio público"
              type="checkbox"
              checked={enabled}
              disabled={!canEdit || busy}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <span />
          </label>
        </div>
        {!canEdit && (
          <p className="muted">
            Você tem acesso somente para visualizar esta configuração.
          </p>
        )}
        {error && (
          <p className="feedback" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="public-share-success" role="status">
            <Check size={16} />
            {notice}
          </p>
        )}
        <div className="public-share-actions">
          {canEdit && (
            <button
              className="btn"
              disabled={busy || slug.length < 3 || !hasChanges}
              onClick={() => void save()}
            >
              {busy ? "Salvando…" : "Salvar alterações"}
            </button>
          )}
          {savedEnabled && (
            <>
              <button
                className="btn secondary"
                disabled={hasChanges}
                onClick={() => void copy()}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? "Link copiado" : "Copiar link"}
              </button>
              <Link
                aria-disabled={hasChanges}
                className={`btn ghost ${hasChanges ? "public-link-disabled" : ""}`}
                href={`/cardapio/${encodeURIComponent(savedSlug)}`}
                target="_blank"
                onClick={(event) => {
                  if (hasChanges) event.preventDefault();
                }}
              >
                <Eye size={16} />
                Visualizar
                <ExternalLink size={14} />
              </Link>
            </>
          )}
        </div>
      </section>
      <section className="public-menu-info">
        <span>
          <Eye size={17} />
        </span>
        <div>
          <strong>Somente para consulta</strong>
          <p>
            O cardápio mostra categorias, fotos, nomes e descrições. Ele não
            exibe preços e não recebe pedidos.
          </p>
        </div>
      </section>
    </div>
  );
}
