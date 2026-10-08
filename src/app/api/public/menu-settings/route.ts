import { z } from "zod";
import { authorize, requireTenant } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { one, transaction } from "@/lib/db";
import {
  apiError,
  json,
  rateLimit,
  readJson,
  verifyOrigin,
} from "@/lib/security/http";

const input = z
  .object({
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(3)
      .max(80)
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "Use letras sem acento, números e hífens no link.",
      ),
    enabled: z.boolean(),
  })
  .strict();

export async function GET() {
  try {
    const ctx = await requireTenant("settings.view", true);
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
    return json(settings);
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    verifyOrigin(request);
    const ctx = await requireTenant("settings.edit", true);
    await rateLimit(ctx.userId + ":public-menu", 20);
    const values = input.parse(await readJson(request));
    const saved = await transaction(async (db) => {
      await authorize(db, ctx, "settings.edit", true);
      return one<{ public_menu_slug: string; public_menu_enabled: boolean }>(
        db,
        "update public.store_settings set public_menu_slug=$2,public_menu_enabled=$3 where tenant_id=$1 returning public_menu_slug,public_menu_enabled",
        [ctx.tenantId, values.slug, values.enabled],
      );
    }, ctx.userId);
    if (!saved)
      throw new AppError(404, "Configurações da loja não encontradas.");
    return json(saved);
  } catch (error) {
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      error.code === "23505"
    )
      return apiError(
        new AppError(
          409,
          "Esse endereço já está sendo usado por outra pizzaria.",
        ),
      );
    return apiError(error);
  }
}
