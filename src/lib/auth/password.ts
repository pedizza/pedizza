import { randomBytes, scrypt as derive, timingSafeEqual } from "node:crypto";
const N = 32768,
  r = 8,
  p = 1;
function scrypt(password: string, salt: string) {
  return new Promise<Buffer>((resolve, reject) =>
    derive(
      password,
      salt,
      64,
      { N, r, p, maxmem: 64 * 1024 * 1024 },
      (e, key) => (e ? reject(e) : resolve(key)),
    ),
  );
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${(await scrypt(password, salt)).toString("hex")}`;
}
export async function verifyPassword(password: string, hash: string | null) {
  const parts = hash?.split("$");
  const valid =
    parts?.length === 3 &&
    parts[0] === "scrypt" &&
    /^[a-f0-9]{32}$/.test(parts[1]) &&
    /^[a-f0-9]{128}$/.test(parts[2]);
  const actual = await scrypt(
    password,
    valid ? parts[1] : "00000000000000000000000000000000",
  );
  return !!valid && timingSafeEqual(actual, Buffer.from(parts[2], "hex"));
}
