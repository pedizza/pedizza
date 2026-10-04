import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
  createHmac,
} from "node:crypto";
import { requiredEnv } from "@/lib/env";
function key() {
  const k = Buffer.from(requiredEnv("INTEGRATION_ENCRYPTION_KEY"), "base64");
  if (k.length !== 32) throw new Error("Invalid encryption key");
  return k;
}
export function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  return [
    iv.toString("base64"),
    cipher.update(value, "utf8", "base64") + cipher.final("base64"),
    cipher.getAuthTag().toString("base64"),
  ].join(".");
}
export function decrypt(value: string) {
  const [iv, body, tag] = value.split(".");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(iv, "base64"),
  );
  cipher.setAuthTag(Buffer.from(tag, "base64"));
  return cipher.update(body, "base64", "utf8") + cipher.final("utf8");
}
export function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export function verifyBravoSignature(
  body: string,
  header: string,
  secret: string,
  now = Date.now(),
) {
  const parts = Object.fromEntries(
    header.split(",").map((v) => v.trim().split("=")),
  );
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > 300 || !parts.v1)
    return false;
  return safeEqual(
    createHmac("sha256", secret).update(`${parts.t}.${body}`).digest("hex"),
    parts.v1,
  );
}
