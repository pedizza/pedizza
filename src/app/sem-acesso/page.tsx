import Link from "next/link";
import { logout } from "@/app/auth/actions";
export default function NoAccess() {
  return (
    <main className="card" style={{ maxWidth: 560, margin: "80px auto" }}>
      <h1>Acesso indisponível</h1>
      <p className="muted">
        Você não tem permissão para esta página ou seu acesso à loja foi
        desativado. Fale com o proprietário da pizzaria.
      </p>
      <div className="row">
        <Link className="btn secondary" href="/app">
          Voltar para minha loja
        </Link>
        <form action={logout}>
          <button className="btn">Sair</button>
        </form>
      </div>
    </main>
  );
}
