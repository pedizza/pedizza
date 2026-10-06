type FormattableAddress = Partial<{
  postal_code: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
}>;

export function formatAddress(address?: FormattableAddress | null) {
  if (!address) return "";
  const street = address.street?.trim();
  const number = address.number?.trim();
  const complement = address.complement?.trim();
  const neighborhood = address.neighborhood?.trim();
  const city = address.city?.trim();
  const state = address.state?.trim();
  const location = [neighborhood, city, state].filter(Boolean).join(" - ");
  return [
    [street, number ? `nº ${number}` : ""].filter(Boolean).join(", "),
    complement,
    location,
  ]
    .filter(Boolean)
    .join(" - ");
}
