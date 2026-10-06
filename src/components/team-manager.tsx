"use client";
import { useState, useEffect } from "react";
import { Plus, Pencil, Copy } from "lucide-react";
import { permissionCodes, type Permission } from "@/lib/permissions";
import { ResponsiveModal } from "./ui/modal";
type Member = { id: string; name: string; role: string; active: boolean };
type Team = {
  members: Member[];
  overrides: { member_id: string; permission: Permission; allowed: boolean }[];
  invites: { id: string; email: string; role: string; expires_at: string }[];
};
const roleNames: Record<string, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  manager: "Gerente",
  attendant: "Atendente",
  kitchen: "Cozinha",
  custom: "Personalizado",
};
export function TeamManager({ permissions }: { permissions: Permission[] }) {
  const [data, setData] = useState<Team | null>(null),
    [editing, setEditing] = useState<Member | null>(null),
    [invite, setInvite] = useState(false),
    [link, setLink] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  function load() {
    return fetch("/api/team")
      .then((r) => r.json())
      .then((b) => {
        if (b.error) setError(b.error);
        else setData(b);
      });
  }
  useEffect(() => {
    void load();
  }, []);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    let body: unknown;
    if (editing) {
      const overrides: Record<string, boolean> = {};
      for (const p of permissionCodes) {
        const v = f.get(p);
        if (v === "allow") overrides[p] = true;
        else if (v === "deny") overrides[p] = false;
      }
      body = {
        action: "update",
        id: editing.id,
        role: f.get("role"),
        active: f.has("active"),
        permissions: overrides,
      };
    } else
      body = { action: "invite", email: f.get("email"), role: f.get("role") };
    try {
      const r = await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      if (b.link) setLink(b.link);
      setEditing(null);
      setInvite(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }
  async function cancel(id: string) {
    const r = await fetch("/api/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel", id }),
    });
    const b = await r.json();
    if (!r.ok) setError(b.error);
    else await load();
  }
  return (
    <div className="stack team-workspace">
      <div className="row between">
        <span className="muted">Cada pessoa com seu próprio acesso.</span>
        {permissions.includes("team.invite") && (
          <button className="btn" onClick={() => setInvite(true)}>
            <Plus size={16} />
            Convidar pessoa
          </button>
        )}
      </div>
      {error && (
        <p className="feedback" role="alert">
          {error}
        </p>
      )}
      <div className="team-grid">
        {data?.members.map((m) => (
          <article className="data-row" key={m.id}>
            <span className="avatar">{m.name.slice(0, 2).toUpperCase()}</span>
            <div className="detail">
              <h3>{m.name}</h3>
              <small>{roleNames[m.role]}</small>
            </div>
            <span className={`badge ${m.active ? "green" : ""}`}>
              {m.active ? "Ativo" : "Desativado"}
            </span>
            {m.role !== "owner" &&
              permissions.includes("team.manage_permissions") && (
                <button
                  className="icon-button"
                  onClick={() => setEditing(m)}
                  aria-label={"Editar acesso de " + m.name}
                >
                  <Pencil size={16} />
                </button>
              )}
          </article>
        ))}
      </div>
      {!!data?.invites.length && <h2>Convites pendentes</h2>}
      {data?.invites.map((i) => (
        <div className="data-row" key={i.id}>
          <div>
            <strong>{i.email}</strong>
            <small>
              {roleNames[i.role]} · Expira em{" "}
              {new Date(i.expires_at).toLocaleDateString("pt-BR")}
            </small>
          </div>
          {permissions.includes("team.manage_permissions") && (
            <button
              className="btn secondary small"
              onClick={() => cancel(i.id)}
            >
              Cancelar convite
            </button>
          )}
        </div>
      ))}
      {link && (
        <div className="notice">
          <strong>Convite criado.</strong>
          <p>
            Compartilhe este link com a pessoa convidada. Ela deve entrar usando
            o e-mail do convite.
          </p>
          <button
            className="btn secondary"
            onClick={() => navigator.clipboard.writeText(link)}
          >
            <Copy size={15} />
            Copiar link do convite
          </button>
        </div>
      )}
      <ResponsiveModal
        open={invite || !!editing}
        title={editing ? "Editar acesso" : "Convidar pessoa"}
        onClose={() => {
          setEditing(null);
          setInvite(false);
        }}
      >
        <form className="stack" onSubmit={save}>
          {!editing && (
            <label>
              E-mail
              <input type="email" name="email" required />
            </label>
          )}
          <label>
            Função
            <select name="role" defaultValue={editing?.role || "attendant"}>
              {Object.entries(roleNames)
                .filter(([k]) => k !== "owner")
                .map(([k, v]) => (
                  <option value={k} key={k}>
                    {v}
                  </option>
                ))}
            </select>
          </label>
          {editing && (
            <>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  name="active"
                  defaultChecked={editing.active}
                />
                Acesso ativo
              </label>
              <h3>Permissões específicas</h3>
              <p className="muted">
                “Padrão” usa as permissões da função. Uma proibição explícita
                tem prioridade.
              </p>
              {permissionCodes.map((p) => (
                <label key={p}>
                  {p}
                  <select
                    name={p}
                    defaultValue={
                      data?.overrides.find(
                        (o) => o.member_id === editing.id && o.permission === p,
                      )?.allowed === true
                        ? "allow"
                        : data?.overrides.find(
                              (o) =>
                                o.member_id === editing.id &&
                                o.permission === p,
                            )?.allowed === false
                          ? "deny"
                          : "default"
                    }
                  >
                    <option value="default">Padrão da função</option>
                    {permissions.includes(p) && (
                      <option value="allow">Permitir</option>
                    )}
                    <option value="deny">Bloquear</option>
                  </select>
                </label>
              ))}
            </>
          )}
          {error && <p className="feedback">{error}</p>}
          <button className="btn" disabled={busy}>
            {busy ? "Salvando…" : "Salvar"}
          </button>
        </form>
      </ResponsiveModal>
    </div>
  );
}
