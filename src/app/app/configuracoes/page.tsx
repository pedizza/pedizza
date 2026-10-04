import { ModulePage } from "@/components/module-page";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const p = await searchParams;
  return (
    <ModulePage
      title="Configurações"
      description="Tudo pronto para sua loja funcionar do seu jeito."
      tabs={[
        { key: "loja", label: "Minha loja" },
        { key: "horarios", label: "Horários" },
        {
          key: "whatsapp",
          label: "WhatsApp",
          href: "/app/configuracoes/whatsapp",
        },
        {
          key: "pagamentos",
          label: "Pagamentos",
          href: "/app/configuracoes/pagamentos",
        },
        { key: "impressao", label: "Impressão" },
        {
          key: "notificacoes",
          label: "Notificações",
          href: "/app/notificacoes",
        },
      ]}
      selected={p.tab || "loja"}
    />
  );
}
