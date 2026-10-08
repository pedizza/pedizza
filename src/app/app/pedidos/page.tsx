import { transaction, one } from "@/lib/db";
import { requirePage } from "@/lib/auth/context";
import { OrdersBoard } from "@/components/orders-board";
import { PageHeader } from "@/components/ui/states";
import { StoreStatusControl } from "@/components/store-status-control";
import { listOrders } from "@/lib/services/orders";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const ctx = await requirePage("orders.view");
  const initialQuery = (await searchParams).q?.slice(0, 100) || "";
  const initial = await transaction(async (db) => {
    const observed = await one<{
      observed_at: string;
      status_mode: string;
    }>(
      db,
      `select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') observed_at,s.status_mode
       from public.store_settings s
       where s.tenant_id=$1`,
      [ctx.tenantId],
    );
    return {
      ...(await listOrders(db, ctx.tenantId, { search: initialQuery })),
      observed,
    };
  }, ctx.userId);
  return (
    <>
      <PageHeader
        title="Gestor de pedidos"
        description="Cada pedido no seu tempo. Toda a operação à vista."
        action={
          <StoreStatusControl
            initialMode={initial.observed?.status_mode || "automatic"}
            canManage={ctx.permissions.includes("settings.edit")}
          />
        }
      />
      <OrdersBoard
        tenantId={ctx.tenantId}
        permissions={ctx.permissions}
        autoPrint={ctx.permissions.includes("orders.print")}
        initialOrders={initial.data}
        initialTotal={initial.total}
        initialObservedAt={initial.observed?.observed_at}
        initialQuery={initialQuery}
      />
    </>
  );
}
