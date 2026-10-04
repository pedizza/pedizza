import { ModulePage } from "@/components/module-page";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const p = await searchParams;
  return (
    <ModulePage
      title="Clientes"
      description="Uma relação que vai além do pedido."
      tabs={[
        { key: "clientes", label: "Todos os clientes" },
        { key: "enderecos", label: "Endereços" },
      ]}
      selected={p.tab || "clientes"}
    />
  );
}
