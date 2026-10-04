import Link from "next/link";
export default function Page() {
  return (
    <main className="card" style={{ maxWidth: 700, margin: "60px auto" }}>
      <h1>Política de privacidade</h1>
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
