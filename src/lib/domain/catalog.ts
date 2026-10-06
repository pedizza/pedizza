import { formatCurrency } from "@/lib/domain/money";
import { keycapNumber } from "@/lib/domain/whatsapp";

export const WHATSAPP_TEXT_LIMIT = 65_536;

export type CatalogProduct = {
  id: string;
  name: string;
  description: string;
  price_cents: number | null;
  price_count: number;
};

function priceLabel(product: CatalogProduct) {
  if (product.price_cents === null) return "Preço sob consulta";
  const price = formatCurrency(product.price_cents).replace(/\u00a0/g, " ");
  return product.price_count > 1 ? `a partir de ${price}` : price;
}

export function formatCategoryCatalog(
  categoryName: string,
  products: CatalogProduct[],
  footer: string,
) {
  const entries = products.map((product, index) =>
    [
      `*${keycapNumber(index + 1)} ${product.name} - ${priceLabel(product)}*`,
      product.description.trim(),
    ]
      .filter(Boolean)
      .join("\n"),
  );
  const message = [`*${categoryName}*`, entries.join("\n\n"), footer]
    .filter(Boolean)
    .join("\n\n");

  if (message.length > WHATSAPP_TEXT_LIMIT)
    throw new Error("O cardápio desta categoria excede o limite do WhatsApp.");
  return message;
}
