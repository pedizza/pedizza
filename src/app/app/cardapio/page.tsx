import { ModulePage } from "@/components/module-page";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const p = await searchParams;
  return (
    <ModulePage
      hideHeader
      groups={[
        { label: "Produtos", keys: ["produtos", "tamanhos", "precos"] },
        { label: "Categorias", keys: ["categorias"] },
        {
          label: "Bordas",
          keys: ["bordas", "borda-categorias", "borda-precos"],
        },
      ]}
      title="Cardápio"
      description="Cada sabor, tamanho e detalhe da sua pizzaria."
      tabs={[
        { key: "produtos", label: "Produtos" },
        { key: "categorias", label: "Categorias" },
        { key: "tamanhos", label: "Tamanhos" },
        { key: "precos", label: "Preços" },
        { key: "bordas", label: "Bordas" },
        { key: "borda-categorias", label: "Categorias das bordas" },
        { key: "borda-precos", label: "Preços das bordas" },
      ]}
      selected={p.tab || "produtos"}
    />
  );
}
