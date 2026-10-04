"use client";
import { useState } from "react";
import { formatCurrency } from "@/lib/domain/money";
export function DeliveryTest() {
  const [address, setAddress] = useState({
      postal_code: "",
      street: "",
      number: "",
      complement: "",
      neighborhood: "",
      city: "",
      state: "",
    }),
    [error, setError] = useState(""),
    [result, setResult] = useState<{
      fee_cents: number;
      distance_meters: number | null;
    } | null>(null),
    [busy, setBusy] = useState(false);
  async function request(action: string) {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const r = await fetch("/api/geo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "cep"
            ? { action, cep: address.postal_code.replace(/\D/g, "") }
            : { action, address },
        ),
      });
      const b = await r.json();
      if (!r.ok) throw Error(b.error);
      if (action === "cep")
        setAddress((a) => ({
          ...a,
          postal_code: b.cep.replace(/\D/g, ""),
          street: b.logradouro,
          neighborhood: b.bairro,
          city: b.localidade,
          state: b.uf,
        }));
      else setResult(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tente novamente.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="card" style={{ padding: 24, marginTop: 24 }}>
      <summary>Testar endereço e taxa de entrega</summary>
      <form
        className="stack"
        style={{ marginTop: 20 }}
        onSubmit={(e) => {
          e.preventDefault();
          void request("quote");
        }}
      >
        <div className="form-grid">
          {Object.entries({
            postal_code: "CEP",
            street: "Rua",
            number: "Número",
            complement: "Complemento",
            neighborhood: "Bairro",
            city: "Cidade",
            state: "UF",
          }).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                value={address[key as keyof typeof address]}
                required={key !== "complement"}
                onChange={(e) =>
                  setAddress((a) => ({ ...a, [key]: e.target.value }))
                }
                maxLength={key === "state" ? 2 : 200}
              />
            </label>
          ))}
        </div>
        <div className="row">
          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={() => request("cep")}
          >
            Consultar CEP
          </button>
          <button className="btn" disabled={busy}>
            Calcular entrega
          </button>
        </div>
        {error && (
          <p role="alert" className="feedback">
            {error}
          </p>
        )}
        {result && (
          <p role="status">
            Taxa: {formatCurrency(result.fee_cents)}
            {result.distance_meters != null
              ? ` · Rota: ${(result.distance_meters / 1000).toFixed(2)} km`
              : ""}
          </p>
        )}
      </form>
    </details>
  );
}
