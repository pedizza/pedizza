"use client";
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  ClipboardList,
  MessageCircle,
  Users,
  TicketPercent,
  Pizza,
  Bike,
  UserRoundCog,
  Settings,
  Menu,
  LogOut,
  ChevronDown,
  Store,
} from "lucide-react";
import type { TenantContext } from "@/lib/auth/context";
import { navigation } from "@/lib/navigation";
import { logout } from "@/app/auth/actions";
import { NotificationBell } from "./notification-bell";
import { PwaRegistration } from "./pwa";
const icons = {
  LayoutDashboard,
  ClipboardList,
  MessageCircle,
  Users,
  TicketPercent,
  Pizza,
  Bike,
  UserRoundCog,
  Settings,
};
export function AppShell({
  ctx,
  children,
}: {
  ctx: TenantContext;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const links = navigation.filter((n) =>
    ctx.permissions.includes(n.permission),
  );
  const current = links.find((n) => path.startsWith(n.href));
  async function switchTenant(id: string) {
    const r = await fetch("/api/tenant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (r.ok) {
      router.push("/app");
      router.refresh();
    }
  }
  return (
    <div className="shell">
      <PwaRegistration />
      {open && (
        <button
          className="drawer-backdrop"
          onClick={() => setOpen(false)}
          aria-label="Fechar navegação"
        />
      )}
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <Link className="brand" href="/app">
          <Image
            src="/logo.png"
            width={110}
            height={100}
            alt="Pedizza"
            priority
          />
        </Link>
        <div className="nav-section-label">SUA OPERAÇÃO</div>
        <nav className="nav-list" aria-label="Navegação principal">
          {links.map((n) => {
            const Icon = icons[n.icon as keyof typeof icons];
            return (
              <Link
                key={n.href}
                href={n.href}
                prefetch={false}
                onClick={() => setOpen(false)}
                className={`nav-link ${path.startsWith(n.href) ? "active" : ""}`}
              >
                <Icon size={18} />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-user">
          <div className="row">
            <span className="avatar">{ctx.name.slice(0, 2).toUpperCase()}</span>
            <div>
              <strong>{ctx.name}</strong>
              <small>{ctx.tenantName}</small>
            </div>
          </div>
          <div className="row between" style={{ marginTop: 14 }}>
            {ctx.permissions.includes("subscription.view") && (
              <Link
                href="/app/assinatura"
                className="muted"
                style={{ fontSize: 12 }}
              >
                Minha assinatura
              </Link>
            )}
            <form action={logout}>
              <button className="btn ghost small" aria-label="Sair da conta">
                <LogOut size={15} />
                Sair
              </button>
            </form>
          </div>
        </div>
      </aside>
      <div className="shell-main">
        <header className="topbar">
          <div className="row">
            <button
              className="icon-button mobile-menu-button"
              onClick={() => setOpen(true)}
              aria-label="Abrir menu"
            >
              <Menu size={19} />
            </button>
            <span className="topbar-title desktop-only">
              {current?.label || "Minha loja"}
            </span>
            <span className="badge desktop-only">Seu espaço de gestão</span>
          </div>
          <div className="row">
            <Store size={17} className="muted" />
            {ctx.memberships.length > 1 ? (
              <select
                aria-label="Trocar de pizzaria"
                value={ctx.tenantId}
                onChange={(e) => switchTenant(e.target.value)}
                style={{ maxWidth: 190 }}
              >
                {ctx.memberships.map((t) => (
                  <option value={t.id} key={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="topbar-title">{ctx.tenantName}</span>
            )}
            <ChevronDown size={13} className="desktop-only muted" />
            {ctx.permissions.includes("notifications.view") && (
              <NotificationBell tenantId={ctx.tenantId} />
            )}
          </div>
        </header>
        <main className="page-content">{children}</main>
      </div>
      <nav className="mobile-nav" aria-label="Navegação mobile">
        {links.slice(0, 3).map((n) => {
          const Icon = icons[n.icon as keyof typeof icons];
          return (
            <Link
              key={n.href}
              href={n.href}
              className={path.startsWith(n.href) ? "active" : ""}
            >
              <Icon size={21} />
              <span>
                {n.label === "Gestor de pedidos" ? "Pedidos" : n.label}
              </span>
            </Link>
          );
        })}
        <button onClick={() => setOpen(true)}>
          <Menu size={21} />
          <span>Mais</span>
        </button>
      </nav>
    </div>
  );
}
