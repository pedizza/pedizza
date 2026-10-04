import "server-only";
import pg, { type PoolClient, type QueryResultRow } from "pg";
import { readFileSync } from "node:fs";
import path from "node:path";
import { requiredEnv } from "@/lib/env";
let pool: pg.Pool | undefined;
function getPool() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: requiredEnv("DATABASE_URL"),
      max: 3,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
      ssl: {
        rejectUnauthorized: true,
        ca:
          process.env.SUPABASE_DB_CA?.replace(/\\n/g, "\n") ||
          readFileSync(
            path.join(process.cwd(), "config/supabase-ca.crt"),
            "utf8",
          ),
      },
    });
  }
  return pool;
}
export type DB = PoolClient;
export async function transaction<T>(
  fn: (db: DB) => Promise<T>,
  userId?: string,
): Promise<T> {
  const db = await getPool().connect();
  try {
    await db.query("begin; set local statement_timeout='15s'");
    if (userId) {
      await db.query(
        "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
        [userId, JSON.stringify({ sub: userId, role: "authenticated" })],
      );
      await db.query("set local role authenticated");
    }
    const result = await fn(db);
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    db.release();
  }
}
export async function rows<T extends QueryResultRow>(
  db: DB,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}
export async function one<T extends QueryResultRow>(
  db: DB,
  sql: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  return (await rows<T>(db, sql, params))[0];
}
