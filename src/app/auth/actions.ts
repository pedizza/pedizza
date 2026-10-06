"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { randomBytes, createHash } from "node:crypto";
import { transaction, one, type DB } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, endSession } from "@/lib/auth/session";
import { authEmail, mailConfigured, sendMail } from "@/lib/auth/mail";
import { rateLimit } from "@/lib/security/http";
import { AppError } from "@/lib/errors";
import { appUrl } from "@/lib/env";
const credentials = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(8, "Use pelo menos 8 caracteres.").max(128),
});
export type AuthState = { error?: string; success?: string };

async function issueAuthToken(
  db: DB,
  userId: string,
  purpose: "verify" | "reset",
  lifetime: "24 hours" | "30 minutes",
) {
  const token = randomBytes(32).toString("hex");
  await db.query(
    "update private.auth_tokens set used_at=coalesce(used_at,now()) where user_id=$1 and purpose=$2 and used_at is null",
    [userId, purpose],
  );
  await db.query(
    `insert into private.auth_tokens(token_hash,user_id,purpose,expires_at)
     values($1,$2,$3,now()+$4::interval)`,
    [
      createHash("sha256").update(token).digest("hex"),
      userId,
      purpose,
      lifetime,
    ],
  );
  return token;
}

async function sendVerification(email: string, token: string) {
  const content = authEmail({
    title: "Confirme sua conta",
    message:
      "Seu cadastro no Pedizza está quase pronto. Confirme seu e-mail para acessar sua pizzaria.",
    action: "Confirmar meu e-mail",
    url: appUrl() + "/auth/confirm?token=" + token,
    expiration: "em 24 horas",
  });
  await sendMail(email, "Confirme sua conta Pedizza", content);
}

