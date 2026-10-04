import { SignJWT, jwtVerify } from "jose";
const issuer = "pedizza",
  audience = "pedizza-session";
function key() {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32)
    throw Error("JWT_SECRET must contain at least 32 bytes");
  return new TextEncoder().encode(secret);
}
export async function signSession(userId: string, sessionId: string) {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(key());
}
export async function verifySessionToken(token: string) {
  const { payload } = await jwtVerify(token, key(), {
    algorithms: ["HS256"],
    issuer,
    audience,
    requiredClaims: ["sub", "sid", "iat", "exp"],
    maxTokenAge: "8h",
  });
  if (
    typeof payload.sub !== "string" ||
    typeof payload.sid !== "string" ||
    !/^[0-9a-f-]{36}$/.test(payload.sub) ||
    !/^[0-9a-f-]{36}$/.test(payload.sid)
  )
    throw Error("Invalid session");
  return { userId: payload.sub, sessionId: payload.sid };
}
