import { z } from "zod";
import { requireTenant, authorize } from "@/lib/auth/context";
import { transaction, one } from "@/lib/db";
import { audit } from "@/lib/audit";
import {
  apiError,
  json,
  rateLimit,
  readJson,
  verifyOrigin,
} from "@/lib/security/http";

const statusSchema = z
  .object({ mode: z.enum(["forced_open", "paused", "forced_closed"]) })
  .strict();

export async function POST(request: Request) {
  try {
    verifyOrigin(request);
    const ctx = await requireTenant("settings.edit");
    await rateLimit(ctx.userId + ":store-status", 30);
    const { mode } = statusSchema.parse(await readJson(request));
    const result = await transaction(async (db) => {
      await authorize(db, ctx, "settings.edit");
      const store = await one<{ status_mode: string }>(
        db,
        "update public.store_settings set status_mode=$2 where tenant_id=$1 returning status_mode",
        [ctx.tenantId, mode],
      );
      await audit(
        db,
        ctx.tenantId,
        ctx.userId,
        mode === "forced_open"
          ? "store.opened"
          : mode === "paused"
            ? "store.paused"
            : "store.closed",
        "store_settings",
        ctx.tenantId,
      );
      return store;
    }, ctx.userId);
    return json(result);
  } catch (error) {
    return apiError(error);
  }
}
