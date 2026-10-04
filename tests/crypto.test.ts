import { afterEach, describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { encrypt, decrypt, verifyBravoSignature } from "@/lib/security/crypto";
import { verifyMpSignature } from "@/lib/integrations/mercado-pago";
import { boundedBody } from "@/lib/security/body";
const original = process.env.INTEGRATION_ENCRYPTION_KEY;
afterEach(() => {
  if (original === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
  else process.env.INTEGRATION_ENCRYPTION_KEY = original;
});
describe("Integration boundaries", () => {
  it("encrypts with random nonces and rejects modified credentials", () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
      "base64",
    );
    const first = encrypt("credential");
    expect(first).not.toBe(encrypt("credential"));
    expect(decrypt(first)).toBe("credential");
    const parts = first.split(".");
    parts[1] = Buffer.from("modified").toString("base64");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
  it("checks Bravo signatures against the raw body and replay window", () => {
    const now = 1800000000000,
      t = String(now / 1000),
      body = '{"id":"test"}',
      secret = "test-secret";
    const sig = createHmac("sha256", secret)
      .update(t + "." + body)
      .digest("hex");
    expect(verifyBravoSignature(body, `t=${t}, v1=${sig}`, secret, now)).toBe(
      true,
    );
    expect(
      verifyBravoSignature(body + " ", `t=${t},v1=${sig}`, secret, now),
    ).toBe(false);
    expect(
      verifyBravoSignature(body, `t=${t},v1=${sig}`, secret, now + 301000),
    ).toBe(false);
  });
  it("binds Mercado Pago signatures to payment id and request id", () => {
    const now = 1800000000000,
      t = String(now / 1000),
      secret = "test-secret";
    const sig = createHmac("sha256", secret)
      .update(`id:123;request-id:req;ts:${t};`)
      .digest("hex");
    expect(
      verifyMpSignature("123", "req", `ts=${t},v1=${sig}`, secret, now),
    ).toBe(true);
    expect(
      verifyMpSignature("456", "req", `ts=${t},v1=${sig}`, secret, now),
    ).toBe(false);
  });
  it("stops oversized streams before processing their content", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(new Uint8Array(100));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(boundedBody(stream, 99)).rejects.toThrow("limite");
    expect(cancelled).toBe(true);
  });
});
