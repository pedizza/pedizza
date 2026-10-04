import type { Metadata } from "next";
import { requirePage } from "@/lib/auth/context";
import { AppShell } from "@/components/app-shell";
export const metadata: Metadata = { robots: { index: false, follow: false } };
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await requirePage(undefined, true);
  return <AppShell ctx={ctx}>{children}</AppShell>;
}
