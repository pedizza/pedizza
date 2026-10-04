import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { transaction, one, rows, type DB } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";
export type TenantContext = {
  userId: string;
  email: string;
  name: string;
  tenantId: string;
  tenantName: string;
  memberId: string;
  role: string;
  permissions: Permission[];
  subscriptionActive: boolean;
  memberships: { id: string; name: string }[];
};
export const getCurrentUser = cache(async () => {
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return null;
  const client = await supabaseServer();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
});
export const getCurrentTenant = cache(
  async (): Promise<TenantContext | null> => {
    const user = await getCurrentUser();
    if (!user) return null;
    const selected = (await cookies()).get("pedizza-tenant")?.value;
    return transaction(async (db) => {
      const memberships = await rows<{
        id: string;
        name: string;
        member_id: string;
        role: string;
        profile_name: string;
      }>(
        db,
        `select t.id,t.name,m.id member_id,m.role,p.name profile_name from public.tenant_members m join public.tenants t on t.id=m.tenant_id join public.profiles p on p.id=m.user_id where m.user_id=$1 and m.active and not p.blocked order by m.created_at limit 100`,
        [user.id],
      );
      const m = memberships.find((x) => x.id === selected) || memberships[0];
      if (!m) return null;
      const permissions = await rows<{ code: Permission }>(
        db,
        `select code from public.permissions where public.has_permission($1,code)`,
        [m.id],
      );
      const access = await one<{ allowed: boolean }>(
        db,
        "select private.subscription_active($1) allowed",
        [m.id],
      );
      return {
        userId: user.id,
        email: user.email || "",
        name: m.profile_name,
        tenantId: m.id,
        tenantName: m.name,
        memberId: m.member_id,
        role: m.role,
        permissions: permissions.map((x) => x.code),
        subscriptionActive: !!access?.allowed,
        memberships: memberships.map((x) => ({ id: x.id, name: x.name })),
      };
    }, user.id);
  },
);
export async function requireTenant(
  permission?: Permission,
  allowInactive = false,
) {
  const user = await getCurrentUser();
  if (!user) throw new AppError(401, "Entre na sua conta para continuar.");
  const ctx = await getCurrentTenant();
  if (!ctx) throw new AppError(403, "Nenhuma loja disponível para sua conta.");
  if (!allowInactive && !ctx.subscriptionActive)
    throw new AppError(402, "Sua assinatura precisa de atenção.");
  if (permission && !ctx.permissions.includes(permission))
    throw new AppError(403, "Você não tem permissão para esta ação.");
  return ctx;
}
export async function requirePage(
  permission?: Permission,
  allowInactive = false,
) {
  try {
    return await requireTenant(permission, allowInactive);
  } catch (e) {
    if (e instanceof AppError) {
      if (e.status === 401) redirect("/login");
      if (e.status === 402) redirect("/app/assinatura");
      redirect("/sem-acesso");
    }
    throw e;
  }
}
// Re-check authorization inside each privileged write transaction, to prevent revocation races.
export async function authorize(
  db: DB,
  ctx: TenantContext,
  permission: Permission,
  allowInactive = false,
) {
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
    ctx.userId,
  ]);
  const check = await one<{ allowed: boolean; active: boolean }>(
    db,
    "select private.has_permission($1,$2) allowed,private.subscription_active($1) active",
    [ctx.tenantId, permission],
  );
  if (!check?.allowed) throw new AppError(403, "Acesso revogado.");
  if (!allowInactive && !check.active)
    throw new AppError(402, "Sua assinatura precisa de atenção.");
}
export async function requireMaster(requireMfa = true) {
  const user = await getCurrentUser();
  if (!user) throw new AppError(401, "Entre na sua conta.");
  const result = await transaction(
    (db) =>
      one<{ allowed: boolean }>(db, "select public.is_super_admin() allowed"),
    user.id,
  );
  if (!result?.allowed) throw new AppError(403, "Acesso restrito.");
  if (requireMfa) {
    const client = await supabaseServer();
    const { data, error } =
      await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || data?.currentLevel !== "aal2")
      throw new AppError(
        403,
        "Confirme a autenticação de dois fatores.",
        "MFA_REQUIRED",
      );
  }
  return user;
}
