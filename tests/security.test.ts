import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { priceCart } from "@/lib/services/pricing";
import { finalizeCart } from "@/lib/services/orders";
import type { DB } from "@/lib/db";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
const db = new PGlite();
const a = "10000000-0000-4000-8000-000000000001",
  b = "10000000-0000-4000-8000-000000000002";
let ta: string, tb: string;
beforeAll(async () => {
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
  );
  let customAuthMigration = "";
  for (const file of (await readdir("supabase/migrations"))
    .filter((x) => x.endsWith(".sql") && !x.includes("storage"))
    .sort())
    if (file.includes("local_auth"))
      customAuthMigration = await readFile(
        "supabase/migrations/" + file,
        "utf8",
      );
    else await db.exec(await readFile("supabase/migrations/" + file, "utf8"));
  await db.query(
    `insert into auth.users values($1,'{"name":"A","store_name":"Pizza A"}'),($2,'{"name":"B","store_name":"Pizza B"}')`,
    [a, b],
  );
  if (customAuthMigration) await db.exec(customAuthMigration);
  ta = (
    await db.query<{ tenant_id: string }>(
      "select tenant_id from public.tenant_members where user_id=$1",
      [a],
    )
  ).rows[0].tenant_id;
  tb = (
    await db.query<{ tenant_id: string }>(
      "select tenant_id from public.tenant_members where user_id=$1",
      [b],
    )
  ).rows[0].tenant_id;
  await db.exec(
    "update public.subscriptions set status='active',current_period_end=now()+interval '30 days'",
  );
}, 30000);
afterAll(() => db.close());
async function asUser<T>(user: string, sql: string, args: unknown[] = []) {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      user,
    ]);
    await db.exec("set local role authenticated");
    const result = await db.query<T>(sql, args);
    await db.exec("rollback");
    return result;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
