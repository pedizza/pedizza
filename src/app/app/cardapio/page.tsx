import { ModulePage } from "@/components/module-page";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const p = await searchParams;
  const selected = ["produtos", "categorias", "bordas", "regras-precos"].includes(
    p.tab || "",
  )
    ? p.tab!
    : "produtos";
  return (
    <ModulePage
      hideHeader
      title="Cardápio"
      description="Cada sabor, tamanho e detalhe da sua pizzaria."
      tabs={[
        { key: "produtos", label: "Produtos" },
        { key: "categorias", label: "Categorias" },
        { key: "bordas", label: "Bordas" },
        { key: "regras-precos", label: "Regra de Preços" },
      ]}
      selected={selected}
    />
  );
}
