"use client";
import { useActionState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  ShieldCheck,
  ClipboardList,
  MessageCircle,
  ChartNoAxesCombined,
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
    login: "Bom ter você de volta.",
    signup: "Sua pizzaria começa aqui.",
    recover: "Vamos recuperar seu acesso.",
    resend: "Confirme seu e-mail.",
    password: "Escolha sua nova senha.",
  }[mode];
  return (
    <div className="auth-wrap">
      <aside className="auth-story">
        <span className="eyebrow">GESTÃO FEITA PARA PIZZARIAS</span>
        <div>
          <Image
            src="/logo.png"
            alt="Pedizza"
            width={240}
            height={220}
            priority
          />
          <h1>
            Sua operação,
            <br />
            no ponto certo.
          </h1>
          <p className="muted">
            Sua equipe, seus clientes e seus pedidos.
            <br />
            Tudo junto para sua pizzaria ir mais longe.
          </p>
        </div>
        <div className="auth-capabilities">
          <span>
            <ClipboardList size={18} /> Pedidos organizados
          </span>
          <span>
            <MessageCircle size={18} /> Atendimento conectado
          </span>
          <span>
            <ChartNoAxesCombined size={18} /> Controle da operação
          </span>
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
