import "server-only";
import { z } from "zod";
import { requiredEnv, appUrl } from "@/lib/env";
import { externalJson } from "./http";
export async function evolution(
  path: string,
  body?: unknown,
  method?: string,
  maxBytes?: number,
) {
  const base = new URL(requiredEnv("EVOLUTION_API_URL"));
  const url = new URL(
    base.pathname.replace(/\/$/, "") + "/" + path.replace(/^\//, ""),
    base.origin,
  );
  return externalJson(
    url,
    {
      method: method || (body ? "POST" : "GET"),
      headers: {
        apikey: requiredEnv("EVOLUTION_API_KEY"),
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    20000,
    maxBytes,
  );
}
export function instancePath(name: string) {
  return encodeURIComponent(
    z
      .string()
      .regex(/^pedizza_[a-f0-9_]+$/)
      .parse(name),
  );
}
export async function createInstance(name: string, phone: string) {
  return evolution("/instance/create", {
    instanceName: name,
    integration: "WHATSAPP-BAILEYS",
    number: phone,
    qrcode: true,
    rejectCall: true,
    groupsIgnore: true,
    alwaysOnline: false,
    readMessages: false,
    readStatus: false,
    syncFullHistory: false,
  });
}
export async function configureWebhook(name: string) {
  return evolution(`/webhook/set/${instancePath(name)}`, {
    webhook: {
      enabled: true,
      url: appUrl() + "/api/webhooks/evolution",
      webhookByEvents: false,
      webhookBase64: false,
      headers: { "x-webhook-secret": requiredEnv("EVOLUTION_WEBHOOK_SECRET") },
      events: ["CONNECTION_UPDATE", "MESSAGES_UPSERT", "MESSAGES_UPDATE"],
    },
  });
}
export async function getQr(name: string) {
  const result = await evolution(`/instance/connect/${instancePath(name)}`);
  const parsed = z
    .object({
      base64: z.string().optional(),
      code: z.string().optional(),
      pairingCode: z.string().nullable().optional(),
    })
    .parse(result);
  return {
    base64: parsed.base64,
    expiresAt: new Date(Date.now() + 45000).toISOString(),
  };
}
export async function getConnection(name: string) {
  const result = z
    .object({ instance: z.object({ state: z.string() }) })
    .parse(await evolution(`/instance/connectionState/${instancePath(name)}`));
  return result.instance.state === "open"
    ? "connected"
    : result.instance.state === "connecting"
      ? "connecting"
      : "disconnected";
}
export async function sendText(name: string, phone: string, text: string) {
  const response = await evolution(`/message/sendText/${instancePath(name)}`, {
    number: phone,
    text: text.slice(0, 10000),
    linkPreview: false,
  });
  return z.object({ key: z.object({ id: z.string() }) }).parse(response).key.id;
}

export const whatsAppListSchema = z.object({
  title: z.string().min(1).max(60),
  description: z.string().max(1024).default(""),
  buttonText: z.string().min(1).max(20),
  footerText: z.string().max(60).default(""),
  sections: z
    .array(
      z.object({
        title: z.string().min(1).max(24),
        rows: z
          .array(
            z.object({
              title: z.string().min(1).max(24),
              description: z.string().max(72).default(""),
              rowId: z.string().min(1).max(200),
            }),
          )
          .min(1)
          .max(10),
      }),
    )
    .min(1)
    .max(10),
});
export type WhatsAppList = z.infer<typeof whatsAppListSchema>;

export async function sendList(
  name: string,
  phone: string,
  list: WhatsAppList,
) {
  const response = await evolution(`/message/sendList/${instancePath(name)}`, {
    number: phone,
    ...whatsAppListSchema.parse(list),
  });
  return z.object({ key: z.object({ id: z.string() }) }).parse(response).key.id;
}

export async function mediaBase64(name: string, id: string) {
  return z
    .object({
      base64: z.string(),
      mimetype: z.string(),
      fileName: z.string().optional(),
    })
    .parse(
      await evolution(
        `/chat/getBase64FromMediaMessage/${instancePath(name)}`,
        { message: { key: { id } }, convertToMp4: false },
        "POST",
        28 * 1024 * 1024,
      ),
    );
}
export async function sendMedia(
  name: string,
  phone: string,
  media: { data: Buffer; mime: string; name: string },
  caption: string,
) {
  const response = await evolution(`/message/sendMedia/${instancePath(name)}`, {
    number: phone,
    mediatype: media.mime.startsWith("image/")
      ? "image"
      : media.mime.startsWith("video/")
        ? "video"
        : media.mime.startsWith("audio/")
          ? "audio"
          : "document",
    mimetype: media.mime,
    caption,
    media: media.data.toString("base64"),
    fileName: media.name,
  });
  return z.object({ key: z.object({ id: z.string() }) }).parse(response).key.id;
}
