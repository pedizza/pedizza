import { requirePage } from "@/lib/auth/context";
import { Conversations } from "@/components/conversations";
export default async function Page() {
  const ctx = await requirePage("conversations.view");
  return (
    <Conversations tenantId={ctx.tenantId} permissions={ctx.permissions} />
  );
}
