import type { Permission } from "./permissions";
export const navigation: {
  href: string;
  label: string;
  icon: string;
  permission: Permission;
}[] = [
  {
    href: "/app/visao-geral",
    label: "Visão geral",
    icon: "LayoutDashboard",
    permission: "dashboard.view",
  },
  {
    href: "/app/pedidos",
    label: "Gestor de pedidos",
    icon: "ClipboardList",
    permission: "orders.view",
  },
  {
    href: "/app/conversas",
    label: "Conversas",
    icon: "MessageCircle",
    permission: "conversations.view",
  },
  {
    href: "/app/clientes",
    label: "Clientes",
    icon: "Users",
    permission: "customers.view",
  },
  {
    href: "/app/campanhas",
    label: "Campanhas e cupons",
    icon: "TicketPercent",
    permission: "campaigns.view",
  },
  {
    href: "/app/cardapio",
    label: "Cardápio",
    icon: "Pizza",
    permission: "menu.view",
  },
  {
    href: "/app/entrega",
    label: "Entrega",
    icon: "Bike",
    permission: "delivery.view",
  },
  {
    href: "/app/equipe",
    label: "Equipe",
    icon: "UserRoundCog",
    permission: "team.view",
  },
  {
    href: "/app/configuracoes",
    label: "Configurações",
    icon: "Settings",
    permission: "settings.view",
  },
];
