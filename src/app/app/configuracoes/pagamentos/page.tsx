import { requirePage } from "@/lib/auth/context";
import { PaymentIntegration } from "@/components/payment-integration";
import { ModulePage } from "@/components/module-page";
export default async function Page() {
  const ctx = await requirePage("payments.view");
  return (
    <>
      <PaymentIntegration
        canManage={ctx.permissions.includes("payments.manage")}
      />
      <ModulePage
        title="Pagamentos"
        description="Configure as formas de pagamento da sua loja."
        tabs={[{ key: "pagamentos", label: "Formas de pagamento" }]}
        selected="pagamentos"
      />
    </>
  );
}
