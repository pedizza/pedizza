import "server-only";
import type { DB } from "@/lib/db";
import type { Permission } from "@/lib/permissions";
export async function enqueue(
  db: DB,
  tenant: string,
  kind: string,
  key: string,
  payload: unknown,
) {
  await db.query(
    "insert into private.outbox(tenant_id,kind,event_key,payload) values($1,$2,$3,$4) on conflict(event_key) do nothing",
    [tenant, kind, key, JSON.stringify(payload)],
  );
}
export async function notify(
  db: DB,
  tenant: string,
  eventKey: string,
  type: string,
  title: string,
  body: string,
  url: string,
  permission: Permission,
  entityId?: string,
) {
  await db.query(
    `insert into public.notifications(tenant_id,user_id,type,title,body,action_url,required_permission,event_key,entity_id) select m.tenant_id,m.user_id,$3,$4,$5,$6,$7,$2,$8 from public.tenant_members m join public.profiles p on p.id=m.user_id where m.tenant_id=$1 and m.active and not p.blocked and (m.role='owner' or coalesce((select allowed from public.member_permissions where member_id=m.id and permission=$7),exists(select 1 from public.role_permissions where role=m.role and permission=$7))) on conflict(tenant_id,user_id,event_key) do nothing`,
    [tenant, eventKey, type, title, body, url, permission, entityId || null],
  );
  if (
    process.env.VAPID_PRIVATE_KEY &&
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
    process.env.VAPID_SUBJECT
  )
    await enqueue(db, tenant, "push", "push:" + eventKey, { eventKey });
}
