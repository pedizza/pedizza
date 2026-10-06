import type { Metadata } from "next";
import { transaction, one } from "@/lib/db";
import { requirePage } from "@/lib/auth/context";
import { OrdersBoard } from "@/components/orders-board";
import { DesktopOrdersShell } from "@/components/desktop-orders-shell";

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
    <DesktopOrdersShell ctx={ctx}>
      <OrdersBoard
        tenantId={ctx.tenantId}
        permissions={ctx.permissions}
        autoPrint={print?.trigger_mode === "on_accept"}
        showConversation={false}
      />
    </DesktopOrdersShell>
  );
}
