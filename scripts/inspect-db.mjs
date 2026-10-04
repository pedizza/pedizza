import pg from "pg";
import { readFileSync } from "node:fs";
const client = new pg.Client({
  connectionString: process.env.DIRECT_URL,
  ssl: {
    rejectUnauthorized: true,
    ca: readFileSync(
      process.env.SUPABASE_DB_CA_PATH || ".local/supabase-ca.crt",
      "utf8",
    ),
  },
  connectionTimeoutMillis: 10000,
});
try {
  await client.connect();
  const { rows } = await client.query(
    "select schemaname, tablename from pg_tables where schemaname in ('public','auth','storage') order by schemaname,tablename",
  );
  console.info(JSON.stringify(rows));
} catch (e) {
  console.error(
    e.code || e.name,
    e.message.replace(/postgresql:\/\/\S+/g, "[redacted]"),
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
