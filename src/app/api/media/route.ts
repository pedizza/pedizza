import { z } from "zod";
import { after } from "next/server";
import { requireTenant, authorize } from "@/lib/auth/context";
import { transaction, one } from "@/lib/db";
import { apiError, json, verifyOrigin, rateLimit } from "@/lib/security/http";
import { boundedBody } from "@/lib/security/body";
import { storeMedia } from "@/lib/services/media";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { invariant } from "@/lib/errors";
import { enqueue } from "@/lib/services/events";
export async function GET(request: Request) {
  try {
    const ctx = await requireTenant("conversations.view");
    const id = z.uuid().parse(new URL(request.url).searchParams.get("id"));
    const m = await transaction(
      (db) =>
        one<{ media_path: string | null; media_name: string | null }>(
          db,
          "select media_path,media_name from public.conversation_messages where tenant_id=$1 and id=$2",
          [ctx.tenantId, id],
        ),
      ctx.userId,
    );
    invariant(
      m && m.media_path && m.media_path.startsWith(ctx.tenantId + "/"),
      "Anexo não encontrado.",
      404,
    );
    const { data, error } = await supabaseAdmin()
      .storage.from("conversation-media")
      .createSignedUrl(m.media_path, 60, { download: m.media_name || "anexo" });
    invariant(data && !error, "Anexo indisponível.", 503);
    return Response.redirect(data.signedUrl, 302);
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(request: Request) {
  let stored: string | undefined;
  try {
    verifyOrigin(request);
    const ctx = await requireTenant("conversations.send");
    await rateLimit(ctx.userId + ":media", 10, 60);
    const u = new URL(request.url);
    const id = z.uuid().parse(u.searchParams.get("conversation"));
    const name = z.string().min(1).max(150).parse(u.searchParams.get("name"));
    const exists = await transaction(
      (db) =>
        one(
          db,
          "select id from public.conversations where tenant_id=$1 and id=$2",
          [ctx.tenantId, id],
        ),
      ctx.userId,
    );
    invariant(exists, "Conversa não encontrada.", 404);
    const file = await storeMedia(
      ctx.tenantId,
      id,
      await boundedBody(request.body, 3 * 1024 * 1024),
      name,
      false,
      request.headers.get("content-type") || "",
    );
    stored = file.path;
    await transaction(async (db) => {
      await authorize(db, ctx, "conversations.send");
      await db.query(
        "update public.conversations set status='human',bot_paused=true,bot_epoch=bot_epoch+1,version=version+1,assigned_user_id=$3 where tenant_id=$1 and id=$2",
        [ctx.tenantId, id, ctx.userId],
      );
      await enqueue(
        db,
        ctx.tenantId,
        "message",
        "media:" + crypto.randomUUID(),
        {
          conversationId: id,
          sender: "employee",
          userId: ctx.userId,
          text: "",
          media: file,
        },
      );
    });
    stored = undefined;
    after(async () => {
      const { processOutbox } = await import("@/lib/services/worker");
      await processOutbox(3);
    });
    return json({ ok: true });
  } catch (e) {
    if (stored)
      await supabaseAdmin().storage.from("conversation-media").remove([stored]);
    return apiError(e);
  }
}
