"use client";
import { useEffect, useState } from "react";
type Option = {
  id: string;
  name?: string;
  code?: string;
  display_name?: string;
};
export function ReferenceSelect({
  resource,
  name,
  initialValue,
  required,
}: {
  resource: string;
  name: string;
  initialValue: string;
  required?: boolean;
}) {
  const [value, setValue] = useState(initialValue),
    [selected, setSelected] = useState<Option | null>(null),
    [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [options, setOptions] = useState<Option[]>([]),
    [total, setTotal] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/data/${resource}?q=${encodeURIComponent(q)}&page=${page}`, {
        signal: c.signal,
      })
        .then(async (r) => {
          const b = await r.json();
          if (!r.ok) throw Error(b.error);
          setOptions(b.data);
          setTotal(b.total);
          setError("");
        })
        .catch((e) => {
          if (e.name !== "AbortError") setError(e.message);
        });
    }, 150);
    return () => {
      clearTimeout(t);
      c.abort();
    };
  }, [resource, q, page]);
  useEffect(() => {
    if (!initialValue) return;
    const c = new AbortController();
    fetch(`/api/data/${resource}?id=${initialValue}`, { signal: c.signal })
      .then((r) => r.json())
      .then((b) => setSelected(b.data?.[0] || null))
      .catch(() => {});
    return () => c.abort();
  }, [resource, initialValue]);
  const display = (o: Option) => o.name || o.code || o.display_name || o.id;
  return (
    <span className="stack" style={{ gap: 8 }}>
      <input
        aria-label={`Buscar opção de ${name}`}
        placeholder="Buscar opções…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(1);
        }}
      />
      <select
        name={name}
        value={value}
        required={required}
        onChange={(e) => {
          setValue(e.target.value);
          setSelected(options.find((o) => o.id === e.target.value) || null);
        }}
      >
        <option value="">Selecione</option>
        {selected && !options.some((o) => o.id === selected.id) && (
          <option value={selected.id}>{display(selected)}</option>
        )}
        {options.map((o) => (
          <option value={o.id} key={o.id}>
            {display(o)}
          </option>
        ))}
      </select>
      {error && <small role="alert">{error}</small>}
      {total > 20 && (
        <span className="row between">
          <button
            type="button"
            className="btn ghost small"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Anterior
          </button>
          <small>
            {page} / {Math.ceil(total / 20)}
          </small>
          <button
            type="button"
            className="btn ghost small"
            disabled={page * 20 >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
          </button>
        </span>
      )}
    </span>
  );
}
