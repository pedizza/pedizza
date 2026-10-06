import { AuthForm } from "@/components/auth-form";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    confirmed?: string;
    password?: string;
    error?: string;
  }>;
}) {
  const query = await searchParams;
  const notice = query.confirmed
    ? ({
        type: "success",
        message: "E-mail confirmado. Você já pode entrar na sua conta.",
      } as const)
    : query.password === "updated"
      ? ({
          type: "success",
          message: "Senha atualizada. Entre com sua nova senha.",
        } as const)
      : query.error === "confirmacao"
        ? ({
            type: "error",
            message:
              "O link de confirmação é inválido ou expirou. Solicite um novo link.",
          } as const)
        : undefined;
  return <AuthForm mode="login" notice={notice} />;
}