async function sendPasswordReset(email: string, token: string) {
  const content = authEmail({
    title: "Redefina sua senha",
    message:
      "Recebemos uma solicitação para criar uma nova senha para sua conta Pedizza.",
    action: "Criar nova senha",
    url: appUrl() + "/nova-senha?token=" + token,
    expiration: "em 30 minutos",
  });
  await sendMail(email, "Recuperação de acesso Pedizza", content);
}
async function throttle(email: string, kind: string) {
  const h = await headers();
  const ip = process.env.VERCEL
    ? h.get("x-vercel-forwarded-for") || "unknown"
    : "local";
  await rateLimit("auth:" + kind + ":ip:" + ip, 50, 900);
  await rateLimit("auth:" + kind + ":email:" + email, 10, 900);
}
function failure(e: unknown) {
  return {
    error:
      e instanceof AppError
        ? e.message
        : "Não foi possível concluir. Tente novamente.",
  };
}
export async function login(_: AuthState, form: FormData): Promise<AuthState> {
  const data = credentials.safeParse(Object.fromEntries(form));
  if (!data.success) return { error: data.error.issues[0].message };
  let destination = "/app";
  try {
    await throttle(data.data.email, "login");
    const account = await transaction((db) =>
      one<{
        id: string;
        password_hash: string | null;
        email_verified_at: Date | null;
        blocked: boolean;
      }>(
        db,
        "select a.id,a.password_hash,a.email_verified_at,p.blocked from private.accounts a join public.profiles p on p.id=a.id where a.email=$1",
        [data.data.email],
      ),
    );
    const valid = await verifyPassword(
      data.data.password,
      account?.password_hash || null,
    );
    if (!account || !valid || account.blocked)
      return { error: "Não foi possível entrar. Confira seu e-mail e senha." };
    if (!account.email_verified_at)
      return { error: "Confirme seu e-mail antes de entrar." };
    await createSession(account.id);
    const master = await transaction((db) =>
      one(db, "select user_id from private.super_admins where user_id=$1", [
        account.id,
      ]),
    );
    const invite = (await cookies()).get("pedizza-invite")?.value;
    destination = master
      ? "/master"
      : invite && /^[a-f0-9]{64}$/.test(invite)
        ? "/convite?token=" + invite
        : "/app";
  } catch (e) {
    return failure(e);
  }
  redirect(destination);
}
export async function signup(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = credentials
    .extend({
      name: z.string().trim().min(2).max(120),
      store_name: z.string().trim().min(2).max(120),
      password_confirmation: z.string().min(8).max(128),
    })
    .refine((data) => data.password === data.password_confirmation, {
      message: "As senhas não coincidem.",
      path: ["password_confirmation"],
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (!mailConfigured())
    return {
      error:
        "O envio de confirmação está sendo configurado. Solicite seu acesso ao administrador.",
    };
  try {
    const d = parsed.data;
    await throttle(d.email, "signup");
    const hash = await hashPassword(d.password);
    const result = await transaction(async (db) => {
      const existing = await one<{
        id: string;
        email_verified_at: Date | null;
      }>(
        db,
        "select id,email_verified_at from private.accounts where email=$1 for update",
        [d.email],
      );
      if (existing?.email_verified_at) return null;
      let id = existing?.id;
      if (!id) {
        id = crypto.randomUUID();
        const tenant = crypto.randomUUID();
        await db.query(
          "insert into private.accounts(id,email,password_hash) values($1,$2,$3)",
          [id, d.email, hash],
        );
        await db.query("insert into public.profiles(id,name) values($1,$2)", [
          id,
          d.name,
        ]);
        await db.query(
          "insert into public.tenants(id,name,slug) values($1,$2,$3)",
          [tenant, d.store_name, "loja-" + tenant],
        );
        await db.query(
          "insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'owner')",
          [tenant, id],
        );
        await db.query(
          "insert into public.subscriptions(tenant_id,plan_id) select $1,id from public.subscription_plans where code='pedizza_monthly'",
          [tenant],
        );
      }
      return { token: await issueAuthToken(db, id, "verify", "24 hours") };
    });
    if (result) await sendVerification(d.email, result.token);
    return {
      success:
        "Confira seu e-mail para confirmar o cadastro. Se já tem conta, use a recuperação de senha.",
    };
  } catch (e) {
    return failure(e);
  }
}

export async function resendVerification(
  _: AuthState,
  form: FormData,
): Promise<AuthState> {
  const email = z
    .email()
    .transform((value) => value.toLowerCase())
    .safeParse(form.get("email"));
  if (!email.success) return { error: "Informe um e-mail válido." };
  if (!mailConfigured())
    return {
      error:
        "O envio de confirmação ainda não está configurado. Contate o administrador.",
    };
  try {
    await throttle(email.data, "resend-verification");
    const token = await transaction(async (db) => {
      const account = await one<{
        id: string;
        email_verified_at: Date | null;
      }>(
        db,
        "select id,email_verified_at from private.accounts where email=$1",
        [email.data],
      );
      if (!account || account.email_verified_at) return null;
      return issueAuthToken(db, account.id, "verify", "24 hours");
    });
    if (token) await sendVerification(email.data, token);
    return {
      success:
        "Se o cadastro estiver aguardando confirmação, enviaremos um novo link.",
    };
  } catch (error) {
    return failure(error);
  }
}
export async function logout() {
  await endSession();
  (await cookies()).delete("pedizza-tenant");
  redirect("/login");
}
export async function recover(
  _: AuthState,
  form: FormData,
): Promise<AuthState> {
  const email = z
    .email()
    .transform((v) => v.toLowerCase())
    .safeParse(form.get("email"));
  if (!email.success) return { error: "Informe um e-mail válido." };
  if (!mailConfigured())
    return {
      error:
        "A recuperação por e-mail ainda não está configurada. Contate o administrador.",
    };
  try {
    await throttle(email.data, "recover");
    const result = await transaction(async (db) => {
      const u = await one<{ id: string }>(
        db,
        "select id from private.accounts where email=$1",
        [email.data],
      );
      if (!u) return null;
      return {
        token: await issueAuthToken(db, u.id, "reset", "30 minutes"),
      };
    });
    if (result) await sendPasswordReset(email.data, result.token);
    return {
      success: "Se o e-mail estiver cadastrado, você receberá as instruções.",
    };
  } catch (e) {
    return failure(e);
  }
}
export async function updatePassword(
  _: AuthState,
  form: FormData,
): Promise<AuthState> {
  const d = z
    .object({
      password: z.string().min(8).max(128),
      password_confirmation: z.string().min(8).max(128),
      token: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .refine((data) => data.password === data.password_confirmation, {
      message: "As senhas não coincidem.",
      path: ["password_confirmation"],
    })
    .safeParse(Object.fromEntries(form));
  if (!d.success)
    return {
      error: "Link inválido ou senha fora do limite de 8 a 128 caracteres.",
    };
  try {
    await rateLimit(
      "auth:reset:" + createHash("sha256").update(d.data.token).digest("hex"),
      10,
      900,
    );
    const hash = await hashPassword(d.data.password);
    const changed = await transaction(async (db) => {
      const token = await one<{ user_id: string }>(
        db,
        "update private.auth_tokens set used_at=now() where token_hash=$1 and purpose='reset' and used_at is null and expires_at>now() returning user_id",
        [createHash("sha256").update(d.data.token).digest("hex")],
      );
      if (!token) return false;
      await db.query(
        "update private.accounts set password_hash=$2,email_verified_at=coalesce(email_verified_at,now()) where id=$1",
        [token.user_id, hash],
      );
      await db.query(
        "update private.sessions set revoked_at=now() where user_id=$1",
        [token.user_id],
      );
      await db.query(
        "update private.auth_tokens set used_at=now() where user_id=$1",
        [token.user_id],
      );
      return true;
    });
    if (!changed)
      return { error: "Link inválido ou expirado. Solicite outro." };
  } catch (e) {
    return failure(e);
  }
  await endSession();
  redirect("/login?password=updated");
}
