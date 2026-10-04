import { ModulePage } from "@/components/module-page";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const p = await searchParams;
  return (
    <ModulePage
      title="Campanhas e cupons"
      description="Boas ofertas para trazer seus clientes de volta."
      tabs={[
        { key: "campanhas", label: "Campanhas" },
        { key: "cupons", label: "Cupons" },
        { key: "cupom-categorias", label: "Categorias elegíveis" },
        { key: "cupom-produtos", label: "Produtos elegíveis" },
      ]}
      selected={p.tab || "campanhas"}
    />
  );
}
