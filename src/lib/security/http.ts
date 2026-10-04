import "server-only";
import { boundedBody } from "./body";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError } from "@/lib/errors";
import { transaction, one } from "@/lib/db";
import { createHash } from "node:crypto";
export function verifyOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = new URL(request.url).origin;
  if (!origin || origin !== expected)
    throw new AppError(403, "Origem da solicitação inválida.");
}
export async function readJson(
  request: Request,
  maxBytes = 65536,
): Promise<unknown> {
  const text = (await boundedBody(request.body, maxBytes)).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError(400, "Dados inválidos.");
  }
}
export async function rateLimit(key: string, limit = 60, seconds = 60) {
  const hash = createHash("sha256").update(key).digest("hex");
  const result = await transaction((db) =>
    one<{ count: number }>(
      db,
      `insert into private.rate_limits(key,count,expires_at) values($1,1,now()+$2*interval '1 second') on conflict(key) do update set count=case when rate_limits.expires_at<now() then 1 else rate_limits.count+1 end,expires_at=case when rate_limits.expires_at<now() then excluded.expires_at else rate_limits.expires_at end returning count`,
      [hash, seconds],
    ),
  );
  if ((result?.count || 0) > limit)
    throw new AppError(429, "Muitas solicitações. Aguarde um momento.");
}
export function apiError(error: unknown) {
  const id = crypto.randomUUID();
  if (error instanceof AppError)
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  if (error instanceof ZodError)
    return NextResponse.json(
      { error: error.issues[0]?.message || "Confira os dados informados." },
      { status: 400 },
    );
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "internal";
  if (["23505", "23514", "23503", "23P01"].includes(code))
    return NextResponse.json(
      {
        error:
          "Os dados conflitam com um registro existente ou uma regra da loja.",
      },
      { status: 409 },
    );
  console.error(JSON.stringify({ event: "request_failed", id, code }));
  return NextResponse.json(
    { error: "Não foi possível concluir. Tente novamente.", reference: id },
    { status: 500 },
  );
}
export function json(data: unknown) {
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
