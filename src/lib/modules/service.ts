import "server-only";
import { productSizesSchema } from "./product-sizes";
import {
  borderCategoryIdsSchema,
  borderOptionsSchema,
} from "./border-groups";
import { Temporal } from "@js-temporal/polyfill";
import { resources, resourceSchema } from "./registry";
import { transaction, rows, one, type DB } from "@/lib/db";
import { authorize, type TenantContext } from "@/lib/auth/context";
import { AppError, invariant } from "@/lib/errors";
import { normalizePhone, normalizeText } from "@/lib/domain/normalization";
import {
  validateHours,
  weeklyHoursSchema,
  type BusinessHour,
} from "@/lib/domain/hours";
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
  categoryId?: string,
) {
  const r = resourceFor(key);
  invariant(ctx.permissions.includes(r.read), "Sem permissão.", 403);
  const offset = (page - 1) * 20;
  const cols = [
    "id",
    // Preserve PostgreSQL microseconds for optimistic concurrency checks.
    `to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at`,
    ...r.fields.map((f) => f.key),
  ];
  if (["produtos", "categorias", "bordas"].includes(key))
    cols.push("image_path");
  if (key === "loja") cols.push("logo_path");
  if (key === "regras-precos") cols.push("name");
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
    if (key === "produtos" && categoryId) {
      params.push(categoryId);
      where += ` and category_id=$${params.length}`;
    }
    const count = await one<{ total: number }>(
      db,
      `select count(*)::int total from public.${r.table} where ${where}`,
      params,
    );
    params.push(offset);
    const data = await rows<DataRow>(
      db,
      `select ${cols.join(",")} from public.${r.table} where ${where} order by ${["produtos", "categorias", "bordas"].includes(key) ? "sort_order,name,id" : key === "faixas" ? "min_meters asc,id" : key === "bairros" ? "normalized_name,city,state,id" : "created_at desc,id"} limit 20 offset $${params.length}`,
      params,
    );
    if (key === "produtos" && data.length) {
      const prices = await rows<{
        item_id: string;
        name: string;
        price_cents: number;
        slices: number | null;
        max_flavors: number;
      }>(
        db,
        "select p.item_id,s.name,p.price_cents,s.slices,s.max_flavors from public.menu_item_prices p join public.menu_sizes s on s.tenant_id=p.tenant_id and s.id=p.size_id where p.tenant_id=$1 and p.item_id=any($2::uuid[]) and p.active and s.archived_at is null order by s.sort_order,s.name",
        [ctx.tenantId, data.map((row) => row.id)],
      );
      for (const row of data)
        row.sizes = prices
          .filter((p) => p.item_id === row.id)
          .map((p) => ({
            name: p.name,
            price_cents: p.price_cents,
            slices: p.slices,
            max_flavors: p.max_flavors,
          }));
    }
    if (key === "borda-categorias" && data.length) {
      const labels = await rows<{ id: string; name: string }>(
        db,
        "select x.id,b.name || ' → ' || c.name as name from public.menu_border_categories x join public.menu_borders b on b.tenant_id=x.tenant_id and b.id=x.border_id join public.menu_categories c on c.tenant_id=x.tenant_id and c.id=x.category_id where x.tenant_id=$1 and x.id=any($2::uuid[])",
        [ctx.tenantId, data.map((row) => row.id)],
      );
      for (const row of data)
        row.name = labels.find((label) => label.id === row.id)?.name;
    }
    if (key === "bordas" && data.length) {
      const groupIds = data.map((row) => row.id);
      const options = await rows<{
        id: string;
        group_id: string;
        name: string;
        description: string;
        price_cents: number;
        active: boolean;
        sort_order: number;
      }>(
        db,
        "select id,group_id,name,description,base_price_cents price_cents,active,sort_order from public.menu_borders where tenant_id=$1 and group_id=any($2::uuid[]) and archived_at is null order by sort_order,name,id",
        [ctx.tenantId, groupIds],
      );
      const links = await rows<{
        group_id: string;
        category_id: string;
        category_name: string;
      }>(
        db,
        "select x.group_id,x.category_id,c.name category_name from public.menu_border_group_categories x join public.menu_categories c on c.tenant_id=x.tenant_id and c.id=x.category_id where x.tenant_id=$1 and x.group_id=any($2::uuid[]) and c.archived_at is null order by c.sort_order,c.name,c.id",
        [ctx.tenantId, groupIds],
      );
      for (const row of data) {
        row.options = options.filter((option) => option.group_id === row.id);
        row.category_ids = links
          .filter((link) => link.group_id === row.id)
          .map((link) => link.category_id);
        row.category_names = links
          .filter((link) => link.group_id === row.id)
          .map((link) => link.category_name);
      }
    }
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
    const categories =
      ["produtos", "bordas"].includes(key)
        ? await rows<{ id: string; name: string }>(
            db,
            "select id,name from public.menu_categories where tenant_id=$1 and archived_at is null order by sort_order,name,id",
            [ctx.tenantId],
          )
        : undefined;
    if (categories && key === "produtos")
      for (const row of data)
        row.category_name =
          categories.find((c) => c.id === row.category_id)?.name ||
          "Categoria arquivada";
    return {
      data,
      total: count?.total || 0,
      page,
      ...(categories ? { categories } : {}),
    };
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
  invariant(
    key !== "regras-precos" || id,
    "Crie a categoria na aba Categorias antes de configurar a regra.",
  );
  let sizes: ReturnType<typeof productSizesSchema.parse> | undefined;
  let borderOptions: ReturnType<typeof borderOptionsSchema.parse> | undefined;
  let borderCategoryIds:
    | ReturnType<typeof borderCategoryIdsSchema.parse>
    | undefined;
  if (key === "produtos" && raw && typeof raw === "object" && "sizes" in raw) {
    const { sizes: inputSizes, ...fields } = raw;
    sizes = productSizesSchema.parse(inputSizes);
    raw = fields;
  }
  if (key === "bordas" && raw && typeof raw === "object") {
    const {
      options: inputOptions,
      category_ids: inputCategoryIds,
      ...fields
    } = raw as Record<string, unknown>;
    borderOptions = borderOptionsSchema.parse(inputOptions);
    borderCategoryIds = borderCategoryIdsSchema.parse(inputCategoryIds);
    raw = fields;
  }
  const data: Record<string, unknown> = resourceSchema(r).parse(raw);
  if (sizes?.length) data.base_price_cents = null;
  if (sizes !== undefined && !sizes.length)
    invariant(
      data.base_price_cents != null,
      "Informe o preço simples ou adicione tamanhos e preços.",
    );
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
    if (key === "bordas" && borderCategoryIds) {
      const categoryCount = await one<{ total: number }>(
        db,
        "select count(*)::int total from public.menu_categories where tenant_id=$1 and id=any($2::uuid[]) and archived_at is null",
        [ctx.tenantId, borderCategoryIds],
      );
      invariant(
        categoryCount?.total === borderCategoryIds.length,
        "Selecione categorias disponíveis.",
      );
    }
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
    if (key === "produtos" && sizes !== undefined) {
      const category = await one(
        db,
        "select id from public.menu_categories where tenant_id=$1 and id=$2 and archived_at is null",
        [ctx.tenantId, data.category_id],
      );
      invariant(category, "Selecione uma categoria disponível.");
      await db.query(
        "delete from public.menu_item_prices where tenant_id=$1 and item_id=$2",
        [ctx.tenantId, result.id],
      );
      for (const size of sizes) {
        let existing = await one<{
          id: string;
          slices: number | null;
          max_flavors: number;
        }>(
          db,
          "select id,slices,max_flavors from public.menu_sizes where tenant_id=$1 and category_id=$2 and lower(name)=lower($3) and archived_at is null order by created_at limit 1",
          [ctx.tenantId, data.category_id, size.name],
        );
        if (existing) {
          invariant(
            existing.slices === size.slices &&
              existing.max_flavors === size.max_flavors,
            `O tamanho ${size.name} já existe nesta categoria. Use ${existing.slices ?? "nenhuma"} fatias e ${existing.max_flavors} sabor(es).`,
          );
        } else {
          existing = await one(
            db,
            "insert into public.menu_sizes(tenant_id,category_id,name,slices,max_flavors) values($1,$2,$3,$4,$5) returning id,slices,max_flavors",
            [
              ctx.tenantId,
              data.category_id,
              size.name,
              size.slices,
              size.max_flavors,
            ],
          );
        }
        await db.query(
          "insert into public.menu_item_prices(tenant_id,item_id,size_id,price_cents,active) values($1,$2,$3,$4,true) on conflict(tenant_id,item_id,size_id) do update set price_cents=excluded.price_cents,active=true",
          [ctx.tenantId, result.id, existing!.id, size.price_cents],
        );
      }
    }
    if (key === "bordas" && borderOptions && borderCategoryIds) {
      const optionIds: string[] = [];
      for (const option of borderOptions) {
        if (option.id) {
          const saved = await one<{ id: string }>(
            db,
            "update public.menu_borders set name=$4,description=$5,base_price_cents=$6,active=$7,sort_order=$8,archived_at=null where tenant_id=$1 and group_id=$2 and id=$3 returning id",
            [
              ctx.tenantId,
              result.id,
              option.id,
              option.name,
              option.description,
              option.price_cents,
              option.active,
              option.sort_order,
            ],
          );
          invariant(saved, "Sabor de borda não encontrado.", 404);
          optionIds.push(saved.id);
        } else {
          const saved = await one<{ id: string }>(
            db,
            "insert into public.menu_borders(tenant_id,group_id,name,description,base_price_cents,active,sort_order) values($1,$2,$3,$4,$5,$6,$7) returning id",
            [
              ctx.tenantId,
              result.id,
              option.name,
              option.description,
              option.price_cents,
              option.active,
              option.sort_order,
            ],
          );
          optionIds.push(saved!.id);
        }
      }
      await db.query(
        "update public.menu_borders set active=false,archived_at=now() where tenant_id=$1 and group_id=$2 and not(id=any($3::uuid[])) and archived_at is null",
        [ctx.tenantId, result.id, optionIds],
      );
      await db.query(
        "delete from public.menu_border_prices p using public.menu_borders b where p.tenant_id=$1 and b.tenant_id=p.tenant_id and b.id=p.border_id and b.group_id=$2",
        [ctx.tenantId, result.id],
      );
      await db.query(
        "delete from public.menu_border_group_categories where tenant_id=$1 and group_id=$2",
        [ctx.tenantId, result.id],
      );
      for (const categoryId of borderCategoryIds)
        await db.query(
          "insert into public.menu_border_group_categories(tenant_id,group_id,category_id) values($1,$2,$3)",
          [ctx.tenantId, result.id, categoryId],
        );
    }
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

export async function setProductAvailability(
  ctx: TenantContext,
  id: string,
  available: boolean,
  expectedUpdatedAt?: string,
) {
  const r = resourceFor("produtos");
  return transaction(async (db) => {
    await authorize(db, ctx, r.write);
    const params: unknown[] = [ctx.tenantId, id, available];
    let where = "tenant_id=$1 and id=$2 and archived_at is null";
    if (expectedUpdatedAt) {
      params.push(expectedUpdatedAt);
      where += ` and updated_at=$${params.length}::timestamptz`;
    }
    const result = await one<DataRow>(
      db,
      `update public.menu_items set available=$3 where ${where} returning id,to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at`,
      params,
    );
    invariant(
      result,
      "O produto mudou ou não está disponível. Atualize a página.",
      409,
    );
    await audit(
      db,
      ctx.tenantId,
      ctx.userId,
      available ? "produtos.resumed" : "produtos.paused",
      r.table,
      id,
    );
    return { ...result, available };
  });
}

export async function setBorderGroupActive(
  ctx: TenantContext,
  id: string,
  active: boolean,
  expectedUpdatedAt?: string,
) {
  const r = resourceFor("bordas");
  return transaction(async (db) => {
    await authorize(db, ctx, r.write);
    const params: unknown[] = [ctx.tenantId, id, active];
    let where = "tenant_id=$1 and id=$2 and archived_at is null";
    if (expectedUpdatedAt) {
      params.push(expectedUpdatedAt);
      where += ` and updated_at=$${params.length}::timestamptz`;
    }
    const result = await one<DataRow>(
      db,
      `update public.menu_border_groups set active=$3 where ${where} returning id,to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at`,
      params,
    );
    invariant(
      result,
      "A borda mudou ou não está disponível. Atualize a página.",
      409,
    );
    await audit(
      db,
      ctx.tenantId,
      ctx.userId,
      active ? "bordas.resumed" : "bordas.paused",
      r.table,
      id,
    );
    return { ...result, active };
  });
}

export async function replaceBusinessHours(
  ctx: TenantContext,
  raw: unknown,
) {
  const hours = weeklyHoursSchema.parse(raw);
  validateHours(hours);
  const r = resourceFor("horarios");
  return transaction(async (db) => {
    await authorize(db, ctx, r.write);
    await db.query("select id from public.tenants where id=$1 for update", [
      ctx.tenantId,
    ]);
    await db.query(
      "delete from public.store_business_hours where tenant_id=$1",
      [ctx.tenantId],
    );
    for (const hour of hours)
      await db.query(
        "insert into public.store_business_hours(tenant_id,day_of_week,start_time,end_time) values($1,$2,$3,$4)",
        [
          ctx.tenantId,
          hour.day_of_week,
          hour.start_time,
          hour.end_time,
        ],
      );
    await audit(
      db,
      ctx.tenantId,
      ctx.userId,
      "horarios.replaced",
      r.table,
      null,
      { days: hours.length },
    );
    return { ok: true };
  });
}

export async function removeResource(
  ctx: TenantContext,
  key: string,
  id: string,
) {
  const r = resourceFor(key);
  invariant(
    !r.singleton && key !== "regras-precos",
    "Esta configuração não pode ser removida.",
  );
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
    if (key === "bordas")
      await db.query(
        "update public.menu_borders set active=false,archived_at=coalesce(archived_at,now()) where tenant_id=$1 and group_id=$2",
        [ctx.tenantId, id],
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
