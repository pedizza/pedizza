import { redirect } from "next/navigation";
import { requireMaster } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { MasterMfa } from "@/components/master-mfa";
export default async function Page() {
  try {
    await requireMaster(false);
  } catch (e) {
    if (e instanceof AppError)
      redirect(e.status === 401 ? "/login" : "/sem-acesso");
    throw e;
  }
  return (
    <main
      className="card"
      style={{ maxWidth: 600, margin: "60px auto", padding: 28 }}
    >
      <h1>Proteção do acesso administrativo</h1>
      <p>Use seu aplicativo autenticador para acessar o Master.</p>
      <MasterMfa />
    </main>
  );
}
