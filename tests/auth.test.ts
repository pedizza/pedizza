import { describe, it, expect, afterEach } from "vitest";
import { SignJWT } from "jose";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { signSession, verifySessionToken } from "@/lib/auth/jwt";
import { authEmail } from "@/lib/auth/mail";
const original = process.env.JWT_SECRET;
afterEach(() => {
  if (original === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = original;
});
describe("Own authentication", () => {
  it("creates safe confirmation and recovery email content", () => {
    const email = authEmail({
      title: "Confirme sua conta",
      message: "Olá <cliente>",
      action: "Confirmar",
      url: "https://www.pedizza.com.br/auth/confirm?token=abc&source=email",
      expiration: "em 24 horas",
    });
    expect(email.text).toContain("https://www.pedizza.com.br/auth/confirm");
    expect(email.html).toContain("Olá &lt;cliente&gt;");
    expect(email.html).toContain("token=abc&amp;source=email");
    expect(email.html).not.toContain("Olá <cliente>");
  });
  it("hashes passwords with random salts and verifies without storing plaintext", async () => {
    const hash = await hashPassword("unit-test-password");
    expect(hash).not.toContain("unit-test-password");
    expect(hash).not.toBe(await hashPassword("unit-test-password"));
    expect(await verifyPassword("unit-test-password", hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
    expect(await verifyPassword("anything", null)).toBe(false);
  });
  it("validates JWT signature, purpose and expiration", async () => {
    process.env.JWT_SECRET = "a".repeat(64);
    const uid = crypto.randomUUID(),
      sid = crypto.randomUUID();
    const token = await signSession(uid, sid);
    expect(await verifySessionToken(token)).toEqual({
      userId: uid,
      sessionId: sid,
    });
    const segments = token.split(".");
    segments[1] = Buffer.from(
      JSON.stringify({ sub: uid, sid, role: "master" }),
    ).toString("base64url");
    await expect(verifySessionToken(segments.join("."))).rejects.toThrow();
    const expired = await new SignJWT({ sid })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(uid)
      .setIssuer("pedizza")
      .setAudience("pedizza-session")
      .setIssuedAt()
      .setExpirationTime("0s")
      .sign(new TextEncoder().encode(process.env.JWT_SECRET));
    await expect(verifySessionToken(expired)).rejects.toThrow();
    const wrong = await new SignJWT({ sid })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(uid)
      .setIssuer("other")
      .setAudience("pedizza-session")
      .setIssuedAt()
      .setExpirationTime("8h")
      .sign(new TextEncoder().encode(process.env.JWT_SECRET));
    await expect(verifySessionToken(wrong)).rejects.toThrow();
  });
  it("refuses weak or absent JWT secrets", async () => {
    process.env.JWT_SECRET = "weak";
    await expect(
      signSession(crypto.randomUUID(), crypto.randomUUID()),
    ).rejects.toThrow("32 bytes");
  });
});
