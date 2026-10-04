import { z } from "zod";
import { after } from "next/server";
import { requireTenant } from "@/lib/auth/context";
import { transaction, rows, one } from "@/lib/db";
import {
  apiError,
  json,
  readJson,
  verifyOrigin,
  rateLimit,
} from "@/lib/security/http";
import {
  orderColumns,
  changeOrder,
  confirmManualPayment,
  type Order,
} from "@/lib/services/orders";
export async function GET(request: Request) {
  try {
    const ctx = await requireTenant("orders.view");
    const url = new URL(request.url),
      id = url.searchParams.get("id");
    return json(
      await transaction(async (db) => {
        if (id) {
          z.uuid().parse(id);
          const order = await one<Order>(
            db,
            `select ${orderColumns} from public.orders where tenant_id=$1 and id=$2`,
            [ctx.tenantId, id],
          );
          if (!order) return { order: null };
          const items = await rows(
            db,
            "select id,name_snapshot,size_name_snapshot,border_name_snapshot,quantity,unit_price_cents,observation from public.order_items where tenant_id=$1 and order_id=$2 order by created_at",
            [ctx.tenantId, id],
          );
          const history = await rows(
            db,
            "select id,from_status,to_status,created_at,note from public.order_status_history where tenant_id=$1 and order_id=$2 order by created_at",
            [ctx.tenantId, id],
          );
          return { order, items, history };
        }
        const page = z.coerce
          .number()
          .int()
          .min(1)
          .max(10000)
          .parse(url.searchParams.get("page") || 1);
        const status = url.searchParams.get("status") || "";
        const search = (url.searchParams.get("q") || "").slice(0, 100);
        const args = [ctx.tenantId, status, "%" + search + "%"];
        const where =
          "tenant_id=$1 and ($2='' or order_status=$2) and (customer_name_snapshot ilike $3 or order_number::text ilike $3)";
        const count = await one<{ total: number }>(
          db,
          `select count(*)::int total from public.orders where ${where}`,
          args,
        );
        return {
          data: await rows<Order>(
            db,
            `select ${orderColumns} from public.orders where ${where} order by created_at desc,id limit 20 offset $4`,
            [...args, (page - 1) * 20],
          ),
          total: count?.total || 0,
        };
      }, ctx.userId),
    );
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(request: Request) {
  try {
    verifyOrigin(request);
    const ctx = await requireTenant("orders.view");
    await rateLimit(ctx.userId + ":orders", 60);
    const data = z
      .object({
        id: z.uuid(),
        action: z.enum(["status", "payment"]),
        status: z.string().max(30).optional(),
        note: z.string().max(500).default(""),
        minutes: z.number().int().min(5).max(300).default(40),
      })
      .strict()
      .parse(await readJson(request));
    const result =
      data.action === "payment"
        ? await confirmManualPayment(ctx, data.id)
        : await changeOrder(
            ctx,
            data.id,
            data.status || "",
            data.note,
            data.minutes,
          );
    after(async () => {
      const { processOutbox } = await import("@/lib/services/worker");
      await processOutbox(5);
    });
    return json(result);
  } catch (e) {
    return apiError(e);
  }
}
