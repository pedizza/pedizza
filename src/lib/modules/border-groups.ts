import { z } from "zod";

export const borderOptionsSchema = z
  .array(
    z
      .object({
        id: z.uuid().optional(),
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(500).default(""),
        price_cents: z.number().int().min(0).max(100_000_000),
        active: z.boolean().default(true),
        sort_order: z.number().int().min(0).max(100_000).default(0),
      })
      .strict(),
  )
  .min(1, "Adicione pelo menos um sabor de borda.")
  .max(100)
  .refine(
    (options) =>
      new Set(options.map((option) => option.name.toLocaleLowerCase("pt-BR")))
        .size === options.length,
    "Não repita o mesmo sabor de borda.",
  );

export const borderCategoryIdsSchema = z
  .array(z.uuid())
  .min(1, "Selecione pelo menos uma categoria permitida.")
  .max(100)
  .transform((ids) => [...new Set(ids)]);

export type BorderOption = z.infer<typeof borderOptionsSchema>[number];
