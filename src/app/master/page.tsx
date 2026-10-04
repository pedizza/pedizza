import { redirect } from "next/navigation";
import { requireMaster } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { MasterConsole } from "@/components/master-console";
export default async function Page() {
  try {
    await requireMaster();
  } catch (e) {
    if (e instanceof AppError && e.code === "MFA_REQUIRED")
      redirect("/master/seguranca");
    if (e instanceof AppError)
      redirect(e.status === 401 ? "/login" : "/sem-acesso");
    throw e;
  }
  return <MasterConsole />;
}
