import { requirePage } from "@/lib/auth/context";
import { transaction, one } from "@/lib/db";
import { Billing } from "@/components/billing";
import { PageHeader } from "@/components/ui/states";
export default async function Page() {
  const ctx = await requirePage("subscription.view", true);
  const s = await transaction(
    (db) =>
      one<{
        status: string;
        lifetime_access: boolean;
        price_cents: number;
        current_period_end: Date | null;
      }>(
        db,
        "select s.status,s.lifetime_access,p.price_cents,s.current_period_end from public.subscriptions s join public.subscription_plans p on p.id=s.plan_id where s.tenant_id=$1",
        [ctx.tenantId],
      ),
    ctx.userId,
  );
  return (
    <>
      <PageHeader
        title="Minha assinatura"
        description="Seu plano, pagamento e acesso ao Pedizza."
      />
      <Billing
        lifetime={!!s?.lifetime_access}
        status={s?.status || "pending"}
        price={s?.price_cents || 4700}
        period={s?.current_period_end?.toISOString() || null}
        canManage={ctx.permissions.includes("subscription.manage")}
        configured={
          !!(
            process.env.BRAVOPAY_API_KEY &&
            process.env.BRAVOPAY_WEBHOOK_SECRET &&
            process.env.BRAVOPAY_PRODUCT_ID
          )
        }
      />
    </>
  );
}
