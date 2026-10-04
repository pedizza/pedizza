import { z } from "zod";
import { requireTenant } from "@/lib/auth/context";
import {
  apiError,
  json,
  readJson,
  verifyOrigin,
  rateLimit,
} from "@/lib/security/http";
import {
  lookupCep,
  quoteDelivery,
  addressSchema,
} from "@/lib/integrations/geo";
export async function POST(request: Request) {
  try {
    verifyOrigin(request);
    const ctx = await requireTenant("delivery.view");
    await rateLimit(ctx.tenantId + ":geo", 20);
    const body = z
      .discriminatedUnion("action", [
        z.object({
          action: z.literal("cep"),
          cep: z.string().regex(/^\d{8}$/),
        }),
        z.object({ action: z.literal("quote"), address: addressSchema }),
      ])
      .parse(await readJson(request));
    return json(
      body.action === "cep"
        ? await lookupCep(ctx.tenantId, body.cep)
        : await quoteDelivery(ctx.tenantId, body.address),
    );
  } catch (e) {
    return apiError(e);
  }
}
