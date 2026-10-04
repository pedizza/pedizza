import { z } from "zod";
import { requireTenant, authorize } from "@/lib/auth/context";
import { transaction, one } from "@/lib/db";
import {
  apiError,
  json,
  verifyOrigin,
  readJson,
  rateLimit,
} from "@/lib/security/http";
import {
  createInstance,
  configureWebhook,
  getQr,
  getConnection,
  evolution,
  instancePath,
} from "@/lib/integrations/evolution";
import { normalizePhone } from "@/lib/domain/normalization";
import { audit } from "@/lib/audit";
import { invariant } from "@/lib/errors";
type Instance = {
  id: string;
  instance_name: string;
  display_name: string;
  phone: string;
  status: string;
};
export async function GET() {
  try {
    const ctx = await requireTenant("whatsapp.view");
    const instance = await transaction(
      (db) =>
        one<Instance>(
          db,
          "select id,instance_name,display_name,phone,status from public.whatsapp_instances where tenant_id=$1 and archived_at is null",
          [ctx.tenantId],
        ),
      ctx.userId,
    );
    return json({
      configured: !!(
        process.env.EVOLUTION_API_URL &&
        process.env.EVOLUTION_API_KEY &&
        process.env.EVOLUTION_WEBHOOK_SECRET
      ),
      instance: instance
        ? {
            id: instance.id,
            display_name: instance.display_name,
            phone: instance.phone,
            status: instance.status,
          }
        : null,
    });
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(request: Request) {
  try {
    verifyOrigin(request);
    const ctx = await requireTenant("whatsapp.manage");
    await rateLimit(ctx.tenantId + ":whatsapp", 10, 60);
    const input = z
      .object({
        action: z.enum(["connect", "refresh", "disconnect", "remove"]),
        phone: z.string().max(25).optional(),
        name: z.string().max(80).optional(),
      })
      .strict()
      .parse(await readJson(request));
    invariant(
      process.env.EVOLUTION_API_URL &&
        process.env.EVOLUTION_API_KEY &&
        process.env.EVOLUTION_WEBHOOK_SECRET,
      "A integração WhatsApp ainda não foi configurada.",
      503,
    );
    let created = false;
    const instance = await transaction(async (db) => {
      await authorize(db, ctx, "whatsapp.manage");
      await db.query("select id from public.tenants where id=$1 for update", [
        ctx.tenantId,
      ]);
      const current = await one<Instance>(
        db,
        "select id,instance_name,display_name,phone,status from public.whatsapp_instances where tenant_id=$1 and archived_at is null",
        [ctx.tenantId],
      );
      if (current) return current;
      invariant(input.action === "connect", "Nenhuma conexão disponível.");
      created = true;
      return (await one<Instance>(
        db,
        "insert into public.whatsapp_instances(tenant_id,instance_name,display_name,phone,status) values($1,$2,$3,$4,'creating') returning id,instance_name,display_name,phone,status",
        [
          ctx.tenantId,
          "pedizza_" +
            ctx.tenantId.replaceAll("-", "") +
            "_" +
            crypto.randomUUID().replaceAll("-", "").slice(0, 8),
          input.name || ctx.tenantName,
          normalizePhone(input.phone || ""),
        ],
      ))!;
    });
    if (input.action === "disconnect" || input.action === "remove") {
      await evolution(
        `/instance/${input.action === "remove" ? "delete" : "logout"}/${instancePath(instance.instance_name)}`,
        undefined,
        "DELETE",
      );
      await transaction(async (db) => {
        await authorize(db, ctx, "whatsapp.manage");
        await db.query(
          `update public.whatsapp_instances set status='disconnected'${input.action === "remove" ? ",archived_at=now()" : ""} where tenant_id=$1 and id=$2`,
          [ctx.tenantId, instance.id],
        );
        await audit(
          db,
          ctx.tenantId,
          ctx.userId,
          "whatsapp." + input.action,
          "whatsapp_instances",
          instance.id,
        );
      });
      return json({ ok: true });
    }
    if (created) await createInstance(instance.instance_name, instance.phone);
    else if (instance.status === "creating") {
      try {
        await getConnection(instance.instance_name);
      } catch {
        await createInstance(instance.instance_name, instance.phone);
      }
    }
    await configureWebhook(instance.instance_name);
    const status = await getConnection(instance.instance_name);
    await transaction((db) =>
      db.query(
        "update public.whatsapp_instances set status=$3,last_status_check_at=now(),webhook_configured_at=now() where tenant_id=$1 and id=$2",
        [ctx.tenantId, instance.id, status],
      ),
    );
    return json({
      status,
      ...(status !== "connected" ? await getQr(instance.instance_name) : {}),
    });
  } catch (e) {
    return apiError(e);
  }
}
