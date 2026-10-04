import { requirePage } from "@/lib/auth/context";
import { Notifications } from "@/components/notifications";
export default async function Page() {
  const ctx = await requirePage("notifications.view");
  return <Notifications tenantId={ctx.tenantId} />;
}
