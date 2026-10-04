import { z } from "zod";
import { TOTP, Secret } from "otpauth";
import { requireMaster } from "@/lib/auth/context";
import { transaction, one } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/security/crypto";
import {
  apiError,
  json,
  readJson,
  verifyOrigin,
  rateLimit,
} from "@/lib/security/http";
import { invariant } from "@/lib/errors";
export async function GET() {
  try {
    const u = await requireMaster(false);
    const a = await transaction((db) =>
      one<{ enabled: boolean }>(
        db,
        "select mfa_secret is not null enabled from private.accounts where id=$1",
        [u.id],
      ),
    );
    return json({ enabled: !!a?.enabled });
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(request: Request) {
  try {
    verifyOrigin(request);
    const u = await requireMaster(false);
    await rateLimit("mfa:" + u.id, 10, 300);
    const d = z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("enroll") }),
        z.object({
          action: z.literal("verify"),
          code: z.string().regex(/^\d{6}$/),
        }),
      ])
      .parse(await readJson(request));
    return json(
      await transaction(async (db) => {
        const a = await one<{
          mfa_secret: string | null;
          mfa_pending_secret: string | null;
          mfa_last_step: string | null;
        }>(
          db,
          "select mfa_secret,mfa_pending_secret,mfa_last_step from private.accounts where id=$1 for update",
          [u.id],
        );
        invariant(a, "Conta indisponível.", 403);
        if (d.action === "enroll") {
          invariant(!a.mfa_secret, "O autenticador já está configurado.");
          const secret = new Secret({ size: 20 });
          await db.query(
            "update private.accounts set mfa_pending_secret=$2 where id=$1",
            [u.id, encrypt(secret.base32)],
          );
          return { secret: secret.base32 };
        }
        const secret = a.mfa_secret || a.mfa_pending_secret;
        invariant(secret, "Configure seu autenticador.");
        const totp = new TOTP({
          issuer: "Pedizza",
          label: u.email,
          algorithm: "SHA1",
          digits: 6,
          period: 30,
          secret: Secret.fromBase32(decrypt(secret)),
        });
        const now = Date.now(),
          delta = totp.validate({ token: d.code, timestamp: now, window: 1 });
        const step = Math.floor(now / 30000) + (delta || 0);
        invariant(
          delta !== null && step > Number(a.mfa_last_step || 0),
          "Código inválido, expirado ou já utilizado.",
        );
        await db.query(
          "update private.accounts set mfa_secret=$2,mfa_pending_secret=null,mfa_last_step=$3 where id=$1",
          [u.id, secret, step],
        );
        await db.query(
          "update private.sessions set mfa_verified_at=now() where id=$1 and user_id=$2 and revoked_at is null",
          [u.sessionId, u.id],
        );
        return { ok: true };
      }),
    );
  } catch (e) {
    return apiError(e);
  }
}
