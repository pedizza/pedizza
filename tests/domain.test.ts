import { describe, it, expect } from "vitest";
import { splitPrice, discountAmount, parseCurrency } from "@/lib/domain/money";
import {
  getStoreOpenStatus,
  getNextOpeningTime,
  validateHours,
} from "@/lib/domain/hours";
import { canTransition } from "@/lib/domain/orders";
import { normalizePhone, validDocument } from "@/lib/domain/normalization";
describe("domain invariants", () => {
  it("money stays in integer cents", () => {
    expect(splitPrice([5000, 7000], "proportional")).toBe(6000);
    expect(splitPrice([4999, 7001], "proportional")).toBe(6000);
    expect(splitPrice([4999, 7000], "proportional")).toBe(6000);
    expect(splitPrice([5000, 7000], "highest")).toBe(7000);
    expect(discountAmount(4999, "percentage", 10)).toBe(500);
    expect(discountAmount(500, "fixed", 1000)).toBe(500);
    expect(parseCurrency("1.234,56")).toBe(123456);
  });
  it("midnight hours use tenant timezone and previous day", () => {
    const hours = [{ day_of_week: 5, start_time: "18:00", end_time: "01:00" }];
    expect(
      getStoreOpenStatus(
        hours,
        "America/Sao_Paulo",
        "automatic",
        new Date("2026-10-03T03:30:00Z"),
      ).isOpen,
    ).toBe(true);
    expect(
      getStoreOpenStatus(
        hours,
        "America/Sao_Paulo",
        "automatic",
        new Date("2026-10-03T04:00:00Z"),
      ).isOpen,
    ).toBe(false);
    expect(
      getStoreOpenStatus(
        hours,
        "America/Sao_Paulo",
        "forced_closed",
        new Date("2026-10-03T03:30:00Z"),
      ).isOpen,
    ).toBe(false);
    expect(
      getNextOpeningTime(
        hours,
        "America/Sao_Paulo",
        new Date("2026-10-03T04:00:00Z"),
      ),
    ).toBe("2026-10-09T21:00:00Z");
  });
  it("overlap across midnight and week is rejected", () => {
    expect(() =>
      validateHours([
        { day_of_week: 6, start_time: "23:00", end_time: "02:00" },
        { day_of_week: 0, start_time: "01:00", end_time: "03:00" },
      ]),
    ).toThrow();
  });
  it("pickup cannot move into delivery", () => {
    expect(canTransition("preparing", "ready_for_pickup", "pickup")).toBe(true);
    expect(canTransition("preparing", "out_for_delivery", "pickup")).toBe(
      false,
    );
    expect(canTransition("delivered", "cancelled", "delivery")).toBe(false);
  });
  it("phone and Brazilian documents are validated", () => {
    expect(normalizePhone("(11) 99999-9999")).toBe("5511999999999");
    expect(validDocument("11.222.333/0001-81", 14)).toBe(true);
    expect(validDocument("11111111111", 11)).toBe(false);
  });
});
