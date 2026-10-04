import { transaction, one } from "@/lib/db";
import { requirePage } from "@/lib/auth/context";
import { OrdersBoard } from "@/components/orders-board";
import { PageHeader } from "@/components/ui/states";
export default async function Page() {
  const ctx = await requirePage("orders.view");
  const print = ctx.permissions.includes("orders.print")
    ? await transaction((db) =>
        one<{ trigger_mode: string }>(
          db,
          "select trigger_mode from public.print_settings where tenant_id=$1",
          [ctx.tenantId],
        ),
      )
    : null;
  return (
    <>
      <PageHeader
        title="Gestor de pedidos"
        description="Cada pedido no seu tempo. Toda a operação à vista."
      />
      <OrdersBoard
        tenantId={ctx.tenantId}
        permissions={ctx.permissions}
        autoPrint={print?.trigger_mode === "on_accept"}
      />
    </>
  );
}
