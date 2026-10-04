"use client";
import Image from "next/image";
import { ImagePlus, LoaderCircle, Trash2 } from "lucide-react";
import { useState } from "react";
export function ImageUpload({
  resource,
  id,
  hasImage,
  canEdit,
  onSaved,
  compact = false,
}: {
  resource: string;
  id: string;
  hasImage: boolean;
  canEdit: boolean;
  onSaved: () => void;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [imageOverride, setImageOverride] = useState<boolean | null>(null),
    [version, setVersion] = useState(0);
  const present = imageOverride ?? hasImage;

  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      if (file.size > 3 * 1024 * 1024)
        throw Error("Envie uma imagem de até 3 MB.");
      const r = await fetch(`/api/images?resource=${resource}&id=${id}`, {
        method: "POST",
        body: file,
      });
      const b = await r.json();
      if (!r.ok) throw Error(b.error);
      setImageOverride(true);
      setVersion((v) => v + 1);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao enviar.");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/images?resource=${resource}&id=${id}`, {
        method: "DELETE",
      });
      const b = await r.json();
      if (!r.ok) throw Error(b.error);
      setImageOverride(false);
      setVersion(0);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao remover.");
    } finally {
      setBusy(false);
    }
  }

  if (compact) {
    return (
      <div className="compact-image-upload">
        <div className="compact-image-frame">
          {canEdit ? (
            <label
              className="compact-image-picker"
              aria-label={present ? "Trocar imagem" : "Adicionar imagem"}
            >
              {present ? (
                <Image
                  unoptimized
                  src={`/api/images?resource=${resource}&id=${id}&v=${version}`}
                  width={72}
                  height={72}
                  alt="Imagem do cardápio"
                />
              ) : (
                <span className="compact-image-empty">
                  <ImagePlus size={20} />
                  <small>Adicionar</small>
                </span>
              )}
              <input
                hidden
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                  e.target.value = "";
                }}
              />
              {busy && (
                <span className="compact-image-busy" aria-label="Processando">
                  <LoaderCircle size={20} />
                </span>
              )}
            </label>
          ) : present ? (
            <Image
              unoptimized
              src={`/api/images?resource=${resource}&id=${id}&v=${version}`}
              width={72}
              height={72}
              alt="Imagem do cardápio"
            />
          ) : (
            <span className="compact-image-empty">Sem imagem</span>
          )}
          {canEdit && present && !busy && (
            <button
              type="button"
              className="compact-image-remove"
              aria-label="Remover imagem"
              title="Remover imagem"
              onClick={() => void remove()}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
        {error && <small role="alert">{error}</small>}
      </div>
    );
  }

  return (
    <div className="stack">
      {present && (
        <Image
          unoptimized
          src={`/api/images?resource=${resource}&id=${id}&v=${version}`}
          width={72}
          height={72}
          alt={resource === "loja" ? "Logo da loja" : "Imagem do cardápio"}
          style={{ objectFit: "cover", borderRadius: 10 }}
        />
      )}
      {canEdit && (
        <label className="btn secondary small">
          {busy ? "Enviando…" : "Enviar imagem"}
          <input
            hidden
            aria-label="Escolher imagem"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
        </label>
      )}
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
