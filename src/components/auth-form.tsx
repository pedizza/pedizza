"use client";
import { useActionState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import {
  login,
  signup,
  recover,
  updatePassword,
  type AuthState,
} from "@/app/auth/actions";
export function AuthForm({
  mode,
  token,
}: {
  mode: "login" | "signup" | "recover" | "password";
  token?: string;
}) {
  const action = { login, signup, recover, password: updatePassword }[mode];
  const [state, submit, pending] = useActionState<AuthState, FormData>(
    action,
    {},
  );
  const title = {
    login: "Bom ter você de volta.",
    signup: "Sua pizzaria começa aqui.",
    recover: "Vamos recuperar seu acesso.",
    password: "Escolha sua nova senha.",
  }[mode];
  return (
    <div className="auth-wrap">
      <aside className="auth-story">
        <span className="eyebrow">O PRÓXIMO PEDIDO COMEÇA AQUI</span>
        <div>
          <Image
            src="/logo.png"
            alt="Pedizza"
            width={240}
            height={220}
            priority
          />
          <h1>
            Mais organização.
            <br />
            Mais sabor no seu dia.
          </h1>
          <p className="muted">
            Sua equipe, seus clientes e seus pedidos.
            <br />
            Tudo junto para sua pizzaria ir mais longe.
          </p>
        </div>
        <div className="row muted">
          <ShieldCheck size={17} /> Um espaço seguro para sua loja.
        </div>
      </aside>
      <section className="auth-content">
        <div className="auth-form">
          <Image
            src="/logo.png"
            alt="Pedizza"
            width={90}
            height={82}
            priority
          />
          <h1>{title}</h1>
          <p className="muted">
            {mode === "signup"
              ? "Crie sua conta e conheça o plano Pedizza por R$ 89,90/mês."
              : "Acesse sua conta para cuidar da sua operação."}
          </p>
          <form action={submit}>
            {token && <input type="hidden" name="token" value={token} />}
            {mode === "signup" && (
              <>
                <label>
                  Seu nome
                  <input
                    name="name"
                    autoComplete="name"
                    required
                    minLength={2}
                    maxLength={120}
                    placeholder="Como podemos chamar você?"
                  />
                </label>
                <label>
                  Nome da pizzaria
                  <input
                    name="store_name"
                    autoComplete="organization"
                    required
                    minLength={2}
                    maxLength={120}
                    placeholder="O nome da sua loja"
                  />
                </label>
              </>
            )}
            {mode !== "password" && (
              <label>
                E-mail
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="voce@pizzaria.com.br"
                  maxLength={254}
                />
              </label>
            )}
            {mode !== "recover" && (
              <label>
                Senha
                <input
                  name="password"
                  type="password"
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  minLength={8}
                  maxLength={128}
                  required
                  placeholder="Pelo menos 8 caracteres"
                />
              </label>
            )}
            {mode === "login" && (
              <Link
                href="/recuperar-senha"
                className="muted"
                style={{ fontSize: 12, textAlign: "right" }}
              >
                Esqueci minha senha
              </Link>
            )}
            {state.error && (
              <p className="feedback" role="alert">
                {state.error}
              </p>
            )}
            {state.success && (
              <p className="feedback success" role="status">
                {state.success}
              </p>
            )}
            <button className="btn" disabled={pending}>
              {pending
                ? "Aguarde…"
                : mode === "signup"
                  ? "Criar minha conta"
                  : mode === "recover"
                    ? "Enviar instruções"
                    : mode === "password"
                      ? "Salvar nova senha"
                      : "Entrar na minha loja"}
              <ArrowRight size={17} />
            </button>
          </form>
          <p
            className="muted"
            style={{ marginTop: 26, textAlign: "center", fontSize: 13 }}
          >
            {mode === "login" ? (
              <>
                Ainda não tem conta?{" "}
                <Link
                  href="/cadastro"
                  style={{ color: "var(--red)", fontWeight: 600 }}
                >
                  Cadastre sua pizzaria
                </Link>
              </>
            ) : (
              <Link href="/login">Voltar para o login</Link>
            )}
          </p>
        </div>
      </section>
    </div>
  );
}
