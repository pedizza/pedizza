import Link from "next/link";
import { requirePage } from "@/lib/auth/context";
import { one, transaction } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { PageHeader } from "@/components/ui/states";
import { PublicMenuSettings } from "@/components/public-menu-settings";

export default async function PublicMenuSettingsPage() {
  const ctx = await requirePage("settings.view", true);
  const settings = await transaction(
    (db) =>
      one<{ public_menu_slug: string; public_menu_enabled: boolean }>(
        db,
        "select public_menu_slug,public_menu_enabled from public.store_settings where tenant_id=$1",
        [ctx.tenantId],
      ),
    ctx.userId,
  );
  if (!settings)
    throw new AppError(404, "Configurações da loja não encontradas.");
  return (
    <div className="public-menu-settings-page">
      <PageHeader
        title="Cardápio público"
        description="Compartilhe os produtos da sua pizzaria em uma página aberta para seus clientes."
        action={
          <Link href="/app/configuracoes" className="btn secondary">
            Voltar às configurações
          </Link>
        }
      />
      <PublicMenuSettings
        slug={settings.public_menu_slug}
        enabled={settings.public_menu_enabled}
        canEdit={ctx.permissions.includes("settings.edit")}
      />
    </div>
  );
}
