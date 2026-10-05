"use client";
import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Search,
  Pencil,
  Archive,
  ArrowLeft,
  ArrowRight,
  Copy,
  Pause,
  Play,
  Trash2,
} from "lucide-react";
import { resources, optionLabels, type Field } from "@/lib/modules/registry";
import { formatCurrency, parseCurrency } from "@/lib/domain/money";
import { ResponsiveModal } from "./ui/modal";
import { ReferenceSelect } from "./reference-select";
import { ImageUpload } from "./image-upload";
import Link from "next/link";
import type { ProductSize } from "@/lib/modules/product-sizes";
import type { BorderOption } from "@/lib/modules/border-groups";
import { EmptyState } from "./ui/states";
type Row = Record<string, unknown> & { id: string; updated_at: string };
type EditableBorderOption = BorderOption & {
  rowId: string;
  price: string;
};
export function ResourceManager({
  resourceKey,
  canEdit,
  canArchive,
}: {
  resourceKey: string;
  canEdit: boolean;
  canArchive: boolean;
}) {
  const resource = resources[resourceKey];
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [sizes, setSizes] = useState<
    (ProductSize & { rowId: string; price: string })[]
  >([]);
  const [borderOptions, setBorderOptions] = useState<EditableBorderOption[]>([]);
  const [borderCategoryIds, setBorderCategoryIds] = useState<string[]>([]);
  function updateSize(index: number, patch: Partial<(typeof sizes)[number]>) {
    setSizes((current) =>
      current.map((size, i) => (i === index ? { ...size, ...patch } : size)),
    );
    setDirty(true);
  }
  const [data, setData] = useState<Row[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [open, setOpen] = useState(false),
    [editing, setEditing] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [toast, setToast] = useState(""),
    [options, setOptions] = useState<Record<string, Row[]>>({}),
    [remove, setRemove] = useState<Row | null>(null),
    [toggling, setToggling] = useState<string | null>(null),
    [dirty, setDirty] = useState(false);
  const load = useCallback(
    (signal?: AbortSignal) =>
      fetch(
        `/api/data/${resourceKey}?page=${page}&q=${encodeURIComponent(search)}&category=${category}`,
        { signal },
      )
        .then(async (r) => {
          const body = await r.json();
          if (!r.ok) throw new Error(body.error);
          return body;
        })
        .then((body) => {
          setData(body.data);
          if (body.categories) setCategories(body.categories);
          setTotal(body.total);
          setError("");
        })
        .catch((e) => {
          if (e instanceof Error && e.name !== "AbortError")
            setError(e.message);
        })
        .finally(() => setLoading(false)),
    [resourceKey, page, search, category],
  );
  useEffect(() => {
    const c = new AbortController();
    void load(c.signal);
    return () => c.abort();
  }, [load]);
  useEffect(() => {
    if (!open) return;
    const c = new AbortController();
    Promise.all(
      resource.fields
        .filter((f) => f.reference)
        .map(async (f) => {
          const r = await fetch(`/api/data/${f.reference}`, {
            signal: c.signal,
          });
          const b = await r.json();
          return [f.key, b.data || []] as const;
        }),
    )
      .then((values) => setOptions(Object.fromEntries(values)))
      .catch(() => {});
    return () => c.abort();
  }, [open, resource]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  function edit(row: Row | null) {
    setSizes(
      ((row?.sizes || []) as ProductSize[]).map((size) => ({
        ...size,
        rowId: crypto.randomUUID(),
        price: (size.price_cents / 100).toFixed(2).replace(".", ","),
      })),
    );
    setBorderOptions(
      row
        ? ((row.options || []) as BorderOption[]).map((option) => ({
            ...option,
            rowId: crypto.randomUUID(),
            price: (option.price_cents / 100).toFixed(2).replace(".", ","),
          }))
        : [
            {
              rowId: crypto.randomUUID(),
              name: "",
              description: "",
              price: "",
              price_cents: 0,
              active: true,
              sort_order: 0,
            },
          ],
    );
    setBorderCategoryIds(
      row ? ((row.category_ids || []) as string[]) : [],
    );
    setEditing(row);
    setDirty(false);
    setOpen(true);
    setError("");
  }
  function value(field: Field) {
    const v = editing?.[field.key] ?? field.default;
    if (field.type === "checkbox") return Boolean(v);
    if (field.type === "money")
      return v == null ? "" : (Number(v) / 100).toFixed(2).replace(".", ",");
    if (field.type === "datetime-local") return v ? String(v).slice(0, 16) : "";
    if (field.type === "date") return v ? String(v).slice(0, 10) : "";
    return v == null ? "" : String(v);
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      const payload: Record<string, unknown> = {};
      for (const f of resource.fields) {
        const raw = String(form.get(f.key) || "");
        payload[f.key] =
          f.type === "checkbox"
            ? form.has(f.key)
            : f.type === "money"
              ? raw
                ? parseCurrency(raw)
                : ["base_price_cents"].includes(f.key)
                  ? null
                  : 0
              : f.type === "number" ||
                  ["day_of_week", "max_flavors", "paper_width"].includes(f.key)
                ? raw
                  ? Number(raw)
                  : null
                : ["date", "datetime-local"].includes(f.type || "") && !raw
                  ? null
                  : raw;
      }
      if (resourceKey === "produtos") {
        payload.sizes = sizes.map((size) => ({
          name: size.name,
          slices: size.slices,
          max_flavors: size.max_flavors,
          price_cents: parseCurrency(size.price),
        }));
      }
      if (resourceKey === "bordas") {
        payload.options = borderOptions.map((option, index) => ({
          ...(option.id ? { id: option.id } : {}),
          name: option.name,
          description: option.description,
          price_cents: parseCurrency(option.price),
          active: option.active,
          sort_order: index,
        }));
        payload.category_ids = borderCategoryIds;
      }
      const r = await fetch(`/api/data/${resourceKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editing?.id,
          updated_at: editing?.updated_at,
          data: payload,
        }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      setOpen(false);
      setDirty(false);
      setToast("Salvo com sucesso.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }
  async function confirmRemove() {
    if (!remove) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/data/${resourceKey}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: remove.id }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setRemove(null);
      setToast(resource.archive ? "Registro arquivado." : "Registro removido.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível remover.");
    } finally {
      setBusy(false);
    }
  }
  async function toggleAvailability(row: Row) {
    const available = !Boolean(row.available);
    setToggling(row.id);
    setError("");
    try {
      const response = await fetch(`/api/data/${resourceKey}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: row.id,
          available,
          updated_at: row.updated_at,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setData((current) =>
        current.map((item) =>
          item.id === row.id
            ? { ...item, available, updated_at: body.updated_at }
            : item,
        ),
      );
      setToast(available ? "Produto reativado." : "Produto pausado.");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Não foi possível alterar o produto.",
      );
    } finally {
      setToggling(null);
    }
  }
  async function toggleBorderGroup(row: Row) {
    const active = !Boolean(row.active);
    setToggling(row.id);
    setError("");
    try {
      const response = await fetch(`/api/data/${resourceKey}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: row.id,
          active,
          updated_at: row.updated_at,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setData((current) =>
        current.map((item) =>
          item.id === row.id
            ? { ...item, active, updated_at: body.updated_at }
            : item,
        ),
      );
      setToast(active ? "Borda reativada." : "Borda pausada.");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Não foi possível alterar a borda.",
      );
    } finally {
      setToggling(null);
    }
  }
  function label(row: Row) {
    return String(
      row.name ||
        row.display_name ||
        row.code ||
        row.label ||
        (row.day_of_week != null
          ? [
              "Domingo",
              "Segunda",
              "Terça",
              "Quarta",
              "Quinta",
              "Sexta",
              "Sábado",
            ][Number(row.day_of_week)]
          : resource.singular),
    );
  }
  return (
    <section className="stack">
      <div className="toolbar">
        <div>
          <h2 style={{ marginBottom: 5 }}>{resource.title}</h2>
          <small>{resource.description}</small>
        </div>
        {canEdit && resourceKey !== "regras-precos" && (
          <button
            className="btn"
            onClick={() => edit(resource.singleton ? data[0] || null : null)}
          >
            <Plus size={16} />
            {resource.singleton
              ? "Editar configurações"
              : `Adicionar ${resource.singular}`}
          </button>
        )}
      </div>
      {resourceKey === "regras-precos" && (
        <div className="notice">
          <p>
            Escolha quais categorias permitem dois sabores e edite a regra de
            cada uma.
          </p>
          <p>
            <strong>Valor proporcional:</strong> metade do preço de cada sabor.
            R$ 50,00 + R$ 70,00 resulta em R$ 60,00.
          </p>
          <p>
            <strong>Maior valor:</strong> cobra o preço integral do sabor mais
            caro. No mesmo exemplo, R$ 70,00.
          </p>
          <small>
            Os dois sabores devem ter o mesmo tamanho, configurado para aceitar
            2 sabores no produto. Frações de centavo no valor proporcional são
            arredondadas para cima.
          </small>
        </div>
      )}
      {resourceKey === "produtos" && (
        <label className="product-category-filter">
          Categoria
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
              setLoading(true);
            }}
          >
            <option value="">Todas as categorias</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {resource.search && (
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSearch(query);
          }}
        >
          <Search size={17} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Buscar ${resource.title.toLowerCase()}…`}
            aria-label="Buscar registros"
          />
        </form>
      )}
      {error && !open && (
        <p className="feedback" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <div className="skeleton" />
      ) : data.length === 0 ? (
        <div className="card">
          <EmptyState
            title={`Nenhum registro em ${resource.title.toLowerCase()}`}
            description={
              resourceKey === "regras-precos"
                ? "Cadastre uma categoria na aba Categorias para configurar a regra de preços."
                : "Comece adicionando as informações da sua pizzaria."
            }
          />
        </div>
      ) : resource.singleton ? (
        <div className="card form-grid">
          {resourceKey === "loja" && (
            <ImageUpload
              resource={resourceKey}
              id={data[0].id}
              hasImage={!!data[0].logo_path}
              canEdit={canEdit}
              onSaved={() => void load()}
            />
          )}
          {resource.fields.map((f) => (
            <div key={f.key}>
              <small>{f.label}</small>
              <p style={{ margin: "6px 0", overflowWrap: "anywhere" }}>
                {f.type === "checkbox"
                  ? data[0][f.key]
                    ? "Ativado"
                    : "Desativado"
                  : f.type === "money"
                    ? formatCurrency(Number(data[0][f.key]) || 0)
                    : optionLabels[String(data[0][f.key])] ||
                      String(data[0][f.key] || "Não informado")}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="data-list">
          {resourceKey === "produtos" && (
            <div className="product-list-head" aria-hidden="true">
              <span>Imagem</span>
              <span>Produto</span>
              <span>Tamanho e preço</span>
              <span>Ações</span>
            </div>
          )}
          {resourceKey === "categorias" && (
            <div className="category-list-head" aria-hidden="true">
              <span>Imagem</span>
              <span>Categoria</span>
              <span>Ordem</span>
              <span>Ações</span>
            </div>
          )}
          {resourceKey === "bordas" && (
            <div className="border-list-head" aria-hidden="true">
              <span>Imagem</span>
              <span>Tipo de borda</span>
              <span>Sabores e valores</span>
              <span>Ações</span>
            </div>
          )}
          {data.map((row) => (
            <article
              className={`data-row ${resourceKey === "produtos" ? "product-row" : resourceKey === "categorias" ? "category-row" : resourceKey === "bordas" ? "border-row" : ""}`}
              key={row.id}
            >
              {(resourceKey === "produtos" ||
                resourceKey === "categorias" ||
                resourceKey === "bordas") && (
                <div className="catalog-image">
                  <ImageUpload
                    resource={resourceKey}
                    id={row.id}
                    hasImage={!!row.image_path}
                    canEdit={canEdit}
                    onSaved={() => void load()}
                    compact
                  />
                </div>
              )}
              <div className="detail">
                <h3>
                  {resourceKey === "clientes" ? (
                    <Link href={`/app/clientes/${row.id}`}>{label(row)}</Link>
                  ) : (
                    label(row)
                  )}
                </h3>
                {resourceKey === "produtos" && (
                  <>
                    <span className="product-category">
                      {String(row.category_name || "")}
                    </span>
                    <p>{String(row.description || "")}</p>
                  </>
                )}
                {resourceKey === "categorias" && (
                  <p>{String(row.description || "Sem descrição")}</p>
                )}
                {resourceKey === "bordas" && (
                  <>
                    <p>{String(row.description || "Sem descrição")}</p>
                    <span className="border-categories">
                      {((row.category_names || []) as string[]).join(" · ") ||
                        "Nenhuma categoria"}
                    </span>
                  </>
                )}
                {resourceKey === "regras-precos" && (
                  <span className={`badge ${row.allow_split ? "green" : ""}`}>
                    {row.allow_split
                      ? "Dois sabores permitidos"
                      : "Somente um sabor"}
                  </span>
                )}
                {resourceKey !== "produtos" &&
                  resourceKey !== "categorias" &&
                  resourceKey !== "bordas" && (
                  <p>
                    {resource.fields
                      .filter(
                        (f) =>
                          f.key !== "name" &&
                          f.key !== "description" &&
                          f.key !== "active" &&
                          f.key !== "blocked" &&
                          !f.reference &&
                          row[f.key] != null &&
                          row[f.key] !== "" &&
                          f.type !== "checkbox",
                      )
                      .slice(0, 3)
                      .map((f) =>
                        f.type === "money"
                          ? formatCurrency(Number(row[f.key]))
                          : optionLabels[String(row[f.key])] ||
                            String(row[f.key]),
                      )
                      .join(" · ")}
                  </p>
                )}
              </div>
              {resourceKey === "categorias" && (
                <div className="category-order">
                  <span>Posição</span>
                  <strong>{Number(row.sort_order) || 0}</strong>
                </div>
              )}
              {resourceKey === "produtos" && (
                <table
                  className="product-prices"
                  aria-label={`Tamanhos e preços de ${label(row)}`}
                >
                  <thead>
                    <tr>
                      <th>Tamanho</th>
                      <th>Preço</th>
                    </tr>
                  </thead>
                  <tbody>
                    {((row.sizes as ProductSize[])?.length
                      ? (row.sizes as ProductSize[])
                      : [{ name: "Único", price_cents: row.base_price_cents }]
                    ).map((size, i) => (
                      <tr key={i}>
                        <td>{size.name}</td>
                        <td>
                          {size.price_cents == null
                            ? "Não definido"
                            : formatCurrency(Number(size.price_cents))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {resourceKey === "bordas" && (
                <table
                  className="border-options-table"
                  aria-label={`Sabores e valores de ${label(row)}`}
                >
                  <thead>
                    <tr>
                      <th>Sabor</th>
                      <th>Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {((row.options || []) as BorderOption[]).map((option) => (
                      <tr key={option.id || option.name}>
                        <td>
                          {option.name}
                          {!option.active && (
                            <span className="badge amber">Pausado</span>
                          )}
                        </td>
                        <td>{formatCurrency(option.price_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="actions">
                {"active" in row && (
                  <span
                    className={`badge ${row.active && row.available !== false ? "green" : resourceKey === "produtos" && row.active ? "amber" : ""}`}
                  >
                    {!row.active
                      ? "Inativo"
                      : resourceKey === "produtos" && row.available === false
                        ? "Pausado"
                        : "Ativo"}
                  </span>
                )}
                {canEdit && (
                  <>
                    <button
                      className="icon-button"
                      aria-label={`Editar ${label(row)}`}
                      onClick={() => edit(row)}
                    >
                      <Pencil size={15} />
                    </button>
                    {resourceKey === "produtos" && (
                      <>
                        <button
                          className="icon-button"
                          aria-label="Duplicar produto"
                          onClick={() => {
                            const copy = {
                              ...row,
                              name: row.name + " (cópia)",
                            };
                            delete (copy as Partial<Row>).id;
                            delete (copy as Partial<Row>).updated_at;
                            edit(copy);
                          }}
                        >
                          <Copy size={15} />
                        </button>
                        <button
                          className={`icon-button ${row.available === false ? "resume-action" : ""}`}
                          aria-label={
                            row.available === false
                              ? `Reativar ${label(row)}`
                              : `Pausar ${label(row)}`
                          }
                          title={
                            row.available === false
                              ? "Reativar produto"
                              : "Pausar produto"
                          }
                          disabled={toggling === row.id}
                          onClick={() => void toggleAvailability(row)}
                        >
                          {row.available === false ? (
                            <Play size={15} />
                          ) : (
                            <Pause size={15} />
                          )}
                        </button>
                      </>
                    )}
                    {resourceKey === "bordas" && (
                      <button
                        className={`icon-button ${row.active ? "" : "resume-action"}`}
                        aria-label={
                          row.active
                            ? `Pausar ${label(row)}`
                            : `Reativar ${label(row)}`
                        }
                        title={
                          row.active ? "Pausar borda" : "Reativar borda"
                        }
                        disabled={toggling === row.id}
                        onClick={() => void toggleBorderGroup(row)}
                      >
                        {row.active ? (
                          <Pause size={15} />
                        ) : (
                          <Play size={15} />
                        )}
                      </button>
                    )}
                  </>
                )}
                {canArchive && (
                  <button
                    className="icon-button"
                    aria-label={`Remover ${label(row)}`}
                    onClick={() => setRemove(row)}
                  >
                    <Archive size={15} />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {total > 20 && (
        <div className="pagination">
          <span className="muted">
            Página {page} · {total} registros
          </span>
          <button
            className="icon-button"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
            aria-label="Página anterior"
          >
            <ArrowLeft size={16} />
          </button>
          <button
            className="icon-button"
            disabled={page * 20 >= total}
            onClick={() => setPage(page + 1)}
            aria-label="Próxima página"
          >
            <ArrowRight size={16} />
          </button>
        </div>
      )}
      <ResponsiveModal
        open={open}
        title={`${editing ? "Editar" : "Adicionar"} ${resource.singular}`}
        wide={resourceKey === "bordas"}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
      >
        <form onSubmit={save} onChange={() => setDirty(true)} className="stack">
          <div className="form-grid">
            {resource.fields
              .filter(
                (f) =>
                  !(
                    resourceKey === "produtos" &&
                    sizes.length > 0 &&
                    f.key === "base_price_cents"
                  ),
              )
              .map((f) => (
                <label
                  key={f.key}
                  className={
                    f.type === "textarea"
                      ? "full"
                      : f.type === "checkbox"
                        ? "checkbox-label"
                        : ""
                  }
                >
                  {f.type === "checkbox" ? (
                    <>
                      <input
                        type="checkbox"
                        name={f.key}
                        defaultChecked={Boolean(value(f))}
                      />
                      {f.label}
                    </>
                  ) : (
                    <>
                      {f.label}
                      {f.required ? " *" : ""}
                      {f.type === "textarea" ? (
                        <textarea
                          name={f.key}
                          defaultValue={String(value(f))}
                          maxLength={2000}
                        />
                      ) : f.reference ? (
                        <ReferenceSelect
                          resource={f.reference}
                          name={f.key}
                          initialValue={String(value(f))}
                          required={f.required}
                        />
                      ) : f.type === "select" ? (
                        <select
                          name={f.key}
                          defaultValue={String(value(f))}
                          required={f.required}
                        >
                          <option value="">Selecione</option>
                          {f.reference
                            ? (options[f.key] || []).map((o) => (
                                <option value={o.id} key={o.id}>
                                  {String(
                                    o.name || o.code || o.display_name || o.id,
                                  )}
                                </option>
                              ))
                            : f.options?.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {f.key === "day_of_week"
                                    ? [
                                        "Domingo",
                                        "Segunda",
                                        "Terça",
                                        "Quarta",
                                        "Quinta",
                                        "Sexta",
                                        "Sábado",
                                      ][Number(o.value)]
                                    : optionLabels[o.value] || o.label}
                                </option>
                              ))}
                        </select>
                      ) : (
                        <input
                          type={f.type === "money" ? "text" : f.type || "text"}
                          name={f.key}
                          defaultValue={String(value(f))}
                          required={f.required}
                          inputMode={f.type === "money" ? "decimal" : undefined}
                          min={f.type === "number" ? 0 : undefined}
                          maxLength={254}
                        />
                      )}
                    </>
                  )}
                </label>
              ))}
          </div>
          {resourceKey === "produtos" && (
            <fieldset
              className="stack"
              style={{
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 16,
                minWidth: 0,
              }}
            >
              <legend>Tamanhos e preços</legend>
              <small>
                Adicione os tamanhos vendidos para este produto. Sem tamanhos,
                informe o preço simples.
              </small>
              {sizes.map((size, index) => (
                <div key={size.rowId} className="form-grid">
                  <label>
                    Nome do tamanho
                    <input
                      required
                      maxLength={80}
                      value={size.name}
                      onChange={(e) =>
                        updateSize(index, { name: e.target.value })
                      }
                      placeholder="Ex.: Grande"
                    />
                  </label>
                  <label>
                    Preço do tamanho
                    <input
                      required
                      inputMode="decimal"
                      value={size.price}
                      onChange={(e) =>
                        updateSize(index, { price: e.target.value })
                      }
                      placeholder="0,00"
                    />
                  </label>
                  <label>
                    Fatias (opcional)
                    <input
                      type="number"
                      min={1}
                      max={24}
                      value={size.slices ?? ""}
                      onChange={(e) =>
                        updateSize(index, {
                          slices: e.target.value
                            ? Number(e.target.value)
                            : null,
                        })
                      }
                    />
                  </label>
                  <label>
                    Máximo de sabores
                    <select
                      value={size.max_flavors}
                      onChange={(e) =>
                        updateSize(index, {
                          max_flavors: Number(e.target.value),
                        })
                      }
                    >
                      <option value={1}>1 sabor</option>
                      <option value={2}>2 sabores</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() => {
                      setSizes((current) =>
                        current.filter((_, i) => i !== index),
                      );
                      setDirty(true);
                    }}
                  >
                    Remover tamanho
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  setSizes((current) => [
                    ...current,
                    {
                      rowId: crypto.randomUUID(),
                      name: "",
                      price: "",
                      price_cents: 0,
                      slices: null,
                      max_flavors: 1,
                    },
                  ]);
                  setDirty(true);
                }}
              >
                Adicionar tamanho
              </button>
            </fieldset>
          )}
          {resourceKey === "bordas" && (
            <>
              <fieldset className="border-category-picker">
                <legend>Categorias permitidas *</legend>
                <p>Selecione onde este tipo de borda poderá ser escolhido.</p>
                <div className="choice-grid">
                  {categories.map((category) => (
                    <label className="checkbox-label" key={category.id}>
                      <input
                        type="checkbox"
                        checked={borderCategoryIds.includes(category.id)}
                        onChange={(event) => {
                          setBorderCategoryIds((current) =>
                            event.target.checked
                              ? [...current, category.id]
                              : current.filter((id) => id !== category.id),
                          );
                          setDirty(true);
                        }}
                      />
                      {category.name}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="border-options-editor">
                <div className="row between">
                  <div>
                    <strong>Sabores e valores *</strong>
                    <p>Cadastre as opções oferecidas neste tipo de borda.</p>
                  </div>
                  <button
                    type="button"
                    className="btn secondary small"
                    onClick={() => {
                      setBorderOptions((current) => [
                        ...current,
                        {
                          rowId: crypto.randomUUID(),
                          name: "",
                          description: "",
                          price: "",
                          price_cents: 0,
                          active: true,
                          sort_order: current.length,
                        },
                      ]);
                      setDirty(true);
                    }}
                  >
                    <Plus size={15} /> Adicionar sabor
                  </button>
                </div>
                <div className="border-option-list">
                  {borderOptions.map((option, index) => (
                    <div className="border-option-editor" key={option.rowId}>
                      <label>
                        Sabor *
                        <input
                          required
                          maxLength={120}
                          value={option.name}
                          onChange={(event) => {
                            setBorderOptions((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, name: event.target.value }
                                  : item,
                              ),
                            );
                            setDirty(true);
                          }}
                        />
                      </label>
                      <label>
                        Valor *
                        <input
                          required
                          inputMode="decimal"
                          placeholder="0,00"
                          value={option.price}
                          onChange={(event) => {
                            setBorderOptions((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, price: event.target.value }
                                  : item,
                              ),
                            );
                            setDirty(true);
                          }}
                        />
                      </label>
                      <label className="checkbox-label border-option-active">
                        <input
                          type="checkbox"
                          checked={option.active}
                          onChange={(event) => {
                            setBorderOptions((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, active: event.target.checked }
                                  : item,
                              ),
                            );
                            setDirty(true);
                          }}
                        />
                        Ativo
                      </label>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Remover sabor ${option.name || index + 1}`}
                        disabled={borderOptions.length === 1}
                        onClick={() => {
                          setBorderOptions((current) =>
                            current.filter((_, itemIndex) => itemIndex !== index),
                          );
                          setDirty(true);
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
          {error && (
            <p className="feedback" role="alert">
              {error}
            </p>
          )}
          <div className="modal-footer">
            <button
              type="button"
              className="btn secondary"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancelar
            </button>
            <button className="btn" disabled={busy}>
              {busy ? "Salvando…" : "Salvar alterações"}
            </button>
          </div>
        </form>
      </ResponsiveModal>
      <ResponsiveModal
        open={!!remove}
        title={resource.archive ? "Arquivar registro?" : "Remover registro?"}
        onClose={() => setRemove(null)}
      >
        <p>
          Confirme a remoção de <strong>{remove && label(remove)}</strong>.{" "}
          {resource.archive
            ? "O histórico será preservado."
            : "Esta ação remove a configuração selecionada."}
        </p>
        <div className="modal-footer">
          <button className="btn secondary" onClick={() => setRemove(null)}>
            Cancelar
          </button>
          <button className="btn" disabled={busy} onClick={confirmRemove}>
            {busy ? "Aguarde…" : "Confirmar"}
          </button>
        </div>
      </ResponsiveModal>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </section>
  );
}
