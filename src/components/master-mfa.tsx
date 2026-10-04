"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
export function MasterMfa() {
  const [factor, setFactor] = useState(""),
    [qr, setQr] = useState(""),
    [secret, setSecret] = useState(""),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  const router = useRouter();
  useEffect(() => {
    supabaseBrowser()
      .auth.mfa.listFactors()
      .then(({ data, error }) => {
        if (error) setError("Não foi possível consultar seus fatores.");
        else
          setFactor(data.totp.find((f) => f.status === "verified")?.id || "");
        setLoaded(true);
      });
  }, []);
  async function enroll() {
    setBusy(true);
    setError("");
    try {
      const { data, error } = await supabaseBrowser().auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Pedizza Master " + new Date().toISOString(),
      });
      if (error)
        throw Error(
          "Não foi possível iniciar. Remova fatores pendentes na sua conta e tente novamente.",
        );
      setFactor(data.id);
      setQr(
        data.totp.qr_code.startsWith("data:")
          ? data.totp.qr_code
          : "data:image/svg+xml;charset=utf-8," +
              encodeURIComponent(data.totp.qr_code),
      );
      setSecret(data.totp.secret);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tente novamente.");
    } finally {
      setBusy(false);
    }
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabaseBrowser().auth.mfa.challengeAndVerify({
      factorId: factor,
      code,
    });
    setBusy(false);
    if (error) {
      setError(
        "Código inválido ou expirado. Confira o horário do autenticador.",
      );
      return;
    }
    setSecret("");
    setQr("");
    router.push("/master");
    router.refresh();
  }
  return (
    <div className="stack">
      {error && (
        <p role="alert" className="feedback">
          {error}
        </p>
      )}
      {loaded && !factor && (
        <button className="btn" disabled={busy} onClick={enroll}>
          Configurar autenticador
        </button>
      )}
      {qr && (
        <>
          <Image
            src={qr}
            unoptimized
            width={240}
            height={240}
            alt="QR para configurar seu autenticador"
          />
          <p>Ou cadastre manualmente esta chave no autenticador:</p>
          <code style={{ overflowWrap: "anywhere" }}>{secret}</code>
        </>
      )}
      {factor && (
        <form className="stack" onSubmit={verify}>
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
            {busy ? "Verificando…" : "Entrar no Master"}
          </button>
        </form>
      )}
    </div>
  );
}
