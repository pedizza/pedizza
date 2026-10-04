import { requireTenant } from "@/lib/auth/context";
import { verifyOrigin, apiError, json, rateLimit } from "@/lib/security/http";
import { createBillingCharge } from "@/lib/integrations/bravopay";
export async function POST(request: Request) {
  try {
    verifyOrigin(request);
    const ctx = await requireTenant("subscription.manage", true);
    await rateLimit(ctx.tenantId + ":billing", 5, 300);
    return json(await createBillingCharge(ctx));
  } catch (e) {
    return apiError(e);
  }
}
