import { invariant } from "@/lib/errors";
export const formatCurrency = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    cents / 100,
  );

export const formatChatCurrency = (cents: number) =>
  cents === 0 ? "GRÁTIS 🎁" : formatCurrency(cents);
export function parseCurrency(value: string) {
  const v = value
    .trim()
    .replace(/^R\$\s*/, "")
    .replace(/\./g, "");
  invariant(/^\d+(,\d{1,2})?$/.test(v), "Informe um valor válido.");
  const [whole, fraction = ""] = v.split(",");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  invariant(
    Number.isSafeInteger(cents) && cents <= 100000000,
    "Valor fora do limite.",
  );
  return cents;
}
export function splitPrice(prices: number[], rule: "highest" | "proportional") {
  invariant(
    prices.length >= 1 &&
      prices.length <= 2 &&
      prices.every((v) => Number.isSafeInteger(v) && v >= 0),
    "Preços inválidos.",
  );
  return rule === "highest"
    ? Math.max(...prices)
    : Math.floor(
        (prices.reduce((a, b) => a + b, 0) + prices.length / 2) / prices.length,
      );
}
export function discountAmount(
  eligible: number,
  type: "fixed" | "percentage",
  value: number,
) {
  invariant(
    Number.isSafeInteger(eligible) &&
      eligible >= 0 &&
      Number.isSafeInteger(value) &&
      value > 0,
    "Desconto inválido.",
  );
  invariant(type !== "percentage" || value <= 100, "Percentual inválido.");
  return Math.min(
    eligible,
    type === "fixed" ? value : Math.floor((eligible * value + 50) / 100),
  );
}
