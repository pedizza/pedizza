import type { Metadata } from "next";
import { transaction, one } from "@/lib/db";
import { requirePage } from "@/lib/auth/context";
import { OrdersBoard } from "@/components/orders-board";
import { DesktopOrdersShell } from "@/components/desktop-orders-shell";
import { StoreStatusControl } from "@/components/store-status-control";
import { listOrders } from "@/lib/services/orders";

export const metadata: Metadata = {
  title: "Gestor de Pedidos",
  robots: { index: false, follow: false },
};

export default async function Page() {
  const ctx = await requirePage(undefined, true);
  if (!ctx.subscriptionActive) {
    return (
      <DesktopOrdersShell ctx={ctx}>
        <div className="card desktop-orders-access-card">
          <h2>Sua assinatura precisa de atenção</h2>
          <p>Regularize o acesso pelo painel para voltar a receber pedidos.</p>
          <a className="btn" href="/app/assinatura" target="_blank">
            Regularizar assinatura
          </a>
        </div>
      </DesktopOrdersShell>
    );
  }
  if (!ctx.permissions.includes("orders.view")) {
    return (
      <DesktopOrdersShell ctx={ctx}>
        <div className="card desktop-orders-access-card">
          <h2>Acesso ao Gestor de Pedidos indisponível</h2>
          <p>
            Peça ao administrador da loja a permissão para visualizar pedidos.
          </p>
        </div>
      </DesktopOrdersShell>
    );
  }
  const initial = await transaction(async (db) => {
    const observed = await one<{
      observed_at: string;
      status_mode: string;
      trigger_mode: string;
    }>(
      db,
      `select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') observed_at,s.status_mode,
              coalesce(p.trigger_mode,'manual') trigger_mode
       from public.store_settings s
       left join public.print_settings p on p.tenant_id=s.tenant_id
       where s.tenant_id=$1`,
      [ctx.tenantId],
    );
    return { ...(await listOrders(db, ctx.tenantId)), observed };
  });

  return (
    <DesktopOrdersShell
      ctx={ctx}
      action={
        <StoreStatusControl
          initialMode={initial.observed?.status_mode || "automatic"}
          canManage={ctx.permissions.includes("settings.edit")}
        />
      }
    >
      <OrdersBoard
        tenantId={ctx.tenantId}
        permissions={ctx.permissions}
        autoPrint={initial.observed?.trigger_mode === "on_accept"}
        showConversation={false}
        initialOrders={initial.data}
        initialTotal={initial.total}
        initialObservedAt={initial.observed?.observed_at}
      />
    </DesktopOrdersShell>
  );
}
