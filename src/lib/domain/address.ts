import { normalizeText } from "./normalization";

type FormattableAddress = Partial<{
  postal_code: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
}>;

const brazilianStates: Record<string, string> = {
  acre: "AC",
  alagoas: "AL",
  amapa: "AP",
  amazonas: "AM",
  bahia: "BA",
  ceara: "CE",
  "distrito federal": "DF",
  "espirito santo": "ES",
  goias: "GO",
  maranhao: "MA",
  "mato grosso": "MT",
  "mato grosso do sul": "MS",
  "minas gerais": "MG",
  para: "PA",
  paraiba: "PB",
  parana: "PR",
  pernambuco: "PE",
  piaui: "PI",
  "rio de janeiro": "RJ",
  "rio grande do norte": "RN",
  "rio grande do sul": "RS",
  rondonia: "RO",
  roraima: "RR",
  "santa catarina": "SC",
  "sao paulo": "SP",
  sergipe: "SE",
  tocantins: "TO",
};

export function normalizeBrazilianState(state?: string | null) {
  if (!state) return undefined;
  const normalized = normalizeText(state);
  return normalized.length === 2
    ? normalized.toUpperCase()
    : brazilianStates[normalized];
}

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
