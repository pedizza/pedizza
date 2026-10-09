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
        description="Configure com facilidade as regiões atendidas e o valor da entrega."
        tabs={[
          { key: "entrega", label: "Configurações" },
          { key: "bairros", label: "Por bairro" },
          { key: "faixas", label: "Por distância" },
        ]}
        selected={p.tab || "entrega"}
        tabGuidance={{
          entrega: {
            title: "Comece escolhendo como cobrar",
            description:
              "Use Por bairro para definir uma taxa fixa para cada região, ou Por distância para cobrar conforme os quilômetros da rota. Configure apenas o método que sua loja vai usar.",
          },
          bairros: {
            title: "Taxa fixa por região",
            description:
              "Adicione cada bairro atendido, informe a cidade e o valor. Para não cobrar entrega, use R$ 0,00. Endereços em bairros não cadastrados serão informados como fora da área atendida.",
          },
          faixas: {
            title: "Taxas por quilômetros percorridos",
            description:
              "Crie faixas em ordem, por exemplo 0 a 2 km e 2 a 3 km. A distância usa a rota de carro. Use R$ 0,00 para uma faixa grátis; endereços além do limite configurado não serão atendidos.",
          },
        }}
      />
      <DeliveryTest />
    </>
  );
}
