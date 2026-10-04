import pg from "pg";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const ca = await readFile(
  process.env.SUPABASE_DB_CA_PATH || "config/supabase-ca.crt",
  "utf8",
);
const client = new pg.Client({
  connectionString: process.env.DIRECT_URL,
  ssl: { rejectUnauthorized: true, ca },
  connectionTimeoutMillis: 10000,
});
try {
  await client.connect();
  await client.query("select pg_advisory_lock(77392010)");
  await client.query("create schema if not exists pedizza_migrations");
  await client.query(
    "create table if not exists pedizza_migrations.history(name text primary key,sha256 text not null,applied_at timestamptz not null default now())",
  );
  const existing = (
    await client.query(
      "select tablename from pg_tables where schemaname='public'",
    )
  ).rows;
  const applied = (
    await client.query("select name,sha256 from pedizza_migrations.history")
  ).rows;
  if (!applied.length && existing.length)
    throw new Error(
      "Existing public schema found. Review compatibility before first migration.",
    );
  await mkdir(".local/backups", { recursive: true });
  await writeFile(
    `.local/backups/schema-inventory-${Date.now()}.json`,
    JSON.stringify(existing, null, 2),
  );
  for (const name of (await readdir("supabase/migrations"))
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    const sql = await readFile(`supabase/migrations/${name}`, "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");
    const old = applied.find((x) => x.name === name);
    if (old) {
      if (old.sha256 !== hash)
        throw new Error("Applied migration changed: " + name);
      continue;
    }
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query(
        "insert into pedizza_migrations.history(name,sha256) values($1,$2)",
        [name, hash],
      );
      await client.query("commit");
      console.info("Applied " + name);
    } catch (e) {
      await client.query("rollback");
      throw e;
    }
  }
} catch (e) {
  console.error(e.code || "migration_failed", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
