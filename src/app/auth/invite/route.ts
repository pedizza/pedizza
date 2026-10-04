import { NextResponse } from "next/server";
import { z } from "zod";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .safeParse(url.searchParams.get("token"));
  const r = NextResponse.redirect(new URL("/login", url.origin));
  if (token.success)
    r.cookies.set("pedizza-invite", token.data, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 86400,
    });
  return r;
}
