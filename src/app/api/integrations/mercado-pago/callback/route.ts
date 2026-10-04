import { NextResponse } from "next/server";
export async function GET(request: Request) {
  return NextResponse.redirect(
    new URL("/app/configuracoes/pagamentos", request.url),
  );
}
