import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next =
    url.searchParams.get("next") === "/nova-senha" ? "/nova-senha" : "/app";
  if (code) {
    const client = await supabaseServer();
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error) {
      const invite = url.searchParams.get("invite");
      const r = NextResponse.redirect(
        new URL(
          invite && /^[a-f0-9]{64}$/.test(invite) ? "/nova-senha" : next,
          url.origin,
        ),
      );
      if (invite && /^[a-f0-9]{64}$/.test(invite))
        r.cookies.set("pedizza-invite", invite, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 86400,
        });
      return r;
    }
  }
  return NextResponse.redirect(new URL("/login?error=confirmacao", url.origin));
}
