import "server-only";
import { z } from "zod";
import webpush from "web-push";
import { transaction, one, rows } from "@/lib/db";
import { privateFiles } from "@/lib/services/files";
import { storeMedia } from "./media";
import { sendText, sendMedia, mediaBase64 } from "@/lib/integrations/evolution";
import { reconcileMpPayment } from "@/lib/integrations/mercado-pago";
import { reconcileBravoTransaction } from "@/lib/integrations/bravopay";
import { processBotMessage } from "./chatbot";
import { notify, enqueue } from "./events";
import { normalizePhone } from "@/lib/domain/normalization";
import { AppError, invariant } from "@/lib/errors";
import { isPrivateAddress } from "@/lib/integrations/http";
type Job = {
  id: string;
  tenant_id: string;
  kind: string;
  payload: unknown;
  attempts: number;
};
async function claim(table: "outbox" | "webhook_events") {
  return transaction((db) =>
    one<Job>(
      db,
      `with job as (select id from private.${table} where (status='pending' and available_at<=now() or status='processing' and locked_at<now()-interval '2 minutes') and attempts<5 order by created_at for update skip locked limit 1) update private.${table} q set status='processing',attempts=attempts+1,locked_at=now() from job where q.id=job.id returning q.id,q.tenant_id,${table === "outbox" ? "q.kind" : "q.provider as kind"},q.payload,q.attempts`,
    ),
  );
}
async function complete(table: "outbox" | "webhook_events", id: string) {
  await transaction((db) =>
    db.query(`update private.${table} set status='done' where id=$1`, [id]),
  );
}
async function fail(
  table: "outbox" | "webhook_events",
  job: Job,
  terminal = false,
) {
  await transaction((db) =>
    db.query(
      `update private.${table} set status=$2,available_at=now()+$3*interval '1 second' where id=$1`,
      [
        job.id,
        terminal || job.attempts >= 5 ? "failed" : "pending",
        Math.min(3600, 30 * 2 ** job.attempts),
      ],
    ),
  );
}
export async function processOutbox(limit = 8) {
  for (let i = 0; i < limit; i++) {
    const job = await claim("outbox");
    if (!job) break;
    try {
      if (job.kind === "message") await dispatchMessage(job);
      else if (job.kind === "payment") {
        throw new AppError(410, "PIX automático desativado.");
      } else if (job.kind === "push") await dispatchPush(job);
      else throw new Error("Unknown job");
      await complete("outbox", job.id);
    } catch {
      await fail("outbox", job, job.kind === "message");
    }
  }
}
async function dispatchMessage(job: Job) {
  const input = z
    .object({
      conversationId: z.uuid(),
      sender: z.enum(["bot", "employee", "system"]),
      text: z.string().max(10000),
      epoch: z.number().optional(),
      userId: z.uuid().optional(),
      media: z
        .object({ path: z.string(), mime: z.string(), name: z.string() })
        .optional(),
    })
    .parse(job.payload);
  const target = await transaction(async (db) => {
    const c = await one<{
      bot_paused: boolean;
      bot_epoch: number;
      phone: string;
      instance_name: string;
      status: string;
    }>(
      db,
      "select c.bot_paused,c.bot_epoch,u.phone,w.instance_name,w.status from public.conversations c join public.customers u on u.tenant_id=c.tenant_id and u.id=c.customer_id join public.whatsapp_instances w on w.tenant_id=c.tenant_id and w.id=c.instance_id where c.tenant_id=$1 and c.id=$2",
      [job.tenant_id, input.conversationId],
    );
    if (
      !c ||
      (input.sender === "bot" && (c.bot_paused || c.bot_epoch !== input.epoch))
    )
      return null;
    const access = await one<{ active: boolean }>(
      db,
      "select private.subscription_active($1) active",
      [job.tenant_id],
    );
    if (!access?.active && input.sender !== "system") return null;
    await db.query(
      "insert into public.conversation_messages(tenant_id,conversation_id,client_message_id,direction,sender_type,user_id,body,status) values($1,$2,$3,'outbound',$4,$5,$6,'pending') on conflict(tenant_id,client_message_id) do nothing",
      [
        job.tenant_id,
        input.conversationId,
        job.id,
        input.sender,
        input.userId || null,
        input.text,
      ],
    );
    if (input.media) {
      invariant(
        input.media.path.startsWith(
          job.tenant_id + "/" + input.conversationId + "/",
        ),
        "Anexo inválido.",
      );
      await db.query(
        "update public.conversation_messages set media_path=$3,media_mime=$4,media_name=$5,message_type=$6 where tenant_id=$1 and client_message_id=$2",
        [
          job.tenant_id,
          job.id,
          input.media.path,
          input.media.mime,
          input.media.name,
          input.media.mime.split("/")[0],
        ],
      );
    }
    return c;
  });
  if (!target) return;
  try {
    invariant(target.status === "connected", "WhatsApp desconectado.");
    let externalId: string;
    if (input.media) {
      const { data, error } = await privateFiles()
        .storage.from("conversation-media")
        .download(input.media.path);
      invariant(data && !error, "Anexo indisponível.");
      externalId = await sendMedia(
        target.instance_name,
        target.phone,
        {
          data: Buffer.from(await data.arrayBuffer()),
          mime: input.media.mime,
          name: input.media.name,
        },
        input.text,
      );
    } else
      externalId = await sendText(
        target.instance_name,
        target.phone,
        input.text,
      );
    await transaction(async (db) => {
      await db.query(
        "delete from public.conversation_messages where tenant_id=$1 and external_message_id=$2 and client_message_id is null",
        [job.tenant_id, externalId],
      );
      await db.query(
        "update public.conversation_messages set external_message_id=$3,status='sent',sent_at=now() where tenant_id=$1 and client_message_id=$2",
        [job.tenant_id, job.id, externalId],
      );
      await db.query(
        "update public.conversations set last_message_at=now(),last_message_preview=$3 where tenant_id=$1 and id=$2",
        [job.tenant_id, input.conversationId, input.text.slice(0, 120)],
      );
    });
  } catch (error) {
    await transaction((db) =>
      db.query(
        "update public.conversation_messages set status='failed' where tenant_id=$1 and client_message_id=$2",
        [job.tenant_id, job.id],
      ),
    );
    throw error;
  }
}
const evolutionPayload = z.object({
  event: z.string(),
  instance: z.string(),
  data: z.unknown(),
});
export async function processWebhooks(limit = 8) {
  for (let i = 0; i < limit; i++) {
    const job = await claim("webhook_events");
    if (!job) break;
    try {
      if (job.kind === "evolution") await processEvolution(job);
      else if (job.kind === "mercado_pago")
        await reconcileMpPayment(
          z.object({ id: z.string() }).parse(job.payload).id,
        );
      else if (job.kind === "bravopay")
        await reconcileBravoTransaction(
          z.object({ id: z.string() }).parse(job.payload).id,
        );
      await complete("webhook_events", job.id);
    } catch {
      await fail("webhook_events", job);
    }
  }
  await processOutbox(limit);
}
async function processEvolution(job: Job) {
  const payload = evolutionPayload.parse(job.payload);
  const instance = await transaction((db) =>
    one<{ id: string; tenant_id: string; instance_name: string }>(
      db,
      "select id,tenant_id,instance_name from public.whatsapp_instances where instance_name=$1 and archived_at is null",
      [payload.instance],
    ),
  );
  if (!instance) return;
  const tenant = instance.tenant_id;
  const event = payload.event.toLowerCase().replaceAll("_", ".");
  if (event === "connection.update") {
    const data = z.object({ state: z.string() }).parse(payload.data);
    const status =
      data.state === "open"
        ? "connected"
        : data.state === "connecting"
          ? "connecting"
          : "disconnected";
    await transaction(async (db) => {
      const old = await one<{ status: string }>(
        db,
        "select status from public.whatsapp_instances where tenant_id=$1 and id=$2 for update",
        [tenant, instance.id],
      );
      await db.query(
        "update public.whatsapp_instances set status=$3,last_status_check_at=now(),connected_at=case when $3='connected' then now() else connected_at end where tenant_id=$1 and id=$2",
        [tenant, instance.id, status],
      );
      if (old?.status !== status)
        await notify(
          db,
          tenant,
          "wa:" + job.id,
          "whatsapp." + status,
          status === "connected"
            ? "WhatsApp conectado"
            : "WhatsApp desconectado",
          "Confira a conexão da sua pizzaria.",
          "/app/configuracoes/whatsapp",
          "whatsapp.view",
          instance.id,
        );
    });
    return;
  }
  if (event === "messages.update") {
    const list = Array.isArray(payload.data) ? payload.data : [payload.data];
    for (const item of list) {
      const p = z
        .object({
          key: z.object({ id: z.string() }).optional(),
          keyId: z.string().optional(),
          status: z.union([z.string(), z.number()]).optional(),
          update: z
            .object({ status: z.union([z.string(), z.number()]) })
            .optional(),
        })
        .safeParse(item);
      if (!p.success) continue;
      const id = p.data.key?.id || p.data.keyId;
      const raw = p.data.status || p.data.update?.status;
      const status = ["READ", "PLAYED", 4, 5].includes(raw || "")
        ? "read"
        : ["DELIVERY_ACK", 3].includes(raw || "")
          ? "delivered"
          : null;
      if (id && status)
        await transaction((db) =>
          db.query(
            "update public.conversation_messages set status=$3 where tenant_id=$1 and external_message_id=$2 and status<>'read'",
            [tenant, id, status],
          ),
        );
    }
    return;
  }
  if (event !== "messages.upsert") return;
  const data = z
    .object({
      key: z.object({
        id: z.string(),
        remoteJid: z.string(),
        fromMe: z.boolean().default(false),
      }),
      pushName: z.string().optional(),
      message: z.record(z.string(), z.unknown()),
      messageType: z.string().optional(),
    })
    .parse(payload.data);
  if (!data.key.remoteJid.endsWith("@s.whatsapp.net")) return;
  const phone = normalizePhone(data.key.remoteJid.split("@")[0]);
  const extended = z
    .object({ text: z.string().optional() })
    .safeParse(data.message.extendedTextMessage);
  const body =
    typeof data.message.conversation === "string"
      ? data.message.conversation
      : extended.success
        ? extended.data.text || ""
        : "";
  const record = await transaction(async (db) => {
    const customer = await one<{ id: string }>(
      db,
      "insert into public.customers(tenant_id,phone,name,source) values($1,$2,$3,'whatsapp') on conflict(tenant_id,phone) do update set phone=excluded.phone returning id",
      [tenant, phone, (data.pushName || "").slice(0, 120)],
    );
    const conv = await one<{ id: string; bot_paused: boolean }>(
      db,
      "insert into public.conversations(tenant_id,customer_id,instance_id,last_message_at) values($1,$2,$3,now()) on conflict(tenant_id,customer_id,instance_id) do update set last_message_at=now() returning id,bot_paused",
      [tenant, customer!.id, instance.id],
    );
    const existing = await one<{ id: string; processed_at: Date | null }>(
      db,
      "select id,processed_at from public.conversation_messages where tenant_id=$1 and external_message_id=$2",
      [tenant, data.key.id],
    );
    if (existing)
      return {
        conversationId: conv!.id,
        messageId: existing.id,
        processed: !!existing.processed_at,
      };
    const message = await one<{ id: string }>(
      db,
      "insert into public.conversation_messages(tenant_id,conversation_id,external_message_id,direction,sender_type,message_type,body,status,sent_at) values($1,$2,$3,$4,$5,$6,$7,'delivered',now()) returning id",
      [
        tenant,
        conv!.id,
        data.key.id,
        data.key.fromMe ? "outbound" : "inbound",
        data.key.fromMe ? "employee" : "customer",
        body ? "text" : "unsupported",
        body || "Mídia recebida — solicite atendimento para visualizar.",
      ],
    );
    await db.query(
      "update public.conversations set unread_count=unread_count+$3,last_message_at=now(),last_message_preview=$4 where tenant_id=$1 and id=$2",
      [
        tenant,
        conv!.id,
        data.key.fromMe ? 0 : 1,
        body.slice(0, 120) || "Mídia recebida",
      ],
    );
    if (data.key.fromMe)
      await db.query(
        "update public.conversations set bot_paused=true,status='human',bot_epoch=bot_epoch+1,version=version+1 where tenant_id=$1 and id=$2",
        [tenant, conv!.id],
      );
    else
      await notify(
        db,
        tenant,
        "message:" + data.key.id,
        "conversation.message",
        "Nova mensagem",
        "Há uma nova mensagem no atendimento.",
        "/app/conversas?id=" + conv!.id,
        "conversations.view",
        conv!.id,
      );
    return {
      conversationId: conv!.id,
      messageId: message!.id,
      processed: false,
    };
  });
  if (
    !body &&
    !record.processed &&
    ["imageMessage", "audioMessage", "videoMessage", "documentMessage"].some(
      (k) => k in data.message,
    )
  ) {
    try {
      const remote = await mediaBase64(instance.instance_name, data.key.id);
      const saved = await storeMedia(
        tenant,
        record.conversationId,
        Buffer.from(remote.base64.replace(/^data:[^;]+;base64,/, ""), "base64"),
        remote.fileName || "Anexo",
        false,
        remote.mimetype,
      );
      await transaction((db) =>
        db.query(
          "update public.conversation_messages set media_path=$3,media_mime=$4,media_name=$5,message_type=$6,body=$7 where tenant_id=$1 and id=$2",
          [
            tenant,
            record.messageId,
            saved.path,
            saved.mime,
            saved.name,
            saved.mime.split("/")[0],
            saved.name,
          ],
        ),
      );
    } catch {
      await transaction((db) =>
        db.query(
          "update public.conversation_messages set body='Anexo indisponível. Peça ao cliente para reenviar.' where tenant_id=$1 and id=$2",
          [tenant, record.messageId],
        ),
      );
    }
  }
  if (record.processed || data.key.fromMe) return;
  if (!body) {
    await transaction(async (db) => {
      await db.query(
        "update public.conversations set bot_paused=true,status='waiting_human',bot_epoch=bot_epoch+1 where tenant_id=$1 and id=$2",
        [tenant, record.conversationId],
      );
      await enqueue(db, tenant, "message", "media-help:" + record.messageId, {
        conversationId: record.conversationId,
        sender: "system",
        text: "Recebemos sua mídia. Vou chamar alguém da equipe para ajudar.",
      });
      await db.query(
        "update public.conversation_messages set processed_at=now() where id=$1",
        [record.messageId],
      );
    });
    return;
  }
  try {
    await processBotMessage(
      tenant,
      record.conversationId,
      record.messageId,
      body,
    );
  } catch (e) {
    if (e instanceof AppError && e.status === 400) {
      await transaction(async (db) => {
        await enqueue(db, tenant, "message", "bot-error:" + record.messageId, {
          conversationId: record.conversationId,
          sender: "system",
          text: e.message,
        });
        await db.query(
          "update public.conversation_messages set processed_at=now() where id=$1",
          [record.messageId],
        );
      });
    } else throw e;
  }
}
async function dispatchPush(job: Job) {
  if (
    !process.env.VAPID_PRIVATE_KEY ||
    !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
    !process.env.VAPID_SUBJECT
  )
    return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
  const { eventKey } = z.object({ eventKey: z.string() }).parse(job.payload);
  const subscriptions = await transaction((db) =>
    rows<{
      id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
      notification_id: string;
      action_url: string;
    }>(
      db,
      `select s.id,s.endpoint,s.p256dh,s.auth,n.id notification_id,n.action_url from private.push_subscriptions s join public.notifications n on n.tenant_id=s.tenant_id and n.user_id=s.user_id join public.tenant_members m on m.tenant_id=s.tenant_id and m.user_id=s.user_id join public.profiles p on p.id=s.user_id join public.notification_preferences pref on pref.tenant_id=s.tenant_id and pref.user_id=s.user_id where s.tenant_id=$1 and n.event_key=$2 and m.active and not p.blocked and pref.push_enabled and private.subscription_active(s.tenant_id) and (n.type not like 'order.%' or pref.orders_enabled) and (n.type not like 'conversation.%' or pref.messages_enabled) and (n.type not like 'whatsapp.%' or pref.whatsapp_enabled) and (m.role='owner' or coalesce((select allowed from public.member_permissions where member_id=m.id and permission=n.required_permission),exists(select 1 from public.role_permissions where role=m.role and permission=n.required_permission))) limit 100`,
      [job.tenant_id, eventKey],
    ),
  );
  for (const s of subscriptions) {
    const url = new URL(s.endpoint);
    if (
      url.protocol !== "https:" ||
      isPrivateAddress(url.hostname) ||
      ![
        "fcm.googleapis.com",
        "updates.push.services.mozilla.com",
        "web.push.apple.com",
      ].some((h) => url.hostname === h || url.hostname.endsWith("." + h))
    )
      continue;
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({
          id: s.notification_id,
          body: "Há uma nova atualização na sua loja.",
          url: s.action_url,
        }),
        { TTL: 300, timeout: 5000 },
      );
    } catch (e) {
      if (
        e instanceof webpush.WebPushError &&
        [404, 410].includes(e.statusCode)
      )
        await transaction((db) =>
          db.query("delete from private.push_subscriptions where id=$1", [
            s.id,
          ]),
        );
    }
  }
}
