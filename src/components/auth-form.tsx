"use client";
import { useActionState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  ShieldCheck,
  ClipboardList,
  MessageCircle,
  Bike,
} from "lucide-react";
import {
  login,
  resendVerification,
  signup,
  recover,
  updatePassword,
  type AuthState,
} from "@/app/auth/actions";
export function AuthForm({
  mode,
  token,
  notice,
}: {
  mode: "login" | "signup" | "recover" | "resend" | "password";
  token?: string;
  notice?: { type: "success" | "error"; message: string };
}) {
  const action = {
    login,
    signup,
    recover,
    resend: resendVerification,
    password: updatePassword,
  }[mode];
  const [state, submit, pending] = useActionState<AuthState, FormData>(
    action,
    {},
  );
  const title = {
    login: "Entre na sua conta",
    signup: "Sua pizzaria começa aqui.",
    recover: "Vamos recuperar seu acesso.",
    resend: "Confirme seu e-mail.",
    password: "Escolha sua nova senha.",
  }[mode];
  return (
    <div className="auth-wrap auth-branded">
      <aside className="auth-story auth-brand-panel">
        <Link href="/" className="auth-brand" aria-label="Pedizza — início">
          <Image
            src="/logo.png"
            alt="Pedizza"
            width={180}
            height={180}
            preload
          />
        </Link>
        <div className="auth-brand-copy">
          <span className="eyebrow">DA PRIMEIRA MENSAGEM À ÚLTIMA ENTREGA</span>
          <h1>
            Sua pizzaria.
            <br />
            Seu ritmo.
            <br />
            <span>Tudo no controle.</span>
          </h1>
          <p>
            Mais tempo para fazer uma boa pizza.
            <br />
            Menos trabalho para cuidar dos pedidos.
          </p>
        </div>
        <div
          className="auth-operation"
          aria-label="Atendimento, pedidos e entrega"
        >
          <span>
            <MessageCircle size={21} />
            <strong>Atenda</strong>
          </span>
          <ArrowRight size={16} aria-hidden="true" />
          <span>
            <ClipboardList size={21} />
            <strong>Prepare</strong>
          </span>
          <ArrowRight size={16} aria-hidden="true" />
          <span>
            <Bike size={21} />
            <strong>Entregue</strong>
          </span>
        </div>
        <p className="auth-brand-footer">Feito para quem vive de pizza.</p>
      </aside>
      <section className="auth-content">
        <div className="auth-form">
          <div className="auth-access-label">
            <ShieldCheck size={16} /> SEU ESPAÇO DE GESTÃO
          </div>
          <h1>{title}</h1>
          <p className="muted">
            {mode === "signup"
              ? "Crie sua conta e conheça o plano Pedizza por R$ 89,90/mês."
              : mode === "recover"
                ? "Enviaremos um link seguro para você criar uma nova senha."
                : mode === "resend"
                  ? "Enviaremos um novo link se sua conta ainda estiver aguardando confirmação."
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
            {mode !== "recover" && mode !== "resend" && (
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
            {(mode === "signup" || mode === "password") && (
              <label>
                Confirmar senha
                <input
                  name="password_confirmation"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                  placeholder="Digite a senha novamente"
                />
              </label>
            )}
            {mode === "login" && (
              <div
                className="row"
                style={{ justifyContent: "space-between", fontSize: 12 }}
              >
                <Link href="/reenviar-confirmacao" className="muted">
                  Reenviar confirmação
                </Link>
                <Link href="/recuperar-senha" className="muted">
                  Esqueci minha senha
                </Link>
              </div>
            )}
            {notice && !state.error && !state.success && (
              <p
                className={
                  notice.type === "success" ? "feedback success" : "feedback"
                }
                role={notice.type === "success" ? "status" : "alert"}
              >
                {notice.message}
              </p>
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
                    : mode === "resend"
                      ? "Reenviar confirmação"
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
