import { requirePage } from "@/lib/auth/context";
import { WhatsappSettings } from "@/components/whatsapp-settings";
import { PageHeader } from "@/components/ui/states";
import Link from "next/link";
export default async function Page() {
  const ctx = await requirePage("whatsapp.view");
  return (
    <>
      <PageHeader
        title="WhatsApp"
        description="O atendimento da sua pizzaria começa aqui."
        action={
          <Link href="/app/configuracoes" className="btn secondary">
            Configurações
          </Link>
        }
      />
      <WhatsappSettings
        canManage={ctx.permissions.includes("whatsapp.manage")}
      />
    </>
  );
}
