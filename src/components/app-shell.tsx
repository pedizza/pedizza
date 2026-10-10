"use client";
import { useEffect, useRef, useState } from "react";
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
  Bell,
  CreditCard,
  Menu,
  LogOut,
  ChevronDown,
  Store,
  ChevronRight,
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
  Bell,
  CreditCard,
};
export function AppShell({
  ctx,
  children,
}: {
  ctx: TenantContext;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const isOverview = path.startsWith("/app/visao-geral");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        menuTrigger.current?.focus();
      }
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const priority = [
    "/app/visao-geral",
    "/app/pedidos",
    "/app/conversas",
    "/app/cardapio",
  ];
  const links = navigation
    .filter((n) => ctx.permissions.includes(n.permission))
    .sort((a, b) => {
      const rank = (href: string) =>
        priority.includes(href) ? priority.indexOf(href) : priority.length;
      return rank(a.href) - rank(b.href);
    });
  const navigationGroups = [
    {
      label: "DIA A DIA",
      hrefs: ["/app/visao-geral", "/app/pedidos", "/app/conversas"],
    },
    {
      label: "CATÁLOGO E VENDAS",
      hrefs: ["/app/cardapio", "/app/clientes", "/app/campanhas"],
    },
    {
      label: "SUA LOJA",
      hrefs: ["/app/entrega", "/app/equipe", "/app/configuracoes"],
    },
  ];
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
    <div className="shell" data-module={path.split("/")[2] || "inicio"}>
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
            width={150}
            height={137}
            alt="Pedizza"
            preload
          />
        </Link>
        <nav className="nav-list" aria-label="Navegação principal">
          {navigationGroups.map((group) => {
            const groupLinks = links.filter((link) =>
              group.hrefs.includes(link.href),
            );
            if (!groupLinks.length) return null;
            return (
              <div className="navigation-group" key={group.label}>
                <div className="nav-section-label">{group.label}</div>
                {groupLinks.map((n) => {
                  const Icon = icons[n.icon as keyof typeof icons];
                  const active = path.startsWith(n.href);
                  return (
                    <Link
                      key={n.href}
                      href={n.href}
                      onClick={() => setOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={`nav-link ${active ? "active" : ""}`}
                    >
                      <Icon size={19} />
                      <span>{n.label}</span>
                      {active && (
                        <ChevronRight size={14} className="nav-current-arrow" />
                      )}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="nav-section-label">MINHA CONTA</div>
        <nav className="nav-list account-nav" aria-label="Conta e notificações">
          {ctx.permissions.includes("notifications.view") && (
            <Link
              href="/app/notificacoes"
              onClick={() => setOpen(false)}
              className={`nav-link ${path === "/app/notificacoes" ? "active" : ""}`}
            >
              <Bell size={18} /> Notificações
            </Link>
          )}
          {ctx.permissions.includes("subscription.view") && (
            <Link
              href="/app/assinatura"
              onClick={() => setOpen(false)}
              className={`nav-link ${path === "/app/assinatura" ? "active" : ""}`}
            >
              <CreditCard size={18} /> Minha assinatura
            </Link>
          )}
        </nav>
        <div className="sidebar-user">
          <div className="row">
            {ctx.hasStoreLogo && ctx.storeSettingsId ? (
              <Image
                className="tenant-logo-avatar"
                src={`/api/images?resource=loja&id=${ctx.storeSettingsId}`}
                width={48}
                height={48}
                alt={`Logo da ${ctx.tenantName}`}
                unoptimized
              />
            ) : (
              <span className="avatar">
                {ctx.name.slice(0, 2).toUpperCase()}
              </span>
            )}
            <div>
              <strong>{ctx.name}</strong>
              <small>{ctx.tenantName}</small>
            </div>
          </div>
          <div className="row between" style={{ marginTop: 14 }}>
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
        <header
          className={`topbar ${isOverview ? "overview-global-topbar" : ""}`}
        >
          <div className="row">
            <button
              ref={menuTrigger}
              aria-expanded={open}
              className="icon-button mobile-menu-button"
              onClick={() => setOpen(true)}
              aria-label="Abrir menu"
            >
              <Menu size={19} />
            </button>
            <span className="topbar-title">
              {current?.label ||
                (path === "/app/notificacoes"
                  ? "Notificações"
                  : path === "/app/assinatura"
                    ? "Minha assinatura"
                    : "Minha loja")}
            </span>
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
            {ctx.permissions.includes("notifications.view") && !isOverview && (
              <NotificationBell tenantId={ctx.tenantId} />
            )}
          </div>
        </header>
        <main className="page-content workspace-content">{children}</main>
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
        <button
          aria-expanded={open}
          aria-label="Todas as abas"
          onClick={() => setOpen(true)}
        >
          <Menu size={21} />
          <span>Mais</span>
        </button>
      </nav>
    </div>
  );
}
