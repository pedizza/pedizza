import { invariant } from "@/lib/errors";
export const normalizeText = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\uFE0F\u20E3]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
export function normalizePhone(s: string) {
  let n = s.replace(/\D/g, "");
  if (n.length === 10 || n.length === 11) n = "55" + n;
  invariant(/^[1-9]\d{9,14}$/.test(n), "Informe um telefone com DDD.");
  return n;
}
export function validDocument(value: string, length: 11 | 14) {
  const n = value.replace(/\D/g, "");
  if (!n) return true;
  if (n.length !== length || /^(\d)\1+$/.test(n)) return false;
  const digit = (base: string) => {
    let weight =
      base.length === 9
        ? 10
        : base.length === 10
          ? 11
          : base.length === 12
            ? 5
            : 6;
    let sum = 0;
    for (const ch of base) {
      sum += Number(ch) * weight--;
      if (length === 14 && weight < 2) weight = 9;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return (
    digit(n.slice(0, -2)) === Number(n.at(-2)) &&
    digit(n.slice(0, -1)) === Number(n.at(-1))
  );
}
