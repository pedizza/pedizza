import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/context";
import { AcceptInvite } from "@/components/accept-invite";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const user = await getCurrentUser();
  const { token } = await searchParams;
  return (
    <main className="card" style={{ maxWidth: 550, margin: "60px auto" }}>
      <h1>Você foi convidado para uma pizzaria.</h1>
      <p className="muted">
        Entre com o e-mail que recebeu o convite e confirme seu acesso.
      </p>
      {user && token ? (
        <AcceptInvite token={token} />
      ) : (
        <Link
          className="btn"
          href={
            token && /^[a-f0-9]{64}$/.test(token)
              ? `/auth/invite?token=${token}`
              : "/login"
          }
        >
          Entrar na conta
        </Link>
      )}
    </main>
  );
}
