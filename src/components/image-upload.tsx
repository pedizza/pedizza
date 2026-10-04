"use client";
import Image from "next/image";
import { useState } from "react";
export function ImageUpload({
  resource,
  id,
  hasImage,
  canEdit,
  onSaved,
}: {
  resource: string;
  id: string;
  hasImage: boolean;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [version, setVersion] = useState(0);
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
      setVersion((v) => v + 1);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao enviar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      {(hasImage || version > 0) && (
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
