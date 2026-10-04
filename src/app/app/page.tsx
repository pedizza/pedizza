import { redirect } from "next/navigation";
import { requirePage } from "@/lib/auth/context";
import { navigation } from "@/lib/navigation";
export default async function App() {
  const ctx = await requirePage(undefined, true);
  if (!ctx.subscriptionActive) redirect("/app/assinatura");
  redirect(
    navigation.find((n) => ctx.permissions.includes(n.permission))?.href ||
      "/sem-acesso",
  );
}
