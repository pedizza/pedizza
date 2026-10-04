"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function AcceptInvite({ token }: { token: string }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <>
      <button
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await fetch("/api/team", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "accept", token }),
          });
          const b = await r.json();
          if (!r.ok) {
            setError(b.error);
            setBusy(false);
          } else {
            router.push("/app");
            router.refresh();
          }
        }}
      >
        {busy ? "Aceitando…" : "Aceitar convite"}
      </button>
      {error && <p className="feedback">{error}</p>}
    </>
  );
}
