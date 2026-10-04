import "server-only";
import { boundedBody } from "@/lib/security/body";
import { AppError } from "@/lib/errors";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
export function isPrivateAddress(ip: string) {
  return /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.|::1$|::ffff:|f[cd]|fe[89ab])/i.test(
    ip,
  );
}
export async function externalJson(
  url: URL,
  init: RequestInit = {},
  timeout = 10000,
  maxBytes = 4 * 1024 * 1024,
): Promise<unknown> {
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    isIP(url.hostname)
  )
    throw new AppError(503, "Integração indisponível.");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address)))
    throw new AppError(503, "Endereço da integração inválido.");
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    throw new AppError(503, "A integração não respondeu. Tente novamente.");
  }
  if (!response.ok)
    throw new AppError(
      503,
      "Não foi possível concluir a operação na integração.",
    );
  const text = (await boundedBody(response.body, maxBytes)).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError(502, "Resposta inválida da integração.");
  }
}
