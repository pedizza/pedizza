import "server-only";
import { cookies } from "next/headers";
import { transaction, one } from "@/lib/db";
import { signSession, verifySessionToken } from "./jwt";
export const sessionCookie =
  process.env.NODE_ENV === "production"
    ? "__Host-pedizza-session"
    : "pedizza-session";
export type AuthUser = {
  id: string;
  email: string;
  email_confirmed_at: Date | null;
  sessionId: string;
  mfaVerified: boolean;
};
export async function currentUser(): Promise<AuthUser | null> {
  const token = (await cookies()).get(sessionCookie)?.value;
  if (!token) return null;
  let claims;
  try {
    claims = await verifySessionToken(token);
  } catch {
    return null;
  }
  const user = await transaction((db) =>
    one<{
      id: string;
      email: string;
      email_verified_at: Date | null;
      session_id: string;
      mfa: boolean;
    }>(
      db,
      `select a.id,a.email,a.email_verified_at,s.id session_id,(s.mfa_verified_at>now()-interval '8 hours') mfa from private.sessions s join private.accounts a on a.id=s.user_id join public.profiles p on p.id=a.id where s.id=$1 and s.user_id=$2 and s.revoked_at is null and s.expires_at>now() and not p.blocked`,
      [claims.sessionId, claims.userId],
    ),
  );
  return user
    ? {
        id: user.id,
        email: user.email,
        email_confirmed_at: user.email_verified_at,
        sessionId: user.session_id,
        mfaVerified: !!user.mfa,
      }
    : null;
}
export async function createSession(userId: string) {
  const id = crypto.randomUUID();
  const token = await signSession(userId, id);
  await transaction((db) =>
    db.query(
      "insert into private.sessions(id,user_id,expires_at) values($1,$2,now()+interval '8 hours')",
      [id, userId],
    ),
  );
  (await cookies()).set(sessionCookie, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 28800,
  });
}
export async function endSession() {
  const user = await currentUser();
  if (user)
    await transaction((db) =>
      db.query("update private.sessions set revoked_at=now() where id=$1", [
        user.sessionId,
      ]),
    );
  (await cookies()).delete(sessionCookie);
}
