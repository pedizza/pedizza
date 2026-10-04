import type { Metadata } from "next";
import Link from "next/link";
export const metadata: Metadata = { alternates: { canonical: "/termos" } };

export default function Page() {
  return (
    <main className="card" style={{ maxWidth: 700, margin: "60px auto" }}>
      <h1>Termos de uso</h1>
      <p>
        Documento em preparação para revisão jurídica antes da abertura
        comercial do Pedizza.
      </p>
      <p className="muted">
        O sistema utiliza dados de conta, clientes e pedidos para a operação da
        pizzaria. Não adicionamos rastreadores de publicidade. As regras formais
        de retenção e atendimento aos titulares serão publicadas aqui.
      </p>
      <Link href="/">Voltar ao início</Link>
    </main>
  );
}
