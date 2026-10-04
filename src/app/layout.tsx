import type { Metadata, Viewport } from "next";
import "./globals.css";
import { headers } from "next/headers";
export const metadata: Metadata = {
  title: {
    default: "Pedizza — Sua pizzaria, organizada",
    template: "%s | Pedizza",
  },
  description: "Pedidos, atendimento e gestão para sua pizzaria.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Pedizza", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png", icon: "/icons/icon-192.png" },
};
export const viewport: Viewport = {
  themeColor: "#dc3025",
  width: "device-width",
  initialScale: 1,
};
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await headers();
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
