import { describe, it, expect } from "vitest";
import { splitPrice, discountAmount, parseCurrency } from "@/lib/domain/money";
import {
  getStoreOpenStatus,
  getNextOpeningTime,
  validateHours,
} from "@/lib/domain/hours";
import { canConfirmManually, canTransition } from "@/lib/domain/orders";
import { normalizePhone, validDocument } from "@/lib/domain/normalization";
import {
  extractWhatsAppMessageText,
  mainMenuOption,
} from "@/lib/domain/whatsapp";
import {
  formatCategoryCatalog,
  WHATSAPP_TEXT_LIMIT,
} from "@/lib/domain/catalog";
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
  it("only manual payment methods allow receipt confirmation", () => {
    expect(canConfirmManually("cash")).toBe(true);
    expect(canConfirmManually("pix_manual")).toBe(true);
    expect(canConfirmManually("credit_on_delivery")).toBe(true);
    expect(canConfirmManually("pix_mercado_pago")).toBe(false);
    expect(canConfirmManually("provider_future", true)).toBe(true);
  });
  it("phone and Brazilian documents are validated", () => {
    expect(normalizePhone("(11) 99999-9999")).toBe("5511999999999");
    expect(validDocument("11.222.333/0001-81", 14)).toBe(true);
    expect(validDocument("11111111111", 11)).toBe(false);
  });
  it("extracts WhatsApp list selections as chatbot commands", () => {
    expect(
      extractWhatsAppMessageText({
        listResponseMessage: {
          singleSelectReply: { selectedRowId: "2" },
        },
      }),
    ).toBe("2");
    expect(
      extractWhatsAppMessageText({
        interactiveResponseMessage: {
          nativeFlowResponseMessage: { paramsJson: '{"id":"3"}' },
        },
      }),
    ).toBe("3");
  });
  it("accepts numbers and natural text in the chatbot main menu", () => {
    expect(mainMenuOption("1")).toBe("1");
    expect(mainMenuOption("Fazer pedido")).toBe("1");
    expect(mainMenuOption("Quero fazer um pedido, por favor")).toBe("1");
    expect(mainMenuOption("Ver o cardápio")).toBe("2");
    expect(mainMenuOption("Acompanhar meu pedido")).toBe("3");
    expect(mainMenuOption("Status do pedido")).toBe("3");
    expect(mainMenuOption("qualquer coisa")).toBeNull();
  });
  it("formats every product in a category for WhatsApp", () => {
    const message = formatCategoryCatalog(
      "Pizzas Salgadas",
      [
        {
          id: "1",
          name: "Muçarela",
          description: "Muçarela e tomate",
          price_cents: 5200,
          price_count: 1,
        },
        {
          id: "2",
          name: "Calabresa",
          description: "Calabresa e cebola",
          price_cents: 5200,
          price_count: 1,
        },
      ],
      "Responda com o número ou o nome do produto.",
    );
    expect(message).toContain("*1. Muçarela - R$ 52,00*\nMuçarela e tomate");
    expect(message).toContain(
      "\n\n*2. Calabresa - R$ 52,00*\nCalabresa e cebola",
    );
    expect(message.length).toBeLessThanOrEqual(WHATSAPP_TEXT_LIMIT);
  });
});
