"use client";

import { useState } from "react";
import { CirclePause, LockKeyhole, Store } from "lucide-react";

const states = {
  automatic: { label: "Conforme horário", className: "automatic" },
  forced_open: { label: "Loja aberta", className: "open" },
  paused: { label: "Loja pausada", className: "paused" },
  forced_closed: { label: "Loja fechada", className: "closed" },
} as const;

type Mode = keyof typeof states;

export function StoreStatusControl({
  initialMode,
  canManage,
}: {
  initialMode: string;
  canManage: boolean;
}) {
  const [mode, setMode] = useState<Mode>(
    initialMode in states ? (initialMode as Mode) : "automatic",
  );
  const [busy, setBusy] = useState<Mode | "">("");
  const [error, setError] = useState("");

  async function change(next: Exclude<Mode, "automatic">) {
    if (!canManage || busy || next === mode) return;
    setBusy(next);
    setError("");
    try {
      const response = await fetch("/api/store-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Falha ao atualizar a loja.");
      setMode(body.status_mode as Mode);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Falha ao atualizar a loja.",
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="store-status-wrap">
      <div className={`store-status-current ${states[mode].className}`}>
        <span />
        {states[mode].label}
      </div>
      {canManage && (
        <div className="store-status-actions" aria-label="Status da loja">
          <button
            className={mode === "forced_open" ? "active" : ""}
            disabled={!!busy}
            onClick={() => void change("forced_open")}
          >
            <Store size={15} /> Abrir
          </button>
          <button
            className={mode === "paused" ? "active" : ""}
            disabled={!!busy}
            onClick={() => void change("paused")}
          >
            <CirclePause size={15} /> Pausar
          </button>
          <button
            className={mode === "forced_closed" ? "active" : ""}
            disabled={!!busy}
            onClick={() => void change("forced_closed")}
          >
            <LockKeyhole size={15} /> Fechar
          </button>
        </div>
      )}
      {error && <small className="store-status-error">{error}</small>}
    </div>
  );
}
