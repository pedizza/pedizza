import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = z
    .object({
      token_hash: z.string().min(20).max(2048),
      type: z.enum(["signup", "invite", "recovery", "email_change", "email"]),
    })
    .safeParse(Object.fromEntries(url.searchParams));
  if (parsed.success) {
    const client = await supabaseServer();
    const { error } = await client.auth.verifyOtp(parsed.data);
    if (!error) {
      let invite = url.searchParams.get("invite");
      const redirectTo = url.searchParams.get("redirect_to");
      if (!invite && redirectTo) {
        try {
          invite = new URL(redirectTo).searchParams.get("invite");
        } catch {}
      }
      const validInvite = invite && /^[a-f0-9]{64}$/.test(invite);
      const r = NextResponse.redirect(
        new URL(
          parsed.data.type === "invite" || parsed.data.type === "recovery"
            ? "/nova-senha"
            : validInvite
              ? "/convite?token=" + invite
              : "/app",
          url.origin,
        ),
      );
      if (validInvite)
        r.cookies.set("pedizza-invite", invite!, {
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
