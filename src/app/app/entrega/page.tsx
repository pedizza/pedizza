import { DeliveryTest } from "@/components/delivery-test";
import { ModulePage } from "@/components/module-page";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const p = await searchParams;
  return (
    <>
      <ModulePage
        title="Entrega"
        description="Defina onde e como sua pizzaria entrega."
        tabs={[
          { key: "entrega", label: "Configurações" },
          { key: "bairros", label: "Por bairro" },
          { key: "faixas", label: "Por distância" },
        ]}
        selected={p.tab || "entrega"}
      />
      <DeliveryTest />
    </>
  );
}
