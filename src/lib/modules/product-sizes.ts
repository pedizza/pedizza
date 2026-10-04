import { z } from "zod";
export const productSizesSchema = z
  .array(
    z.object({
      name: z.string().trim().min(1).max(80),
      price_cents: z.number().int().min(0).max(100000000),
      slices: z.number().int().min(1).max(24).nullable(),
      max_flavors: z.number().int().min(1).max(2),
    }),
  )
  .max(30)
  .superRefine((sizes, ctx) => {
    const names = sizes.map((s) => s.name.toLocaleLowerCase("pt-BR"));
    if (new Set(names).size !== names.length)
      ctx.addIssue({
        code: "custom",
        message: "Não repita o mesmo tamanho no produto.",
      });
  });
export type ProductSize = z.infer<typeof productSizesSchema>[number];
