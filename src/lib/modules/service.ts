import "server-only";
import { Temporal } from "@js-temporal/polyfill";
import { resources, resourceSchema } from "./registry";
import { transaction, rows, one, type DB } from "@/lib/db";
import { authorize, type TenantContext } from "@/lib/auth/context";
import { AppError, invariant } from "@/lib/errors";
import { normalizePhone, normalizeText } from "@/lib/domain/normalization";
import { validateHours, type BusinessHour } from "@/lib/domain/hours";
import { audit } from "@/lib/audit";
export type DataRow = Record<string, unknown> & {
  id: string;
  updated_at: string;
};
export function resourceFor(key: string) {
  const resource = Object.hasOwn(resources, key) ? resources[key] : undefined;
  if (!resource) throw new AppError(404, "Módulo não encontrado.");
  return resource;
}
export async function listResource(
  ctx: TenantContext,
  key: string,
  page = 1,
  search = "",
  id?: string,
) {
  const r = resourceFor(key);
  invariant(ctx.permissions.includes(r.read), "Sem permissão.", 403);
  const offset = (page - 1) * 20;
  const cols = ["id", "updated_at", ...r.fields.map((f) => f.key)];
  if (["produtos", "categorias"].includes(key)) cols.push("image_path");
  if (key === "loja") cols.push("logo_path");
  return transaction(async (db) => {
    const params: unknown[] = [ctx.tenantId];
    let where = "tenant_id=$1";
    if (r.archive) where += " and archived_at is null";
    if (id) {
      params.push(id);
      where += ` and id=$${params.length}`;
    }
    if (search && r.search) {
      params.push("%" + search.replace(/[%_\\]/g, "\$&") + "%");
      where += ` and ${r.search} ilike $${params.length}`;
    }
    const count = await one<{ total: number }>(
      db,
      `select count(*)::int total from public.${r.table} where ${where}`,
      params,
    );
    params.push(offset);
    const data = await rows<DataRow>(
      db,
      `select ${cols.join(",")} from public.${r.table} where ${where} order by created_at desc,id limit 20 offset $${params.length}`,
      params,
    );
    const dates = r.fields.filter((f) => f.type === "datetime-local");
    if (dates.length) {
      const setting = await one<{ timezone: string }>(
        db,
        "select timezone from public.store_settings where tenant_id=$1",
        [ctx.tenantId],
      );
      const zone = setting?.timezone || "America/Sao_Paulo";
      for (const row of data)
        for (const field of dates) {
          const v = row[field.key];
          if (v)
            row[field.key] = Temporal.Instant.from(
              new Date(String(v)).toISOString(),
            )
              .toZonedDateTimeISO(zone)
              .toPlainDateTime()
              .toString()
              .slice(0, 16);
        }
    }
    return { data, total: count?.total || 0, page };
  }, ctx.userId);
}
async function validateRelations(
  db: DB,
  tenant: string,
  key: string,
  data: Record<string, unknown>,
  id?: string,
) {
  if (key === "horarios") {
    const hours = await rows<BusinessHour>(
      db,
      "select day_of_week,start_time::text,end_time::text from public.store_business_hours where tenant_id=$1 and id<>$2",
      [tenant, id || "00000000-0000-0000-0000-000000000000"],
    );
    validateHours([...hours, data as BusinessHour]);
  }
  if (key === "faixas" && data.active) {
    invariant(
      Number(data.max_meters) > Number(data.min_meters),
      "A distância final precisa ser maior que a inicial.",
    );
    const overlap = await one(
      db,
      "select id from public.delivery_distance_fees where tenant_id=$1 and active and id<>$2 and min_meters<$3 and max_meters>$4",
      [
        tenant,
        id || "00000000-0000-0000-0000-000000000000",
        data.max_meters,
        data.min_meters,
      ],
    );
    invariant(!overlap, "Esta faixa se sobrepõe a outra.");
  }
  if (key === "precos") {
    const match = await one(
      db,
      "select i.id from public.menu_items i join public.menu_sizes s on s.tenant_id=i.tenant_id and s.category_id=i.category_id where i.tenant_id=$1 and i.id=$2 and s.id=$3",
      [tenant, data.item_id, data.size_id],
    );
    invariant(match, "O tamanho precisa pertencer à categoria do produto.");
  }
  if (key === "pagamentos") {
    if (data.active && data.type === "pix_manual")
      invariant(String(data.pix_key).trim(), "Informe a chave PIX.");
    if (data.active && data.type === "pix_mercado_pago")
      invariant(
        await one(
          db,
          "select tenant_id from private.integration_credentials where tenant_id=$1 and provider='mercado_pago'",
          [tenant],
        ),
        "Conecte sua conta Mercado Pago antes de ativar o PIX.",
      );
    if (data.active === false && id) {
      const active = await one(
        db,
        "select id from public.payment_methods where tenant_id=$1 and active and archived_at is null and id<>$2 limit 1",
        [tenant, id],
      );
      invariant(active, "Mantenha pelo menos uma forma de pagamento ativa.");
    }
  }
  if (key === "enderecos" && data.is_default)
    await db.query(
      "update public.customer_addresses set is_default=false where tenant_id=$1 and customer_id=$2",
      [tenant, data.customer_id],
    );
}
export async function saveResource(
  ctx: TenantContext,
  key: string,
  raw: unknown,
  id?: string,
  expectedUpdatedAt?: string,
) {
  const r = resourceFor(key);
  const data: Record<string, unknown> = resourceSchema(r).parse(raw);
  if (key === "clientes") data.phone = normalizePhone(String(data.phone));
  for (const field of ["cpf", "cnpj", "postal_code"])
    if (typeof data[field] === "string")
      data[field] = data[field].replace(/\D/g, "");
  if (key === "bairros") {
    data.normalized_name = normalizeText(String(data.name));
    data.city = normalizeText(String(data.city));
    data.state = String(data.state).toUpperCase();
  }
  if (key === "cupons") data.code = String(data.code).toUpperCase().trim();
  return transaction(async (db) => {
    await authorize(db, ctx, r.write);
    const dateFields = r.fields.filter((f) => f.type === "datetime-local");
    if (dateFields.length) {
      const setting = await one<{ timezone: string }>(
        db,
        "select timezone from public.store_settings where tenant_id=$1",
        [ctx.tenantId],
      );
      for (const field of dateFields) {
        const v = data[field.key];
        if (v)
          data[field.key] = Temporal.PlainDateTime.from(String(v))
            .toZonedDateTime(setting?.timezone || "America/Sao_Paulo")
            .toInstant()
            .toString();
      }
    }

    await db.query("select id from public.tenants where id=$1 for update", [
      ctx.tenantId,
    ]);
    if (r.singleton && !id) {
      const existing = await one<{ id: string; updated_at: string }>(
        db,
        `select id,updated_at from public.${r.table} where tenant_id=$1`,
        [ctx.tenantId],
      );
      if (existing) {
        id = existing.id;
        expectedUpdatedAt = undefined;
      }
    }
    await validateRelations(db, ctx.tenantId, key, data, id);
    if (key === "loja" && id) {
      const old = await one<Record<string, unknown>>(
        db,
        "select postal_code,street,number,neighborhood,city,state from public.store_settings where tenant_id=$1",
        [ctx.tenantId],
      );
      if (
        old &&
        [
          "postal_code",
          "street",
          "number",
          "neighborhood",
          "city",
          "state",
        ].some((f) => old[f] !== data[f])
      ) {
        data.latitude = null;
        data.longitude = null;
      }
    }
    const keys = Object.keys(data);
    const values = Object.values(data);
    let result: DataRow | undefined;
    if (id) {
      values.push(ctx.tenantId, id);
      let where = `tenant_id=$${values.length - 1} and id=$${values.length}`;
      if (expectedUpdatedAt) {
        values.push(expectedUpdatedAt);
        where += ` and updated_at=$${values.length}::timestamptz`;
      }
      result = await one<DataRow>(
        db,
        `update public.${r.table} set ${keys.map((k, i) => `${k}=$${i + 1}`).join(",")} where ${where} returning id,updated_at`,
        values,
      );
    } else {
      values.push(ctx.tenantId);
      result = await one<DataRow>(
        db,
        `insert into public.${r.table}(${keys.join(",")},tenant_id) values(${values.map((_, i) => "$" + (i + 1)).join(",")}) returning id,updated_at`,
        values,
      );
    }
    invariant(
      result,
      "O registro mudou ou não está disponível. Atualize a página.",
      409,
    );
    await audit(
      db,
      ctx.tenantId,
      ctx.userId,
      `${key}.${id ? "updated" : "created"}`,
      r.table,
      result.id,
    );
    return result;
  });
}
export function archivePermission(key: string) {
  const r = resourceFor(key);
  return r.read.startsWith("menu.")
    ? "menu.archive"
    : r.read.startsWith("customers.")
      ? "customers.archive"
      : r.read.startsWith("campaigns.")
        ? "campaigns.archive"
        : r.write;
}
export async function removeResource(
  ctx: TenantContext,
  key: string,
  id: string,
) {
  const r = resourceFor(key);
  invariant(!r.singleton, "Esta configuração não pode ser removida.");
  return transaction(async (db) => {
    await authorize(db, ctx, archivePermission(key));
    await db.query("select id from public.tenants where id=$1 for update", [
      ctx.tenantId,
    ]);
    if (key === "pagamentos")
      await validateRelations(db, ctx.tenantId, key, { active: false }, id);
    if (key === "categorias")
      invariant(
        !(await one(
          db,
          "select id from public.menu_items where tenant_id=$1 and category_id=$2 and archived_at is null limit 1",
          [ctx.tenantId, id],
        )),
        "Arquive ou mova os produtos desta categoria primeiro.",
      );
    const q = r.archive
      ? `update public.${r.table} set archived_at=now() where tenant_id=$1 and id=$2 returning id`
      : `delete from public.${r.table} where tenant_id=$1 and id=$2 returning id`;
    invariant(
      await one(db, q, [ctx.tenantId, id]),
      "Registro não encontrado.",
      404,
    );
    await audit(db, ctx.tenantId, ctx.userId, key + ".removed", r.table, id);
    return { ok: true };
  });
}