describe("PostgreSQL RLS real", () => {
  it("limits tenants and settings to active membership", async () => {
    const result = await asUser<{ tenant_id: string }>(
      a,
      "select tenant_id from public.store_settings",
    );
    expect(result.rows.map((x) => x.tenant_id)).toEqual([ta]);
    expect(
      (
        await asUser(
          a,
          "select id from public.store_settings where tenant_id=$1",
          [tb],
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("blocks cross-tenant insert and composite foreign keys", async () => {
    await expect(
      asUser(
        a,
        "insert into public.customers(tenant_id,name,phone) values($1,'Intruso','5511999999999')",
        [tb],
      ),
    ).rejects.toThrow();
    const c = await db.query<{ id: string }>(
      "insert into public.menu_categories(tenant_id,name) values($1,'Pizzas') returning id",
      [tb],
    );
    await expect(
      db.query(
        "insert into public.menu_items(tenant_id,category_id,name) values($1,$2,$3)",
        [ta, c.rows[0].id, "Inválido"],
      ),
    ).rejects.toThrow();
  });
  it("normal user cannot become super admin or change billing", async () => {
    expect(
      (
        await asUser<{ is_super_admin: boolean }>(
          a,
          "select public.is_super_admin()",
        )
      ).rows[0].is_super_admin,
    ).toBe(false);
    await expect(
      asUser(a, "insert into private.super_admins(user_id) values($1)", [a]),
    ).rejects.toThrow();
    await expect(
      asUser(a, "update public.subscriptions set status='active'"),
    ).rejects.toThrow();
  });
  it("revoked membership loses access on next statement", async () => {
    await db.query(
      "update public.tenant_members set active=false where user_id=$1",
      [a],
    );
    expect(
      (await asUser(a, "select id from public.store_settings")).rows,
    ).toHaveLength(0);
    await db.query(
      "update public.tenant_members set active=true where user_id=$1",
      [a],
    );
  });
  it("suspension blocks operational tables while billing remains readable", async () => {
    await db.query(
      "update public.tenants set manually_suspended=true where id=$1",
      [ta],
    );
    expect(
      (await asUser(a, "select id from public.customers")).rows,
    ).toHaveLength(0);
    expect(
      (await asUser(a, "select id from public.subscriptions")).rows,
    ).toHaveLength(1);
    await db.query(
      "update public.tenants set manually_suspended=false where id=$1",
      [ta],
    );
  });
  it("anonymous cannot query private data", async () => {
    await db.exec("begin;set local role anon");
    try {
      await expect(db.query("select id from public.tenants")).rejects.toThrow();
    } finally {
      await db.exec("rollback");
    }
  });
  it("browser cannot modify orders or grant itself permissions", async () => {
    await expect(
      asUser(a, "update public.orders set total_cents=0"),
    ).rejects.toThrow();
    await expect(
      asUser(a, "update public.tenant_members set role='owner'"),
    ).rejects.toThrow();
  });
});

describe("Order integrity against PostgreSQL", () => {
  it("reprices, confirms exactly once, and preserves a snapshot after menu edits", async () => {
    const query = async (sql: string, args: unknown[] = []) =>
      db.query<{ id: string }>(sql, args);
    const category = (
      await query(
        "insert into public.menu_categories(tenant_id,name,allow_split,split_pricing) values($1,'Pizzas QA',true,'highest') returning id",
        [ta],
      )
    ).rows[0].id;
    const product = (
      await query(
        "insert into public.menu_items(tenant_id,category_id,name,base_price_cents) values($1,$2,'Marguerita',4500) returning id",
        [ta, category],
      )
    ).rows[0].id;
    const customer = (
      await query(
        "insert into public.customers(tenant_id,name,phone) values($1,'Cliente QA','5511998761234') returning id",
        [ta],
      )
    ).rows[0].id;
    const method = (
      await query(
        "select id from public.payment_methods where tenant_id=$1 and type='cash'",
        [ta],
      )
    ).rows[0].id;
    await query(
      "update public.store_settings set status_mode='forced_open' where tenant_id=$1",
      [ta],
    );
    const instance = (
      await query(
        "insert into public.whatsapp_instances(tenant_id,display_name,instance_name,phone) values($1,'QA','pedizza_qa','5511999998888') returning id",
        [ta],
      )
    ).rows[0].id;
    const conversation = (
      await query(
        "insert into public.conversations(tenant_id,customer_id,instance_id) values($1,$2,$3) returning id",
        [ta, customer, instance],
      )
    ).rows[0].id;
    const cart = (
      await query(
        "insert into public.carts(tenant_id,customer_id,service_type,payment_method_id,conversation_id) values($1,$2,'pickup',$3,$4) returning id",
        [ta, customer, method, conversation],
      )
    ).rows[0].id;
    await query(
      "insert into public.cart_items(tenant_id,cart_id,product_ids,quantity) values($1,$2,$3,2)",
      [ta, cart, [product]],
    );
    const connection = db as unknown as DB;
    const original = await priceCart(connection, ta, cart);
    expect(original.total_cents).toBe(9000);
    await query(
      "update public.menu_items set base_price_cents=5000 where tenant_id=$1 and id=$2",
      [ta, product],
    );
    await expect(
      finalizeCart(connection, ta, cart, original.hash),
    ).rejects.toThrow("valores mudaram");
    const latest = await priceCart(connection, ta, cart);
    const order = await finalizeCart(connection, ta, cart, latest.hash);
    expect(order.total_cents).toBe(10000);
    expect((await finalizeCart(connection, ta, cart, latest.hash)).id).toBe(
      order.id,
    );
    await query(
      "update public.menu_items set name='Novo nome',base_price_cents=6000 where tenant_id=$1 and id=$2",
      [ta, product],
    );
    const snap = await db.query<{
      name_snapshot: string;
      unit_price_cents: number;
    }>(
      "select name_snapshot,unit_price_cents from public.order_items where order_id=$1",
      [order.id],
    );
    expect(snap.rows[0]).toMatchObject({
      name_snapshot: "Marguerita",
      unit_price_cents: 5000,
    });
    await expect(priceCart(connection, tb, cart)).rejects.toThrow(
      "Carrinho não encontrado",
    );
  });
  it("rejects overlapping overnight business hours at the database boundary", async () => {
    await db.query(
      "delete from public.store_business_hours where tenant_id=$1",
      [ta],
    );
    await db.query(
      "insert into public.store_business_hours(tenant_id,day_of_week,start_time,end_time) values($1,5,'22:00','02:00')",
      [ta],
    );
    await expect(
      db.query(
        "insert into public.store_business_hours(tenant_id,day_of_week,start_time,end_time) values($1,6,'01:00','03:00')",
        [ta],
      ),
    ).rejects.toThrow();
  });
  it("does not let browser writes bypass server validation", async () => {
    await expect(
      asUser(
        a,
        "update public.store_settings set display_name='Bypass' where tenant_id=$1",
        [ta],
      ),
    ).rejects.toThrow();
  });
});

it("lifetime access has no expiry but still respects administrative suspension", async () => {
  await db.query(
    "update public.subscriptions set lifetime_access=true,status='active',current_period_end=null where tenant_id=$1",
    [ta],
  );
  expect(
    (
      await db.query<{ allowed: boolean }>(
        "select private.subscription_active($1) allowed",
        [ta],
      )
    ).rows[0].allowed,
  ).toBe(true);
  await db.query(
    "update public.tenants set manually_suspended=true where id=$1",
    [ta],
  );
  expect(
    (
      await db.query<{ allowed: boolean }>(
        "select private.subscription_active($1) allowed",
        [ta],
      )
    ).rows[0].allowed,
  ).toBe(false);
  await db.query(
    "update public.tenants set manually_suspended=false where id=$1",
    [ta],
  );
  await expect(
    asUser(
      a,
      "update public.subscriptions set lifetime_access=true where tenant_id=$1",
      [tb],
    ),
  ).rejects.toThrow();
});

it("preserves microseconds for edits and rejects stale category versions", async () => {
  const created = await db.query<{ id: string }>(
    "insert into public.menu_categories(tenant_id,name,updated_at) values($1,'Regra QA','2026-10-04T10:00:00.123456Z') returning id",
    [ta],
  );
  const id = created.rows[0].id;
  const version = await db.query<{ updated_at: string }>(
    `select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at from public.menu_categories where id=$1`,
    [id],
  );
  expect(version.rows[0].updated_at).toContain(".123456Z");
  const sql =
    "update public.menu_categories set allow_split=true,split_pricing='proportional' where tenant_id=$1 and id=$2 and updated_at=$3::timestamptz returning id";
  expect(
    (await db.query(sql, [ta, id, version.rows[0].updated_at])).rows,
  ).toHaveLength(1);
  expect(
    (await db.query(sql, [ta, id, version.rows[0].updated_at])).rows,
  ).toHaveLength(0);
});
