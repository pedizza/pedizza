"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
export function MasterMfa() {
  const [enabled, setEnabled] = useState(false),
    [loaded, setLoaded] = useState(false),
    [secret, setSecret] = useState(""),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  useEffect(() => {
    fetch("/api/auth/mfa")
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw Error(b.error);
        setEnabled(b.enabled);
        setLoaded(true);
      })
      .catch((e) => setError(e.message));
  }, []);
  async function action(action: string) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/auth/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...(action === "verify" ? { code } : {}),
        }),
      });
      const b = await r.json();
      if (!r.ok) throw Error(b.error);
      if (b.secret) setSecret(b.secret);
      else {
        setSecret("");
        router.push("/master");
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tente novamente.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      {error && <p role="alert">{error}</p>}
      {loaded && !enabled && !secret && (
        <button
          className="btn"
          disabled={busy}
          onClick={() => action("enroll")}
        >
          Configurar autenticador
        </button>
      )}
      {secret && (
        <>
          <p>
            No aplicativo autenticador, adicione uma conta com chave manual,
            tipo baseado em tempo (TOTP), nome Pedizza.
          </p>
          <code style={{ overflowWrap: "anywhere" }}>{secret}</code>
        </>
      )}
      {(enabled || secret) && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void action("verify");
          }}
        >
          <label>
            Código de 6 dígitos
            <input
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </label>
          <button className="btn" disabled={busy}>
            Entrar no Master
          </button>
        </form>
      )}
    </div>
  );
}
