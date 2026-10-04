import { boundedBody } from "@/lib/security/body";
import { z } from "zod";
import { verifyBravoSignature } from "@/lib/security/crypto";
import { apiError, json } from "@/lib/security/http";
import { AppError } from "@/lib/errors";
import { acceptWebhook } from "@/lib/services/webhook";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const raw = (await boundedBody(request.body, 65536)).toString("utf8");
    if (Buffer.byteLength(raw) > 65536)
      throw new AppError(413, "Payload grande demais.");
    const secret = process.env.BRAVOPAY_WEBHOOK_SECRET;
    if (
      !secret ||
      !verifyBravoSignature(
        raw,
        request.headers.get("bravopay-signature") ||
          request.headers.get("x-bravopay-signature") ||
          "",
        secret,
      )
    )
      throw new AppError(401, "Webhook inválido.");
    const payload = z
      .object({
        id: z.string().max(200),
        type: z.string(),
        data: z.object({ id: z.string().max(200) }),
      })
      .parse(JSON.parse(raw));
    if (
      ![
        "transaction.paid",
        "transaction.expired",
        "transaction.refunded",
        "transaction.chargeback",
        "transaction.failed",
        "transaction.created",
      ].includes(payload.type)
    )
      return json({ received: true });
    return json(
      await acceptWebhook("bravopay", payload.id, { id: payload.data.id }),
    );
  } catch (e) {
    return apiError(e);
  }
}
