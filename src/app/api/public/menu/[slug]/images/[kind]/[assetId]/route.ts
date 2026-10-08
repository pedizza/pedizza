import { z } from "zod";
import { one, transaction } from "@/lib/db";
import { AppError, invariant } from "@/lib/errors";
import { apiError } from "@/lib/security/http";
import { privateFiles } from "@/lib/services/files";

type Context = {
  params: Promise<{ slug: string; kind: string; assetId: string }>;
};
export async function GET(_request: Request, { params }: Context) {
  try {
    const { slug, kind, assetId } = await params;
    z.string()
      .min(3)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .parse(slug);
    const path = await transaction(async (db) => {
      const store = await one<{ tenant_id: string; logo_path: string | null }>(
        db,
        "select tenant_id,logo_path from public.store_settings where public_menu_slug=$1 and public_menu_enabled",
        [slug],
      );
      if (!store) throw new AppError(404, "Imagem não encontrada.");
      if (kind === "logo" && assetId === "logo")
        return {
          tenantId: store.tenant_id,
          path: store.logo_path,
          bucket: "store-logos",
        };
      const id = z.uuid().parse(assetId);
      if (kind === "product") {
        const image = await one<{ image_path: string | null }>(
          db,
          `select i.image_path from public.menu_items i join public.menu_categories c on c.tenant_id=i.tenant_id and c.id=i.category_id
           where i.tenant_id=$1 and i.id=$2 and i.active and i.available and i.archived_at is null and c.active and c.archived_at is null`,
          [store.tenant_id, id],
        );
        return {
          tenantId: store.tenant_id,
          path: image?.image_path,
          bucket: "menu-images",
        };
      }
      if (kind === "category") {
        const image = await one<{ image_path: string | null }>(
          db,
          `select c.image_path from public.menu_categories c where c.tenant_id=$1 and c.id=$2 and c.active and c.archived_at is null
           and exists(select 1 from public.menu_items i where i.tenant_id=c.tenant_id and i.category_id=c.id and i.active and i.available and i.archived_at is null)`,
          [store.tenant_id, id],
        );
        return {
          tenantId: store.tenant_id,
          path: image?.image_path,
          bucket: "menu-images",
        };
      }
      throw new AppError(404, "Imagem não encontrada.");
    });
    invariant(
      path.path && path.path.startsWith(path.tenantId + "/"),
      "Imagem não encontrada.",
      404,
    );
    const file = await privateFiles()
      .storage.from(path.bucket)
      .download(path.path);
    invariant(file.data && !file.error, "Imagem indisponível.", 404);
    return new Response(await file.data.arrayBuffer(), {
      headers: {
        "Content-Type": file.data.type,
        "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
