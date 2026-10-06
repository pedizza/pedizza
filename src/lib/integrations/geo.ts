import "server-only";
import { z } from "zod";
import { createHash } from "node:crypto";
import { externalJson } from "./http";
import { requiredEnv } from "@/lib/env";
import { transaction, one } from "@/lib/db";
import { AppError, invariant } from "@/lib/errors";
import { normalizeText } from "@/lib/domain/normalization";
export const deliveryOutOfRangeMessage =
  "Infelizmente, não atendemos esse local porque ele está fora da nossa área de entrega.";
export const addressSchema = z.object({
  postal_code: z.string().regex(/^\d{8}$/),
  street: z.string().trim().min(2).max(200),
  number: z.string().trim().min(1).max(20),
  complement: z.string().max(100).default(""),
  neighborhood: z.string().trim().min(1).max(100),
  city: z.string().trim().min(1).max(100),
  state: z.string().regex(/^[A-Z]{2}$/),
});
export type Address = z.infer<typeof addressSchema>;
async function cached<T>(
  tenant: string,
  key: string,
  schema: z.ZodType<T>,
  load: () => Promise<T>,
  ttl = 86400,
) {
  const hash = createHash("sha256")
    .update(tenant + ":" + key)
    .digest("hex");
  const hit = await transaction((db) =>
    one<{ value: unknown }>(
      db,
      "select value from private.geo_cache where key=$1 and tenant_id=$2 and expires_at>now()",
      [hash, tenant],
    ),
  );
  if (hit) return schema.parse(hit.value);
  const value = await load();
  await transaction((db) =>
    db.query(
      "insert into private.geo_cache(key,tenant_id,value,expires_at) values($1,$2,$3,now()+$4*interval '1 second') on conflict(key) do update set value=excluded.value,expires_at=excluded.expires_at",
      [hash, tenant, JSON.stringify(value), ttl],
    ),
  );
  return value;
}
const cepSchema = z.object({
  cep: z.string(),
  logradouro: z.string(),
  bairro: z.string(),
  localidade: z.string(),
  uf: z.string(),
  erro: z.boolean().optional(),
});
export async function lookupCep(tenant: string, cep: string) {
  z.string()
    .regex(/^\d{8}$/)
    .parse(cep);
  return cached(
    tenant,
    "cep:" + cep,
    cepSchema,
    async () => {
      const value = await externalJson(
        new URL(`https://viacep.com.br/ws/${cep}/json/`),
      );
      const result = cepSchema.safeParse(value);
      invariant(result.success && !result.data.erro, "CEP não encontrado.");
      return result.data;
    },
    604800,
  );
}

