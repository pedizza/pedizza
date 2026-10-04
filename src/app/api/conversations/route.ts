import { z } from "zod";
import { after } from "next/server";
import { requireTenant, authorize } from "@/lib/auth/context";
import { transaction, rows, one } from "@/lib/db";
import {
  apiError,
  json,
  readJson,
  verifyOrigin,
  rateLimit,
} from "@/lib/security/http";
import { invariant } from "@/lib/errors";
import { enqueue } from "@/lib/services/events";
import { audit } from "@/lib/audit";
export async function GET(request: Request) {
  try {
    const ctx = await requireTenant("conversations.view");
    const u = new URL(request.url),
      id = u.searchParams.get("id");
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(u.searchParams.get("page") || 1);
    return json(
      await transaction(async (db) => {
        if (id) {
          z.uuid().parse(id);
          const conversation = await one(
            db,
            "select c.id,c.customer_id,c.status,c.bot_paused,c.assigned_user_id,c.unread_count,c.archived_at,u.name,u.phone from public.conversations c join public.customers u on u.tenant_id=c.tenant_id and u.id=c.customer_id where c.tenant_id=$1 and c.id=$2",
            [ctx.tenantId, id],
          );
          invariant(conversation, "Conversa não encontrada.", 404);
          const messages = await rows(
            db,
            "select id,direction,sender_type,message_type,body,status,media_path,media_mime,media_name,created_at from public.conversation_messages where tenant_id=$1 and conversation_id=$2 order by created_at desc,id desc limit 40 offset $3",
            [ctx.tenantId, id, (page - 1) * 40],
          );
          return {
            conversation,
            messages: messages.reverse(),
            hasMore: messages.length === 40,
          };
        }
        const q = (u.searchParams.get("q") || "").slice(0, 120),
          status = z
            .enum(["all", "bot", "human", "waiting_human", "closed"])
            .parse(u.searchParams.get("status") || "all");
        const where =
          "c.tenant_id=$1 and (u.name ilike $2 or u.phone ilike $2) and ($3='all' or c.status=$3) and c.archived_at is null";
        const args = [ctx.tenantId, "%" + q + "%", status];
        return {
          data: await rows(
            db,
            `select c.id,c.status,c.bot_paused,c.last_message_preview,c.last_message_at,c.unread_count,u.name,u.phone from public.conversations c join public.customers u on u.tenant_id=c.tenant_id and u.id=c.customer_id where ${where} order by c.last_message_at desc nulls last,c.id limit 20 offset $4`,
            [...args, (page - 1) * 20],
          ),
          ...(await one(
            db,
            `select count(*)::int total from public.conversations c join public.customers u on u.tenant_id=c.tenant_id and u.id=c.customer_id where ${where}`,
            args,
          )),
        };
      }, ctx.userId),
    );
  } catch (e) {
    return apiError(e);
  }
}
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("send"),
    id: z.uuid(),
    clientId: z.uuid(),
    text: z.string().trim().min(1).max(10000),
  }),
  z.object({
    action: z.enum(["read", "take", "resume", "close", "archive"]),
    id: z.uuid(),
  }),
]);
export async function POST(request: Request) {
  try {
    verifyOrigin(request);
    const ctx = await requireTenant("conversations.view");
    await rateLimit(ctx.userId + ":conversations", 90);
    const d = schema.parse(await readJson(request));
    const permission =
      d.action === "send"
        ? "conversations.send"
        : d.action === "take"
          ? "conversations.assign"
          : d.action === "resume"
            ? "conversations.resume_bot"
            : d.action === "read"
              ? "conversations.view"
              : "conversations.archive";
    await transaction(async (db) => {
      await authorize(db, ctx, permission);
      const conv = await one(
        db,
        "select id from public.conversations where tenant_id=$1 and id=$2 for update",
        [ctx.tenantId, d.id],
      );
      invariant(conv, "Conversa não encontrada.", 404);
      if (d.action === "read") {
        await db.query(
          "update public.conversations set unread_count=0 where tenant_id=$1 and id=$2",
          [ctx.tenantId, d.id],
        );
        await db.query(
          "update public.conversation_messages set read_at=coalesce(read_at,now()) where tenant_id=$1 and conversation_id=$2 and direction='inbound'",
          [ctx.tenantId, d.id],
        );
        return;
      }
      if (d.action === "send" || d.action === "take") {
        await db.query(
          "update public.conversations set status='human',bot_paused=true,bot_epoch=bot_epoch+1,version=version+1,assigned_user_id=$3,archived_at=null where tenant_id=$1 and id=$2",
          [ctx.tenantId, d.id, ctx.userId],
        );
        if (d.action === "send")
          await enqueue(
            db,
            ctx.tenantId,
            "message",
            "human:" + ctx.tenantId + ":" + d.clientId,
            {
              conversationId: d.id,
              sender: "employee",
              userId: ctx.userId,
              text: d.text,
            },
          );
      } else if (d.action === "resume") {
        await db.query(
          "update public.conversations set status='bot',bot_paused=false,bot_epoch=bot_epoch+1,version=version+1,assigned_user_id=null,archived_at=null where tenant_id=$1 and id=$2",
          [ctx.tenantId, d.id],
        );
      } else {
        await db.query(
          "update public.conversations set status='closed',bot_paused=true,bot_epoch=bot_epoch+1,version=version+1,assigned_user_id=null,archived_at=case when $3='archive' then now() else archived_at end where tenant_id=$1 and id=$2",
          [ctx.tenantId, d.id, d.action],
        );
      }
      await audit(
        db,
        ctx.tenantId,
        ctx.userId,
        "conversation." + d.action,
        "conversations",
        d.id,
      );
    });
    after(async () => {
      const { processOutbox } = await import("@/lib/services/worker");
      await processOutbox(5);
    });
    return json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
