import { it, expect } from "vitest";
import { resources, resourceSchema } from "@/lib/modules/registry";
it("offers manual payment methods and rejects automatic PIX even when called directly", () => {
  const r = resources.pagamentos;
  const options = r.fields
    .find((f) => f.key === "type")!
    .options!.map((o) => o.value);
  expect(options).toEqual([
    "cash",
    "pix_manual",
    "credit_on_delivery",
    "debit_on_delivery",
    "custom_manual",
  ]);
  const input = {
    name: "PIX",
    type: "pix_manual",
    description: "",
    pix_key: "chave",
    active: true,
    requires_manual_confirmation: true,
    sort_order: 0,
  };
  expect(resourceSchema(r).safeParse(input).success).toBe(true);
  expect(
    resourceSchema(r).safeParse({ ...input, type: "pix_mercado_pago" }).success,
  ).toBe(false);
});
