import pg from "pg";
import { readFileSync } from "node:fs";
import { hashPassword } from "../src/lib/auth/password.ts";
const [email, name, kind] = process.argv.slice(2);
if (!email || !name || !["master", "lifetime"].includes(kind))
  throw Error("Usage: email name master|lifetime; password via stdin");
const password = readFileSync(0, "utf8").trim();
if (password.length < 8 || password.length > 128)
  throw Error("Invalid password length");
const passwordHash = await hashPassword(password);
const db = new pg.Client({
  connectionString: process.env.DIRECT_URL,
  ssl: {
    rejectUnauthorized: true,
    ca: readFileSync("config/supabase-ca.crt", "utf8"),
  },
});
try {
  await db.connect();
  await db.query("begin");
  const { rows } = await db.query(
    "insert into private.accounts(email,password_hash,email_verified_at) values($1,$2,now()) on conflict(email) do update set password_hash=$2,email_verified_at=now() returning id",
    [email.toLowerCase(), passwordHash],
  );
  const id = rows[0].id;
  await db.query(
    "insert into public.profiles(id,name) values($1,$2) on conflict(id) do update set name=$2,blocked=false",
    [id, name],
  );
  let tenant = null;
  if (kind === "master")
    await db.query(
      "insert into private.super_admins(user_id) values($1) on conflict do nothing",
      [id],
    );
  else {
    const owned = await db.query(
      "select tenant_id from public.tenant_members where user_id=$1 and role='owner'",
      [id],
    );
    if (owned.rows.length > 1) throw Error("Ambiguous tenant");
    tenant = owned.rows[0]?.tenant_id;
    if (!tenant) {
      tenant = crypto.randomUUID();
      await db.query(
        "insert into public.tenants(id,name,slug) values($1,$2,$3)",
        [tenant, name, "loja-" + tenant],
      );
      await db.query(
        "insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'owner')",
        [tenant, id],
      );
    }
    await db.query(
      "insert into public.subscriptions(tenant_id,plan_id,status,lifetime_access) select $1,id,'active',true from public.subscription_plans where code='pedizza_monthly' on conflict(tenant_id) do update set status='active',lifetime_access=true,current_period_end=null",
      [tenant],
    );
  }
  await db.query(
    "update private.sessions set revoked_at=now() where user_id=$1",
    [id],
  );
  await db.query(
    "insert into public.audit_logs(tenant_id,user_id,action,resource_type,resource_id) values($1,$2,$3,'profiles',$2)",
    [tenant, id, "operator.provision_" + kind],
  );
  await db.query("commit");
  console.log(JSON.stringify({ email, kind, provisioned: true }));
} catch (e) {
  await db.query("rollback").catch(() => {});
  console.error("Provisioning failed:", e.code || e.name);
  process.exitCode = 1;
} finally {
  await db.end();
}
