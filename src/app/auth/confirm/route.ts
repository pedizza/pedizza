import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { transaction, one } from "@/lib/db";
export async function GET(request: Request) {
  const u = new URL(request.url);
  const token = z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .safeParse(u.searchParams.get("token"));
  if (token.success) {
    const success = await transaction(async (db) => {
      const record = await one<{ user_id: string }>(
        db,
        "update private.auth_tokens set used_at=now() where token_hash=$1 and purpose='verify' and used_at is null and expires_at>now() returning user_id",
        [createHash("sha256").update(token.data).digest("hex")],
      );
      if (!record) return false;
      await db.query(
        "update private.accounts set email_verified_at=coalesce(email_verified_at,now()) where id=$1",
        [record.user_id],
      );
      return true;
    });
    if (success)
      return NextResponse.redirect(new URL("/login?confirmed=1", u.origin));
  }
  return NextResponse.redirect(new URL("/login?error=confirmacao", u.origin));
}
