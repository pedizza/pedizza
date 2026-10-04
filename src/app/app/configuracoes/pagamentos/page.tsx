import { ModulePage } from "@/components/module-page";
export default async function Page() {
  return (
    <ModulePage
      title="Pagamentos"
      description="Configure PIX manual, dinheiro, cartões na maquininha e outras formas de pagamento."
      tabs={[{ key: "pagamentos", label: "Formas de pagamento" }]}
      selected="pagamentos"
    />
  );
}
