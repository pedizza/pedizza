import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./workspace.css";
import localFont from "next/font/local";
const manrope = localFont({
  src: "./fonts/Manrope.ttf",
  variable: "--font-manrope",
  display: "swap",
});
import { headers } from "next/headers";
export const metadata: Metadata = {
  metadataBase: new URL("https://www.pedizza.com.br"),
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
  themeColor: "#f8f7f4",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await headers();
  return (
    <html lang="pt-BR">
      <body className={manrope.variable}>{children}</body>
    </html>
  );
}
