import { z } from "zod";
import sharp from "sharp";
import { requireTenant, authorize } from "@/lib/auth/context";
import { transaction, one } from "@/lib/db";
import { apiError, json, verifyOrigin, rateLimit } from "@/lib/security/http";
import { boundedBody } from "@/lib/security/body";
import { detectMedia } from "@/lib/services/media";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { invariant } from "@/lib/errors";
import { audit } from "@/lib/audit";
const config = {
  loja: {
    table: "store_settings",
    column: "logo_path",
    bucket: "store-logos",
    read: "settings.view",
    write: "settings.edit",
  },
  produtos: {
    table: "menu_items",
    column: "image_path",
    bucket: "menu-images",
    read: "menu.view",
    write: "menu.edit",
  },
  categorias: {
    table: "menu_categories",
    column: "image_path",
    bucket: "menu-images",
    read: "menu.view",
    write: "menu.edit",
  },
} as const;
function input(request: Request) {
  const u = new URL(request.url);
  return {
    r: config[
      z
        .enum(["loja", "produtos", "categorias"])
        .parse(u.searchParams.get("resource"))
    ],
    id: z.uuid().parse(u.searchParams.get("id")),
  };
}
export async function GET(request: Request) {
  try {
    const { r, id } = input(request),
      ctx = await requireTenant(r.read);
    const record = await transaction(
      (db) =>
        one<{ path: string }>(
          db,
          `select ${r.column} path from public.${r.table} where tenant_id=$1 and id=$2`,
          [ctx.tenantId, id],
        ),
      ctx.userId,
    );
    invariant(
      record?.path && record.path.startsWith(ctx.tenantId + "/"),
      "Imagem não encontrada.",
      404,
    );
    const { data, error } = await supabaseAdmin()
      .storage.from(r.bucket)
      .createSignedUrl(record.path, 60);
    invariant(data && !error, "Imagem indisponível.", 503);
    return Response.redirect(data.signedUrl, 302);
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(request: Request) {
  let uploaded: { bucket: string; path: string } | undefined;
  try {
    verifyOrigin(request);
    const { r, id } = input(request),
      ctx = await requireTenant(r.write);
    await rateLimit(ctx.userId + ":image", 10);
    const bytes = await boundedBody(request.body, 3 * 1024 * 1024);
    invariant(
      detectMedia(bytes)?.startsWith("image/"),
      "Envie uma imagem JPG, PNG ou WebP.",
    );
    const image = await sharp(bytes, { limitInputPixels: 25000000 })
      .rotate()
      .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
    const path = `${ctx.tenantId}/${id}/${crypto.randomUUID()}.webp`;
    const { error } = await supabaseAdmin()
      .storage.from(r.bucket)
      .upload(path, image, { contentType: "image/webp", upsert: false });
    invariant(!error, "Não foi possível salvar a imagem.", 503);
    uploaded = { bucket: r.bucket, path };
    const old = await transaction(async (db) => {
      await authorize(db, ctx, r.write);
      const record = await one<{ path: string | null }>(
        db,
        `select ${r.column} path from public.${r.table} where tenant_id=$1 and id=$2 for update`,
        [ctx.tenantId, id],
      );
      invariant(record, "Registro não encontrado.", 404);
      await db.query(
        `update public.${r.table} set ${r.column}=$3 where tenant_id=$1 and id=$2`,
        [ctx.tenantId, id, path],
      );
      await audit(db, ctx.tenantId, ctx.userId, "image.updated", r.table, id);
      return record.path;
    });
    uploaded = undefined;
    if (old?.startsWith(ctx.tenantId + "/"))
      await supabaseAdmin().storage.from(r.bucket).remove([old]);
    return json({ ok: true });
  } catch (e) {
    if (uploaded)
      await supabaseAdmin()
        .storage.from(uploaded.bucket)
        .remove([uploaded.path]);
    return apiError(e);
  }
}
