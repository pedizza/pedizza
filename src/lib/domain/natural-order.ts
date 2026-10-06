import { normalizeText } from "./normalization";

export type LocallyParsedOrder = {
  customer_name: null;
  category: string | null;
  flavors: string[];
  size: string | null;
  border: string | null;
  service: "delivery" | "pickup" | null;
  address_query: string | null;
  postal_code: null;
  street: null;
  number: null;
  complement: null;
  neighborhood: null;
  city: null;
  state: null;
};

function cleanPart(value: string) {
  return value
    .replace(/^(?:(?:de\s+)?meia(?:\s+de)?|de|do sabor|sabor de)\s+/, "")
    .replace(/[,.!?]+$/g, "")
    .trim();
}

/**
 * Extracts a directly stated pizza order without another network request.
 * The chatbot still validates every name against the tenant's real catalog.
 */
export function parseNaturalPizzaOrder(
  text: string,
): LocallyParsedOrder | null {
  const input = normalizeText(text).replace(/[–—]/g, "-");
  const pizzaStart = input.search(/\bpizza\b/);
  const standaloneHalf = input.match(
    /(?:^|\s)(?:de\s+)?meia\s+(.+?)\s+e\s+meia\s+(.+?)(?=\s+com\s+borda\b|\s+para\s+(?:entregar|entrega|retirar|retirada)\b|$)/,
  );
  if (pizzaStart < 0 && !standaloneHalf) return null;

  let itemPart = standaloneHalf
    ? `${standaloneHalf[1]} e ${standaloneHalf[2]}`
    : input.slice(pizzaStart + "pizza".length).trim();
  itemPart = itemPart.split(
    /\s+(?=com\s+borda\b|para\s+(?:entregar|entrega|retirar|retirada)\b)/,
    1,
  )[0];
  itemPart = itemPart
    .replace(/^(?:grande|broto)\s+/, "")
    .replace(
      /^(?:de\s+)?(?:meia[ -]?meia|meio[ -]?a[ -]?meio|meia[ -]?a[ -]?meia)(?:\s*[,;:]?\s*(?:dois sabores?)?\s*[:,-]?\s*|\s+de\s+)/,
      "",
    );

  const flavors = itemPart
    .split(/\s+(?:e|com)\s+/)
    .map(cleanPart)
    .filter(Boolean)
    .slice(0, 2);
  if (!flavors.length) return null;

  const border = cleanPart(
    input.match(
      /\bcom\s+borda(?:\s+de)?\s+(.+?)(?=\s+para\s+(?:entregar|entrega|retirar|retirada)\b|$)/,
    )?.[1] || "",
  );
  const addressQuery = cleanPart(
    input.match(
      /\bpara\s+(?:entregar|entrega)(?:\s+(?:na|no|em))?\s+(.+)$/,
    )?.[1] || "",
  );
  const delivery = /\b(?:entrega|entregar)\b/.test(input);
  const pickup = /\b(?:retirada|retirar)\b/.test(input);
  const isBroto = /\bbroto\b/.test(input);

  return {
    customer_name: null,
    category: isBroto ? "broto" : pizzaStart >= 0 ? "pizza" : null,
    flavors,
    size: isBroto ? "Broto" : /\bgrande\b/.test(input) ? "Grande" : null,
    border: border || null,
    service: delivery ? "delivery" : pickup ? "pickup" : null,
    address_query: addressQuery || null,
    postal_code: null,
    street: null,
    number: null,
    complement: null,
    neighborhood: null,
    city: null,
    state: null,
  };
}

export function normalizeCatalogTerm(value: string) {
  return normalizeText(value)
    .replace(/\b(?:mussarela|mussarella|mucarella)\b/g, "mucarela")
    .replace(/\bcalabreza\b/g, "calabresa");
}