export async function lookupAddress(
  tenant: string,
  input: Partial<Address> & {
    query?: string;
    street?: string;
    number?: string;
  },
) {
  const query =
    input.query?.trim() ||
    [
      input.street,
      input.number,
      input.neighborhood,
      input.city,
      input.state,
      input.postal_code,
      "Brasil",
    ]
      .filter(Boolean)
      .join(", ");
  invariant(query.length >= 5, "Informe o endereço para localizarmos.");
  return cached(
    tenant,
    "address:" + normalizeText(query),
    addressSchema,
    async () => {
      const url = new URL("https://api.geoapify.com/v1/geocode/search");
      url.search = new URLSearchParams({
        text: query,
        filter: "countrycode:br",
        format: "json",
        limit: "1",
        apiKey: requiredEnv("GEOAPIFY_API_KEY"),
      }).toString();
      const result = z
        .object({
          results: z.array(
            z.object({
              street: z.string().optional(),
              housenumber: z.string().optional(),
              suburb: z.string().optional(),
              district: z.string().optional(),
              city: z.string().optional(),
              town: z.string().optional(),
              municipality: z.string().optional(),
              postcode: z.string().optional(),
              state_code: z.string().optional(),
              rank: z.object({ confidence: z.number().optional() }).optional(),
            }),
          ),
        })
        .parse(await externalJson(url));
      const match = result.results[0];
      invariant(
        match && (match.rank?.confidence ?? 0) >= 0.6,
        "Não conseguimos localizar o endereço com precisão. Informe o CEP.",
      );
      const state = (input.state || match.state_code || "")
        .split("-")
        .at(-1)!
        .toUpperCase();
      return addressSchema.parse({
        postal_code: (input.postal_code || match.postcode || "").replace(
          /\D/g,
          "",
        ),
        street: input.street || match.street || "",
        number: input.number || match.housenumber || "",
        complement: input.complement || "",
        neighborhood:
          input.neighborhood || match.suburb || match.district || "",
        city:
          input.city || match.city || match.town || match.municipality || "",
        state,
      });
    },
    604800,
  );
}
const coordinates = z.object({ lat: z.number(), lon: z.number() });
export async function geocode(tenant: string, address: Address) {
  const query = [
    address.street,
    address.number,
    address.neighborhood,
    address.city,
    address.state,
    address.postal_code,
    "Brasil",
  ].join(", ");
  return cached(
    tenant,
    "geo:" + normalizeText(query),
    coordinates,
    async () => {
      const url = new URL("https://api.geoapify.com/v1/geocode/search");
      url.search = new URLSearchParams({
        text: query,
        filter: "countrycode:br",
        format: "json",
        limit: "1",
        apiKey: requiredEnv("GEOAPIFY_API_KEY"),
      }).toString();
      const result = z
        .object({
          results: z.array(
            z.object({
              lat: z.number(),
              lon: z.number(),
              rank: z.object({ confidence: z.number().optional() }).optional(),
            }),
          ),
        })
        .parse(await externalJson(url));
      const point = result.results[0];
      invariant(
        point && (point.rank?.confidence ?? 0) >= 0.6,
        "Não conseguimos localizar o endereço com precisão. Confira rua e número.",
      );
      return { lat: point.lat, lon: point.lon };
    },
  );
}
export async function quoteDelivery(tenant: string, address: Address) {
  const setup = await transaction((db) =>
    one<{ pricing_mode: string; max_distance_meters: number; store: Address }>(
      db,
      `select d.pricing_mode,d.max_distance_meters,jsonb_build_object('postal_code',s.postal_code,'street',s.street,'number',s.number,'complement',s.complement,'neighborhood',s.neighborhood,'city',s.city,'state',s.state) store from public.delivery_settings d join public.store_settings s using(tenant_id) where d.tenant_id=$1 and s.delivery_enabled`,
      [tenant],
    ),
  );
  invariant(setup, "Entrega indisponível.");
  if (setup.pricing_mode === "neighborhood") {
    invariant(
      normalizeText(address.city) === normalizeText(setup.store.city) &&
        address.state.toUpperCase() === setup.store.state.toUpperCase(),
      "Endereço fora da cidade atendida.",
    );
    const fee = await transaction((db) =>
      one<{ fee_cents: number }>(
        db,
        "select fee_cents from public.delivery_neighborhood_fees where tenant_id=$1 and normalized_name=$2 and city=$3 and state=$4 and active",
        [
          tenant,
          normalizeText(address.neighborhood),
          normalizeText(address.city),
          address.state.toUpperCase(),
        ],
      ),
    );
    invariant(fee, "Este bairro ainda não é atendido.");
    return { fee_cents: fee.fee_cents, distance_meters: null };
  }
  const [from, to] = await Promise.all([
    geocode(tenant, addressSchema.parse(setup.store)),
    geocode(tenant, address),
  ]);
  const distance = await cached(
    tenant,
    `route:${from.lat},${from.lon}:${to.lat},${to.lon}`,
    z.number().int().nonnegative(),
    async () => {
      const url = new URL("https://api.geoapify.com/v1/routing");
      url.search = new URLSearchParams({
        waypoints: `${from.lat},${from.lon}|${to.lat},${to.lon}`,
        mode: "drive",
        format: "json",
        apiKey: requiredEnv("GEOAPIFY_API_KEY"),
      }).toString();
      const result = z
        .object({
          results: z.array(z.object({ distance: z.number().nonnegative() })),
        })
        .parse(await externalJson(url));
      invariant(result.results[0], "Não foi possível calcular a rota.");
      return Math.ceil(result.results[0].distance);
    },
    3600,
  );
  if (distance > setup.max_distance_meters)
    throw new AppError(400, deliveryOutOfRangeMessage, "delivery_out_of_range");
  const fee = await transaction((db) =>
    one<{ fee_cents: number }>(
      db,
      "select fee_cents from public.delivery_distance_fees where tenant_id=$1 and active and min_meters<=$2 and max_meters>$2",
      [tenant, distance],
    ),
  );
  if (!fee)
    throw new AppError(400, deliveryOutOfRangeMessage, "delivery_out_of_range");
  return { fee_cents: fee.fee_cents, distance_meters: distance };
}
