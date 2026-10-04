import { z } from "zod";
import { requireTenant } from "@/lib/auth/context";
import {
  apiError,
  json,
  verifyOrigin,
  readJson,
  rateLimit,
} from "@/lib/security/http";
import {
  resourceFor,
  listResource,
  saveResource,
  removeResource,
  archivePermission,
} from "@/lib/modules/service";
type Context = { params: Promise<{ resource: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    const { resource } = await params;
    const r = resourceFor(resource);
    const ctx = await requireTenant(r.read);
    const url = new URL(request.url);
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(url.searchParams.get("page") || 1);
    return json(
      await listResource(
        ctx,
        resource,
        page,
        (url.searchParams.get("q") || "").slice(0, 100),
        url.searchParams.get("id")
          ? z.uuid().parse(url.searchParams.get("id"))
          : undefined,
      ),
    );
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(request: Request, { params }: Context) {
  try {
    verifyOrigin(request);
    const { resource } = await params;
    const r = resourceFor(resource);
    const ctx = await requireTenant(r.write);
    await rateLimit(ctx.userId + ":write", 90);
    const { id, data, updated_at } = z
      .object({
        id: z.uuid().optional(),
        updated_at: z.string().optional(),
        data: z.unknown(),
      })
      .strict()
      .parse(await readJson(request));
    return json(await saveResource(ctx, resource, data, id, updated_at));
  } catch (e) {
    return apiError(e);
  }
}
export async function DELETE(request: Request, { params }: Context) {
  try {
    verifyOrigin(request);
    const { resource } = await params;
    const ctx = await requireTenant(archivePermission(resource));
    const { id } = z
      .object({ id: z.uuid() })
      .strict()
      .parse(await readJson(request));
    return json(await removeResource(ctx, resource, id));
  } catch (e) {
    return apiError(e);
  }
}
