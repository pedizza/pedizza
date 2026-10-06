"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { ClipboardList, LogOut, Store } from "lucide-react";
import type { TenantContext } from "@/lib/auth/context";
import { logout } from "@/app/auth/actions";
import { NotificationBell } from "./notification-bell";

export function DesktopOrdersShell({
  ctx,
  children,
  action,
}: {
  ctx: TenantContext;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  const router = useRouter();

  async function switchTenant(id: string) {
    const response = await fetch("/api/tenant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (response.ok) router.refresh();
  }

  return (
    <div className="desktop-orders-shell">
      <header className="desktop-orders-header">
        <div className="desktop-orders-brand">
          <Image
            src="/logo.png"
            width={52}
            height={48}
            alt="Pedizza"
            priority
          />
          <div>
            <strong>Gestor de Pedidos</strong>
            <small>Pedidos em tempo real</small>
          </div>
        </div>
        <div className="desktop-orders-account">
          <Store size={17} className="muted" />
          {ctx.memberships.length > 1 ? (
            <select
              aria-label="Trocar de pizzaria"
              value={ctx.tenantId}
              onChange={(event) => void switchTenant(event.target.value)}
            >
              {ctx.memberships.map((tenant) => (
                <option value={tenant.id} key={tenant.id}>
                  {tenant.name}
                </option>
              ))}
            </select>
          ) : (
            <strong>{ctx.tenantName}</strong>
          )}
          {ctx.permissions.includes("notifications.view") && (
            <NotificationBell tenantId={ctx.tenantId} />
          )}
          <form action={logout}>
            <button className="btn ghost small" aria-label="Sair da conta">
              <LogOut size={16} />
              Sair
            </button>
          </form>
        </div>
      </header>
      <main className="desktop-orders-content">
        <div className="desktop-orders-title">
          <div className="desktop-orders-title-copy">
            <div className="desktop-orders-title-icon">
              <ClipboardList size={22} />
            </div>
            <div>
              <h1>Pedidos</h1>
              <p>Acompanhe e atualize toda a operação.</p>
            </div>
          </div>
          {action}
        </div>
        {children}
      </main>
    </div>
  );
}
