import { transaction, one } from "@/lib/db";
import { requirePage } from "@/lib/auth/context";
import { OrdersBoard } from "@/components/orders-board";
import { PageHeader } from "@/components/ui/states";
import { StoreStatusControl } from "@/components/store-status-control";
import { listOrders } from "@/lib/services/orders";
export default async function Page() {
  const ctx = await requirePage("orders.view");
  const initial = await transaction(async (db) => {
    const observed = await one<{
      observed_at: string;
      status_mode: string;
      trigger_mode: string;
      sound_enabled: boolean;
      orders_enabled: boolean;
    }>(
      db,
      `select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') observed_at,s.status_mode,
              coalesce(p.trigger_mode,'manual') trigger_mode,
              coalesce(n.sound_enabled,false) sound_enabled,
              coalesce(n.orders_enabled,true) orders_enabled
       from public.store_settings s
       left join public.print_settings p on p.tenant_id=s.tenant_id
       left join public.notification_preferences n on n.tenant_id=s.tenant_id and n.user_id=$2
       where s.tenant_id=$1`,
      [ctx.tenantId, ctx.userId],
    );
    return {
      ...(await listOrders(db, ctx.tenantId)),
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
        autoPrint={initial.observed?.trigger_mode === "on_accept"}
        initialOrders={initial.data}
        initialTotal={initial.total}
        initialObservedAt={initial.observed?.observed_at}
        soundEnabled={
          !!initial.observed?.sound_enabled &&
          !!initial.observed?.orders_enabled
        }
      />
    </>
  );
}
