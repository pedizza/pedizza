import "server-only";
import type { DB } from "@/lib/db";
export async function audit(
  db: DB,
  tenantId: string | null,
  userId: string | null,
  action: string,
  resource: string,
  resourceId: string | null,
  metadata: Record<string, string | number | boolean | null> = {},
) {
  const safe = Object.fromEntries(
    Object.entries(metadata).filter(
      ([k]) => !/(password|secret|token|key|body|phone|email)/i.test(k),
    ),
  );
  await db.query(
    "insert into public.audit_logs(tenant_id,user_id,action,resource_type,resource_id,metadata) values($1,$2,$3,$4,$5,$6)",
    [tenantId, userId, action, resource, resourceId, JSON.stringify(safe)],
  );
}
