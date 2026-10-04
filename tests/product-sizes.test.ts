import { describe, it, expect } from "vitest";
import { productSizesSchema } from "@/lib/modules/product-sizes";
describe("product size input", () => {
  const size = { name: "Grande", price_cents: 4700, slices: 8, max_flavors: 2 };
  it("rejects duplicate names and invalid money", () => {
    expect(
      productSizesSchema.safeParse([size, { ...size, name: " grande " }])
        .success,
    ).toBe(false);
    expect(
      productSizesSchema.safeParse([{ ...size, price_cents: -1 }]).success,
    ).toBe(false);
    expect(
      productSizesSchema.safeParse([{ ...size, price_cents: 1.5 }]).success,
    ).toBe(false);
  });
  it("supports multiple sizes and products without sizes", () => {
    expect(
      productSizesSchema.parse([size, { ...size, name: "Pequena", slices: 4 }]),
    ).toHaveLength(2);
    expect(productSizesSchema.parse([])).toEqual([]);
  });
});
