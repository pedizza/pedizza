"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import { appUrl } from "@/lib/env";
const credentials = z.object({
  email: z.email().max(254),
  password: z.string().min(8, "Use pelo menos 8 caracteres.").max(128),
});
export type AuthState = { error?: string; success?: string };
export async function login(
  _state: AuthState,
  form: FormData,
): Promise<AuthState> {
  const parsed = credentials.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    return {
      error: "O acesso está sendo configurado. Tente novamente em breve.",
    };
  const client = await supabaseServer();
  const { error } = await client.auth.signInWithPassword(parsed.data);
  if (error)
    return { error: "Não foi possível entrar. Confira seu e-mail e senha." };
  const invite = (await cookies()).get("pedizza-invite")?.value;
  if (invite && /^[a-f0-9]{64}$/.test(invite))
    redirect("/convite?token=" + invite);
  redirect("/app");
}
export async function signup(
  _state: AuthState,
  form: FormData,
): Promise<AuthState> {
  const parsed = credentials
    .extend({
      name: z.string().trim().min(2).max(120),
      store_name: z.string().trim().min(2).max(120),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    return {
      error: "O cadastro está sendo configurado. Tente novamente em breve.",
    };
  const client = await supabaseServer();
  const { email, password, name, store_name } = parsed.data;
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      data: { name, store_name },
      emailRedirectTo: appUrl() + "/auth/callback",
    },
  });
  if (error)
    return {
      error:
        "Não foi possível cadastrar. Confira os dados ou tente entrar na sua conta.",
    };
  if (data.session) redirect("/app");
  return {
    success: "Confira seu e-mail para confirmar o cadastro e acessar sua loja.",
  };
}
export async function logout() {
  const client = await supabaseServer();
  await client.auth.signOut();
  (await cookies()).delete("pedizza-tenant");
  redirect("/login");
}
export async function recover(
  _state: AuthState,
  form: FormData,
): Promise<AuthState> {
  const email = z.email().safeParse(form.get("email"));
  if (!email.success) return { error: "Informe um e-mail válido." };
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    return {
      error: "O acesso está sendo configurado. Tente novamente em breve.",
    };
  const client = await supabaseServer();
  await client.auth.resetPasswordForEmail(email.data, {
    redirectTo: appUrl() + "/auth/callback?next=/nova-senha",
  });
  return {
    success:
      "Se o e-mail estiver cadastrado, você receberá as instruções de recuperação.",
  };
}
export async function updatePassword(
  _state: AuthState,
  form: FormData,
): Promise<AuthState> {
  const password = z.string().min(8).max(128).safeParse(form.get("password"));
  if (!password.success)
    return { error: "Use uma senha de 8 a 128 caracteres." };
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    return {
      error: "O acesso está sendo configurado. Tente novamente em breve.",
    };
  const client = await supabaseServer();
  const { error } = await client.auth.updateUser({ password: password.data });
  if (error)
    return {
      error: "Não foi possível atualizar sua senha. Solicite um novo link.",
    };
  const invite = (await cookies()).get("pedizza-invite")?.value;
  if (invite && /^[a-f0-9]{64}$/.test(invite))
    redirect("/convite?token=" + invite);
  redirect("/app");
}
