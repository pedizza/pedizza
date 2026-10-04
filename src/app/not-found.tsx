import Link from "next/link";
export default function NotFound() {
  return (
    <main className="card" style={{ maxWidth: 520, margin: "80px auto" }}>
      <h1>Esta página não foi encontrada.</h1>
      <p className="muted">O endereço pode ter mudado.</p>
      <Link className="btn" href="/">
        Voltar ao início
      </Link>
    </main>
  );
}
