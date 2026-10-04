import { z } from "zod";
import { verifyMpSignature } from "@/lib/integrations/mercado-pago";
import { apiError, json, readJson } from "@/lib/security/http";
import { AppError } from "@/lib/errors";
import { acceptWebhook } from "@/lib/services/webhook";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const payload = z
      .object({
        id: z.union([z.string(), z.number()]),
        type: z.string(),
        data: z.object({ id: z.union([z.string(), z.number()]) }),
      })
      .parse(await readJson(request));
    const id = String(payload.data.id),
      urlId = new URL(request.url).searchParams.get("data.id");
    const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
    if (
      !secret ||
      (urlId && urlId.toLowerCase() !== id.toLowerCase()) ||
      !verifyMpSignature(
        id,
        request.headers.get("x-request-id") || "",
        request.headers.get("x-signature") || "",
        secret,
      )
    )
      throw new AppError(401, "Webhook inválido.");
    if (payload.type !== "payment") return json({ received: true });
    return json(
      await acceptWebhook("mercado_pago", String(payload.id), { id }),
    );
  } catch (e) {
    return apiError(e);
  }
}
