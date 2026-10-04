import { AppError } from "@/lib/errors";
import { z } from "zod";
import { cookies } from "next/headers";
import { requireTenant } from "@/lib/auth/context";
import { apiError, json, readJson, verifyOrigin } from "@/lib/security/http";
export async function POST(request: Request) {
  try {
    verifyOrigin(request);
    const ctx = await requireTenant(undefined, true);
    const { id } = z.object({ id: z.uuid() }).parse(await readJson(request));
    if (!ctx.memberships.some((m) => m.id === id))
      throw new AppError(403, "Loja indisponível.");
    (await cookies()).set("pedizza-tenant", id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
    return json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
