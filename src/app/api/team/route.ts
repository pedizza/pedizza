import { z } from "zod";
import { randomBytes, createHash } from "node:crypto";
import { requireTenant, authorize, getCurrentUser } from "@/lib/auth/context";
import { transaction, rows, one } from "@/lib/db";
import {
  apiError,
  json,
  verifyOrigin,
  readJson,
  rateLimit,
} from "@/lib/security/http";
import { invariant } from "@/lib/errors";
import { permissionCodes } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { appUrl } from "@/lib/env";
import { authEmail, mailConfigured, sendMail } from "@/lib/auth/mail";
export async function GET() {
  try {
    const ctx = await requireTenant("team.view");
    return json(
      await transaction(
        async (db) => ({
          members: await rows(
            db,
            "select m.id,m.role,m.active,p.name,m.user_id,m.created_at from public.tenant_members m join public.profiles p on p.id=m.user_id where m.tenant_id=$1 order by m.created_at limit 100",
            [ctx.tenantId],
          ),
          overrides: await rows(
            db,
            "select member_id,permission,allowed from public.member_permissions where tenant_id=$1",
            [ctx.tenantId],
          ),
          invites: await rows(
            db,
            "select id,email,role,status,expires_at from public.team_invites where tenant_id=$1 and status='pending' order by created_at desc limit 20",
            [ctx.tenantId],
          ),
        }),
        ctx.userId,
      ),
    );
  } catch (e) {
    return apiError(e);
  }
}
const roles = z.enum(["admin", "manager", "attendant", "kitchen", "custom"]);
export async function POST(request: Request) {
  try {
    verifyOrigin(request);
    const input = z
      .discriminatedUnion("action", [
        z.object({
          action: z.literal("invite"),
          email: z.email().max(254),
          role: roles,
        }),
        z.object({
          action: z.literal("update"),
          id: z.uuid(),
          role: roles,
          active: z.boolean(),
          permissions: z.record(z.enum(permissionCodes), z.boolean()),
        }),
        z.object({ action: z.literal("cancel"), id: z.uuid() }),
        z.object({ action: z.literal("accept"), token: z.string().length(64) }),
      ])
      .parse(await readJson(request));
    if (input.action === "accept") {
      const user = await getCurrentUser();
      invariant(
        user?.email && user.email_confirmed_at,
        "Confirme seu e-mail e entre na conta para aceitar.",
        401,
      );
      return json(
        await transaction(async (db) => {
          const invite = await one<{
            id: string;
            tenant_id: string;
            role: string;
            invited_by: string;
          }>(
            db,
            "select id,tenant_id,role,invited_by from public.team_invites where token_hash=$1 and lower(email)=lower($2) and status='pending' and expires_at>now() for update",
            [
              createHash("sha256").update(input.token).digest("hex"),
              user.email,
            ],
          );
          invariant(
            invite,
            "Convite inválido, expirado ou destinado a outro e-mail.",
            403,
          );
          await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
            invite.invited_by,
          ]);
          const authority = await one<{ allowed: boolean }>(
            db,
            "select private.has_permission($1,'team.invite') and not exists(select 1 from public.role_permissions r where r.role=$2 and not private.has_permission($1,r.permission)) allowed",
            [invite.tenant_id, invite.role],
          );
          invariant(
            authority?.allowed,
            "O acesso de quem enviou este convite mudou. Solicite um novo convite.",
            403,
          );
          await db.query(
            "insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,$3) on conflict(tenant_id,user_id) do nothing",
            [invite.tenant_id, user.id, invite.role],
          );
          await db.query(
            "update public.team_invites set status='accepted' where id=$1",
            [invite.id],
          );
          await audit(
            db,
            invite.tenant_id,
            user.id,
            "team.invite_accepted",
            "team_invites",
            invite.id,
          );
          return { ok: true };
        }),
      );
    }
    const ctx = await requireTenant(
      input.action === "invite" ? "team.invite" : "team.manage_permissions",
    );
    await rateLimit(ctx.userId + ":team", 10, 300);
    if (input.action === "invite") {
      const token = randomBytes(32).toString("hex");
      await transaction(async (db) => {
        await authorize(db, ctx, "team.invite");
        const grants = await rows<{
          permission: (typeof permissionCodes)[number];
        }>(db, "select permission from public.role_permissions where role=$1", [
          input.role,
        ]);
        invariant(
          grants.every((g) => ctx.permissions.includes(g.permission)),
          "Você não pode conceder acessos que não possui.",
          403,
        );
        const exists = await one(
          db,
          "select id from public.team_invites where tenant_id=$1 and lower(email)=lower($2) and status='pending' and expires_at>now()",
          [ctx.tenantId, input.email],
        );
        invariant(
          !exists,
          "Já existe um convite pendente para este e-mail.",
          409,
        );
        await db.query(
          "insert into public.team_invites(tenant_id,email,role,token_hash,invited_by) values($1,$2,$3,$4,$5)",
          [
            ctx.tenantId,
            input.email.toLowerCase(),
            input.role,
            createHash("sha256").update(token).digest("hex"),
            ctx.userId,
          ],
        );
        await audit(
          db,
          ctx.tenantId,
          ctx.userId,
          "team.invited",
          "tenant_members",
          null,
        );
      });
      const link = appUrl() + "/convite?token=" + token;
      let emailSent = false;
      if (mailConfigured()) {
        try {
          await sendMail(
            input.email,
            "Convite para o Pedizza",
            authEmail({
              title: "Você recebeu um convite",
              message:
                "Uma pizzaria convidou você para fazer parte da equipe no Pedizza.",
              action: "Acessar convite",
              url: link,
              expiration: "em 7 dias",
            }),
          );
          emailSent = true;
        } catch {
          emailSent = false;
        }
      }
      return json({ ok: true, link, emailSent });
    }
    return json(
      await transaction(async (db) => {
        await authorize(db, ctx, "team.manage_permissions");
        if (input.action === "cancel") {
          await db.query(
            "update public.team_invites set status='cancelled' where tenant_id=$1 and id=$2 and status='pending'",
            [ctx.tenantId, input.id],
          );
          await audit(
            db,
            ctx.tenantId,
            ctx.userId,
            "team.invite_cancelled",
            "team_invites",
            input.id,
          );
          return { ok: true };
        }
        const member = await one<{ role: string; user_id: string }>(
          db,
          "select role,user_id from public.tenant_members where tenant_id=$1 and id=$2 for update",
          [ctx.tenantId, input.id],
        );
        invariant(member, "Funcionário não encontrado.", 404);
        invariant(
          member.role !== "owner",
          "O proprietário não pode ser alterado.",
        );
        invariant(
          member.user_id !== ctx.userId,
          "Você não pode alterar seu próprio acesso.",
        );
        if (!input.active) await authorize(db, ctx, "team.deactivate");
        const defaults = await rows<{
          permission: (typeof permissionCodes)[number];
        }>(db, "select permission from public.role_permissions where role=$1", [
          input.role,
        ]);
        const effective = permissionCodes.filter(
          (p) =>
            input.permissions[p] ?? defaults.some((d) => d.permission === p),
        );
        invariant(
          effective.every((p) => ctx.permissions.includes(p)),
          "Você não pode conceder acessos que não possui.",
          403,
        );
        for (const p of effective) {
          const area = p.split(".")[0];
          if (
            !p.endsWith(".view") &&
            permissionCodes.includes(
              (area + ".view") as (typeof permissionCodes)[number],
            )
          )
            invariant(
              effective.includes(
                (area + ".view") as (typeof permissionCodes)[number],
              ),
              "Ative o acesso à aba antes de conceder suas ações.",
            );
        }
        await db.query(
          "update public.tenant_members set role=$3,active=$4 where tenant_id=$1 and id=$2",
          [ctx.tenantId, input.id, input.role, input.active],
        );
        await db.query(
          "delete from public.member_permissions where tenant_id=$1 and member_id=$2",
          [ctx.tenantId, input.id],
        );
        for (const [permission, allowed] of Object.entries(input.permissions))
          await db.query(
            "insert into public.member_permissions(tenant_id,member_id,permission,allowed) values($1,$2,$3,$4)",
            [ctx.tenantId, input.id, permission, allowed],
          );
        if (!input.active) {
          await db.query(
            "delete from private.push_subscriptions where tenant_id=$1 and user_id=$2",
            [ctx.tenantId, member.user_id],
          );
          await db.query(
            "update public.conversations set assigned_user_id=null,status=case when bot_paused then 'waiting_human' else status end where tenant_id=$1 and assigned_user_id=$2",
            [ctx.tenantId, member.user_id],
          );
        }
        await audit(
          db,
          ctx.tenantId,
          ctx.userId,
          "team.permissions_updated",
          "tenant_members",
          input.id,
          { active: input.active, role: input.role },
        );
        return { ok: true };
      }),
    );
  } catch (e) {
    return apiError(e);
  }
}
