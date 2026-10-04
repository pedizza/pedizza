import { z } from "zod";
import type { Permission } from "@/lib/permissions";
import { validDocument, normalizePhone } from "@/lib/domain/normalization";
export type Field = {
  key: string;
  label: string;
  type?:
    | "text"
    | "textarea"
    | "number"
    | "money"
    | "checkbox"
    | "select"
    | "date"
    | "datetime-local"
    | "time"
    | "email";
  required?: boolean;
  options?: { value: string; label: string }[];
  reference?: string;
  default?: string | number | boolean;
  min?: number;
  max?: number;
};
export type Resource = {
  table: string;
  title: string;
  singular: string;
  description: string;
  read: Permission;
  write: Permission;
  fields: Field[];
  search?: string;
  singleton?: boolean;
  archive?: boolean;
};
export const resources: Record<string, Resource> = {
  loja: {
    table: "store_settings",
    title: "Minha loja",
    singular: "loja",
    description: "A identidade e o funcionamento da sua pizzaria.",
    read: "settings.view",
    write: "settings.edit",
    fields: [
      {
        key: "display_name",
        label: "Nome da loja",
        type: "text",
        required: true,
      },
      {
        key: "legal_name",
        label: "Razão social",
        type: "text",
        required: false,
      },
      { key: "cnpj", label: "CNPJ (opcional)", type: "text", required: false },
      { key: "whatsapp", label: "WhatsApp", type: "text", required: false },
      { key: "phone", label: "Telefone", type: "text", required: false },
      { key: "email", label: "E-mail", type: "email", required: false },
      { key: "postal_code", label: "CEP", type: "text", required: false },
      { key: "street", label: "Logradouro", type: "text", required: false },
      { key: "number", label: "Número", type: "text", required: false },
      {
        key: "complement",
        label: "Complemento",
        type: "text",
        required: false,
      },
      { key: "neighborhood", label: "Bairro", type: "text", required: false },
      { key: "city", label: "Cidade", type: "text", required: false },
      { key: "state", label: "UF", type: "text", required: false },
      {
        key: "minimum_order_cents",
        label: "Pedido mínimo",
        type: "money",
        required: false,
      },
      {
        key: "preparation_minutes",
        label: "Preparo (minutos)",
        type: "number",
        required: true,
        default: 40,
      },
      {
        key: "delivery_enabled",
        label: "Entrega",
        type: "checkbox",
        required: false,
        default: true,
      },
      {
        key: "pickup_enabled",
        label: "Retirada",
        type: "checkbox",
        required: false,
        default: true,
      },
      {
        key: "status_mode",
        label: "Status da loja",
        type: "select",
        required: true,
        default: "automatic",
        options: [
          { value: "automatic", label: "automatic" },
          { value: "forced_open", label: "forced_open" },
          { value: "forced_closed", label: "forced_closed" },
        ],
      },
      {
        key: "welcome_message",
        label: "Mensagem de boas-vindas",
        type: "textarea",
        required: false,
      },
      {
        key: "closed_message",
        label: "Mensagem de loja fechada",
        type: "textarea",
        required: false,
      },
      {
        key: "additional_information",
        label: "Informações adicionais",
        type: "textarea",
        required: false,
      },
      {
        key: "timezone",
        label: "Fuso horário",
        type: "select",
        required: true,
        default: "America/Sao_Paulo",
        options: [
          { value: "America/Sao_Paulo", label: "America/Sao_Paulo" },
          { value: "America/Manaus", label: "America/Manaus" },
          { value: "America/Belem", label: "America/Belem" },
          { value: "America/Fortaleza", label: "America/Fortaleza" },
          { value: "America/Rio_Branco", label: "America/Rio_Branco" },
          { value: "America/Cuiaba", label: "America/Cuiaba" },
        ],
      },
      {
        key: "currency",
        label: "Moeda",
        type: "select",
        required: true,
        default: "BRL",
        options: [{ value: "BRL", label: "BRL" }],
      },
      {
        key: "time_format",
        label: "Formato de hora",
        type: "select",
        required: true,
        default: "24h",
        options: [
          { value: "24h", label: "24h" },
          { value: "12h", label: "12h" },
        ],
      },
    ],
    singleton: true,
    archive: false,
  },
  horarios: {
    table: "store_business_hours",
    title: "Horários",
    singular: "período",
    description:
      "Adicione vários períodos por dia, incluindo horários após a meia-noite.",
    read: "settings.view",
    write: "settings.edit",
    fields: [
      {
        key: "day_of_week",
        label: "Dia da semana",
        type: "select",
        required: true,
        default: "1",
        options: [
          { value: "0", label: "0" },
          { value: "1", label: "1" },
          { value: "2", label: "2" },
          { value: "3", label: "3" },
          { value: "4", label: "4" },
          { value: "5", label: "5" },
          { value: "6", label: "6" },
        ],
      },
      { key: "start_time", label: "Abre às", type: "time", required: true },
      { key: "end_time", label: "Fecha às", type: "time", required: true },
    ],
    singleton: false,
    archive: false,
  },
  categorias: {
    table: "menu_categories",
    title: "Categorias",
    singular: "categoria",
    description: "Organize o cardápio da sua pizzaria.",
    read: "menu.view",
    write: "menu.edit",
    fields: [
      { key: "name", label: "Nome", type: "text", required: true },
      {
        key: "description",
        label: "Descrição",
        type: "textarea",
        required: false,
      },
      {
        key: "active",
        label: "Ativa",
        type: "checkbox",
        required: false,
        default: true,
      },
      {
        key: "sort_order",
        label: "Ordem",
        type: "number",
        required: false,
        default: 0,
      },
      {
        key: "allow_split",
        label: "Permitir dois sabores",
        type: "checkbox",
        required: false,
      },
      {
        key: "split_pricing",
        label: "Cobrança de dois sabores",
        type: "select",
        required: true,
        default: "highest",
        options: [
          { value: "highest", label: "highest" },
          { value: "proportional", label: "proportional" },
        ],
      },
    ],
    singleton: false,
    archive: true,
    search: "name",
  },
  produtos: {
    table: "menu_items",
    title: "Produtos",
    singular: "produto",
    description: "Sabores e produtos que seus clientes vão adorar.",
    read: "menu.view",
    write: "menu.edit",
    fields: [
      { key: "name", label: "Nome", type: "text", required: true },
      {
        key: "category_id",
        label: "Categoria",
        type: "select",
        required: true,
        reference: "categorias",
      },
      {
        key: "description",
        label: "Descrição e ingredientes",
        type: "textarea",
        required: false,
      },
      {
        key: "base_price_cents",
        label: "Preço simples (sem tamanho)",
        type: "money",
        required: false,
      },
      {
        key: "active",
        label: "Ativo",
        type: "checkbox",
        required: false,
        default: true,
      },
      {
        key: "available",
        label: "Disponível agora",
        type: "checkbox",
        required: false,
        default: true,
      },
      {
        key: "sort_order",
        label: "Ordem",
        type: "number",
        required: false,
        default: 0,
      },
    ],
    singleton: false,
    archive: true,
    search: "name",
  },
  tamanhos: {
    table: "menu_sizes",
    title: "Tamanhos",
    singular: "tamanho",
    description: "Configure tamanhos para cada categoria.",
    read: "menu.view",
    write: "menu.edit",
    fields: [
      { key: "name", label: "Nome", type: "text", required: true },
      {
        key: "category_id",
        label: "Categoria",
        type: "select",
        required: true,
        reference: "categorias",
      },
      { key: "slices", label: "Fatias", type: "number", required: false },
      {
        key: "max_flavors",
        label: "Máximo de sabores",
        type: "select",
        required: true,
        default: "1",
        options: [
          { value: "1", label: "1" },
          { value: "2", label: "2" },
        ],
      },
      {
        key: "active",
        label: "Ativo",
        type: "checkbox",
        required: false,
        default: true,
      },
      {
        key: "sort_order",
        label: "Ordem",
        type: "number",
        required: false,
        default: 0,
      },
    ],
    singleton: false,
    archive: true,
    search: "name",
  },
  precos: {
    table: "menu_item_prices",
    title: "Preços por tamanho",
    singular: "preço",
    description: "Associe cada produto aos tamanhos disponíveis.",
    read: "menu.view",
    write: "menu.edit",
    fields: [
      {
        key: "item_id",
        label: "Produto",
        type: "select",
        required: true,
        reference: "produtos",
      },
      {
        key: "size_id",
        label: "Tamanho",
        type: "select",
        required: true,
        reference: "tamanhos",
      },
      { key: "price_cents", label: "Preço", type: "money", required: true },
      {
        key: "active",
        label: "Ativo",
        type: "checkbox",
        required: false,
        default: true,
      },
    ],
    singleton: false,
    archive: false,
  },
  bordas: {
    table: "menu_borders",
    title: "Bordas",
    singular: "borda",
    description: "As opções de borda da sua pizzaria.",
    read: "menu.view",
    write: "menu.edit",
    fields: [
      { key: "name", label: "Nome", type: "text", required: true },
      {
        key: "description",
        label: "Descrição",
        type: "textarea",
        required: false,
      },
      {
        key: "base_price_cents",
        label: "Preço",
        type: "money",
        required: true,
      },
      {
        key: "active",
        label: "Ativa",
        type: "checkbox",
        required: false,
        default: true,
      },
    ],
    singleton: false,
    archive: true,
    search: "name",
  },
  "borda-categorias": {
    table: "menu_border_categories",
    title: "Bordas por categoria",
    singular: "vínculo",
    description: "Defina em quais categorias cada borda pode ser escolhida.",
    read: "menu.view",
    write: "menu.edit",
    fields: [
      {
        key: "border_id",
        label: "Borda",
        type: "select",
        required: true,
        reference: "bordas",
      },
      {
        key: "category_id",
        label: "Categoria",
        type: "select",
        required: true,
        reference: "categorias",
      },
    ],
    singleton: false,
    archive: false,
  },
  "borda-precos": {
    table: "menu_border_prices",
    title: "Preços de bordas",
    singular: "preço",
    description: "Valores específicos por tamanho.",
    read: "menu.view",
    write: "menu.edit",
    fields: [
      {
        key: "border_id",
        label: "Borda",
        type: "select",
        required: true,
        reference: "bordas",
      },
      {
        key: "size_id",
        label: "Tamanho",
        type: "select",
        required: true,
        reference: "tamanhos",
      },
      { key: "price_cents", label: "Preço", type: "money", required: true },
    ],
    singleton: false,
    archive: false,
  },
  entrega: {
    table: "delivery_settings",
    title: "Regras de entrega",
    singular: "configuração",
    description: "Escolha como sua loja calcula as taxas.",
    read: "delivery.view",
    write: "delivery.edit",
    fields: [
      {
        key: "pricing_mode",
        label: "Cobrança por",
        type: "select",
        required: true,
        default: "neighborhood",
        options: [
          { value: "neighborhood", label: "neighborhood" },
          { value: "distance", label: "distance" },
        ],
      },
      {
        key: "max_distance_meters",
        label: "Distância máxima (metros)",
        type: "number",
        required: true,
        default: 10000,
      },
    ],
    singleton: true,
    archive: false,
  },
  bairros: {
    table: "delivery_neighborhood_fees",
    title: "Bairros atendidos",
    singular: "bairro",
    description: "Uma taxa definida para cada bairro.",
    read: "delivery.view",
    write: "delivery.edit",
    fields: [
      { key: "name", label: "Bairro", type: "text", required: true },
      { key: "city", label: "Cidade", type: "text", required: true },
      { key: "state", label: "UF", type: "text", required: true },
      { key: "fee_cents", label: "Taxa", type: "money", required: true },
      {
        key: "active",
        label: "Ativo",
        type: "checkbox",
        required: false,
        default: true,
      },
    ],
    singleton: false,
    archive: false,
    search: "name",
  },
  faixas: {
    table: "delivery_distance_fees",
    title: "Faixas de distância",
    singular: "faixa",
    description: "A distância é calculada pela rota real.",
    read: "delivery.view",
    write: "delivery.edit",
    fields: [
      {
        key: "min_meters",
        label: "De (metros)",
        type: "number",
        required: true,
        default: 0,
      },
      {
        key: "max_meters",
        label: "Até (metros, exclusivo)",
        type: "number",
        required: true,
        default: 2000,
      },
      { key: "fee_cents", label: "Taxa", type: "money", required: true },
      {
        key: "active",
        label: "Ativa",
        type: "checkbox",
        required: false,
        default: true,
      },
    ],
    singleton: false,
    archive: false,
  },
  pagamentos: {
    table: "payment_methods",
    title: "Formas de pagamento",
    singular: "forma de pagamento",
    description: "Configure como seus clientes podem pagar os pedidos.",
    read: "payments.view",
    write: "payments.manage",
    fields: [
      { key: "name", label: "Nome", type: "text", required: true },
      {
        key: "type",
        label: "Tipo",
        type: "select",
        required: true,
        default: "custom_manual",
        options: [
          { value: "cash", label: "cash" },
          { value: "pix_manual", label: "pix_manual" },
          { value: "credit_on_delivery", label: "credit_on_delivery" },
          { value: "debit_on_delivery", label: "debit_on_delivery" },
          { value: "custom_manual", label: "custom_manual" },
        ],
      },
      {
        key: "description",
        label: "Instruções",
        type: "textarea",
        required: false,
      },
      {
        key: "pix_key",
        label: "Chave PIX manual",
        type: "text",
        required: false,
      },
      {
        key: "active",
        label: "Ativa",
        type: "checkbox",
        required: false,
        default: false,
      },
      {
        key: "requires_manual_confirmation",
        label: "Exigir confirmação manual",
        type: "checkbox",
        required: false,
        default: true,
      },
      {
        key: "sort_order",
        label: "Ordem",
        type: "number",
        required: false,
        default: 0,
      },
    ],
    singleton: false,
    archive: true,
    search: "name",
  },
  campanhas: {
    table: "campaigns",
    title: "Campanhas",
    singular: "campanha",
    description: "Ofertas com começo, fim e regras claras.",
    read: "campaigns.view",
    write: "campaigns.edit",
    fields: [
      { key: "name", label: "Nome", type: "text", required: true },
      {
        key: "description",
        label: "Descrição",
        type: "textarea",
        required: false,
      },
      {
        key: "starts_at",
        label: "Início",
        type: "datetime-local",
        required: true,
      },
      {
        key: "ends_at",
        label: "Fim (opcional)",
        type: "datetime-local",
        required: false,
      },
      {
        key: "active",
        label: "Ativa",
        type: "checkbox",
        required: false,
        default: true,
      },
    ],
    singleton: false,
    archive: true,
    search: "name",
  },
  cupons: {
    table: "coupons",
    title: "Cupons",
    singular: "cupom",
    description: "Descontos nos produtos, sem alterar a taxa de entrega.",
    read: "campaigns.view",
    write: "campaigns.edit",
    fields: [
      { key: "code", label: "Código", type: "text", required: true },
      {
        key: "campaign_id",
        label: "Campanha",
        type: "select",
        required: true,
        reference: "campanhas",
      },
      {
        key: "discount_type",
        label: "Tipo",
        type: "select",
        required: true,
        default: "percentage",
        options: [
          { value: "percentage", label: "percentage" },
          { value: "fixed", label: "fixed" },
        ],
      },
      {
        key: "discount_value",
        label: "Valor (percentual ou centavos)",
        type: "number",
        required: true,
        default: 10,
      },
      {
        key: "minimum_order_cents",
        label: "Subtotal mínimo",
        type: "money",
        required: false,
        default: 0,
      },
      {
        key: "total_usage_limit",
        label: "Limite total de usos",
        type: "number",
        required: false,
      },
      {
        key: "per_customer_usage_limit",
        label: "Limite por cliente",
        type: "number",
        required: false,
      },
      {
        key: "active",
        label: "Ativo",
        type: "checkbox",
        required: false,
        default: true,
      },
    ],
    singleton: false,
    archive: true,
    search: "code",
  },
  "cupom-categorias": {
    table: "coupon_categories",
    title: "Categorias elegíveis",
    singular: "restrição",
    description: "Sem restrições cadastradas, todos os produtos são elegíveis.",
    read: "campaigns.view",
    write: "campaigns.edit",
    fields: [
      {
        key: "coupon_id",
        label: "Cupom",
        type: "select",
        required: true,
        reference: "cupons",
      },
      {
        key: "category_id",
        label: "Categoria",
        type: "select",
        required: true,
        reference: "categorias",
      },
    ],
    singleton: false,
    archive: false,
  },
  "cupom-produtos": {
    table: "coupon_products",
    title: "Produtos elegíveis",
    singular: "restrição",
    description: "Combine categorias e produtos usando a união das seleções.",
    read: "campaigns.view",
    write: "campaigns.edit",
    fields: [
      {
        key: "coupon_id",
        label: "Cupom",
        type: "select",
        required: true,
        reference: "cupons",
      },
      {
        key: "product_id",
        label: "Produto",
        type: "select",
        required: true,
        reference: "produtos",
      },
    ],
    singleton: false,
    archive: false,
  },
  clientes: {
    table: "customers",
    title: "Clientes",
    singular: "cliente",
    description: "Conheça quem escolhe a sua pizzaria.",
    read: "customers.view",
    write: "customers.edit",
    fields: [
      { key: "name", label: "Nome", type: "text", required: true },
      { key: "phone", label: "WhatsApp", type: "text", required: true },
      { key: "email", label: "E-mail", type: "email", required: false },
      { key: "cpf", label: "CPF (opcional)", type: "text", required: false },
      { key: "birth_date", label: "Nascimento", type: "date", required: false },
      { key: "notes", label: "Observações", type: "textarea", required: false },
      {
        key: "active",
        label: "Ativo",
        type: "checkbox",
        required: false,
        default: true,
      },
      {
        key: "blocked",
        label: "Bloquear chatbot para este cliente",
        type: "checkbox",
        required: false,
      },
    ],
    singleton: false,
    archive: true,
    search: "name",
  },
  enderecos: {
    table: "customer_addresses",
    title: "Endereços",
    singular: "endereço",
    description: "Endereços de entrega dos seus clientes.",
    read: "customers.view",
    write: "customers.edit",
    fields: [
      {
        key: "customer_id",
        label: "Cliente",
        type: "select",
        required: true,
        reference: "clientes",
      },
      {
        key: "label",
        label: "Identificação",
        type: "text",
        required: true,
        default: "Casa",
      },
      { key: "postal_code", label: "CEP", type: "text", required: true },
      { key: "street", label: "Logradouro", type: "text", required: true },
      { key: "number", label: "Número", type: "text", required: true },
      {
        key: "complement",
        label: "Complemento",
        type: "text",
        required: false,
      },
      { key: "neighborhood", label: "Bairro", type: "text", required: true },
      { key: "city", label: "Cidade", type: "text", required: true },
      { key: "state", label: "UF", type: "text", required: true },
      {
        key: "is_default",
        label: "Endereço padrão",
        type: "checkbox",
        required: false,
      },
      {
        key: "active",
        label: "Ativo",
        type: "checkbox",
        required: false,
        default: true,
      },
    ],
    singleton: false,
    archive: true,
  },
  impressao: {
    table: "print_settings",
    title: "Impressão",
    singular: "configuração",
    description: "Comprovantes não fiscais de 58 ou 80 mm pelo navegador.",
    read: "printing.view",
    write: "printing.manage",
    fields: [
      {
        key: "paper_width",
        label: "Largura do papel",
        type: "select",
        required: true,
        default: "80",
        options: [
          { value: "58", label: "58" },
          { value: "80", label: "80" },
        ],
      },
      {
        key: "copies",
        label: "Vias",
        type: "number",
        required: true,
        default: 1,
      },
      {
        key: "show_store_info",
        label: "Mostrar dados da loja",
        type: "checkbox",
        required: false,
        default: true,
      },
      {
        key: "show_customer_phone",
        label: "Mostrar telefone do cliente",
        type: "checkbox",
        required: false,
        default: true,
      },
      {
        key: "show_address",
        label: "Mostrar endereço",
        type: "checkbox",
        required: false,
        default: true,
      },
      {
        key: "show_payment",
        label: "Mostrar pagamento",
        type: "checkbox",
        required: false,
        default: true,
      },
      {
        key: "show_observations",
        label: "Mostrar observações",
        type: "checkbox",
        required: false,
        default: true,
      },
      {
        key: "show_discount",
        label: "Mostrar desconto",
        type: "checkbox",
        required: false,
        default: true,
      },
      {
        key: "trigger_mode",
        label: "Quando imprimir",
        type: "select",
        required: true,
        default: "manual",
        options: [
          { value: "manual", label: "manual" },
          { value: "on_accept", label: "on_accept" },
        ],
      },
    ],
    singleton: true,
    archive: false,
  },
};
export function resourceSchema(resource: Resource) {
  const shape: Record<string, z.ZodType> = {};
  for (const field of resource.fields) {
    let rule: z.ZodType;
    if (field.reference) rule = z.uuid();
    else if (field.type === "checkbox") rule = z.boolean();
    else if (
      field.type === "number" ||
      field.type === "money" ||
      ["day_of_week", "max_flavors", "paper_width"].includes(field.key)
    )
      rule = z.number().int().min(0).max(100000000);
    else if (field.type === "select")
      rule = z.enum(
        field.options!.map((x) => x.value) as [string, ...string[]],
      );
    else if (field.type === "email")
      rule = z.union([z.email().max(254), z.literal("")]);
    else if (field.type === "date" || field.type === "datetime-local")
      rule = z
        .string()
        .max(40)
        .refine((v) => !Number.isNaN(Date.parse(v)), "Data inválida.");
    else if (field.type === "time")
      rule = z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d(:00)?$/, "Horário inválido.");
    else
      rule = z
        .string()
        .trim()
        .max(field.type === "textarea" ? 2000 : 254)
        .min(field.required ? 1 : 0);
    if (
      !field.required &&
      (field.type === "number" ||
        field.type === "money" ||
        field.type === "date" ||
        field.type === "datetime-local")
    )
      rule = rule.nullable();
    shape[field.key] = rule;
  }
  return z
    .object(shape)
    .strict()
    .superRefine((value, ctx) => {
      for (const [key, length] of [
        ["cpf", 11],
        ["cnpj", 14],
      ] as const)
        if (
          typeof value[key] === "string" &&
          !validDocument(value[key], length)
        )
          ctx.addIssue({
            code: "custom",
            message: `${key.toUpperCase()} inválido.`,
            path: [key],
          });
      if (resource.table === "customers") {
        try {
          normalizePhone(String(value.phone));
        } catch {
          ctx.addIssue({
            code: "custom",
            message: "Telefone inválido.",
            path: ["phone"],
          });
        }
      }
      if (
        resource.table === "store_settings" &&
        !value.delivery_enabled &&
        !value.pickup_enabled
      )
        ctx.addIssue({ code: "custom", message: "Ative entrega ou retirada." });
      if (
        resource.table === "store_settings" &&
        (Number(value.preparation_minutes) < 5 ||
          Number(value.preparation_minutes) > 300)
      )
        ctx.addIssue({
          code: "custom",
          message: "O preparo deve ficar entre 5 e 300 minutos.",
        });
    });
}
export const optionLabels: Record<string, string> = {
  automatic: "Automático",
  forced_open: "Forçar aberta",
  forced_closed: "Forçar fechada",
  highest: "Maior valor",
  proportional: "Proporcional",
  neighborhood: "Bairro",
  distance: "Distância pela rota",
  cash: "Dinheiro",
  pix_mercado_pago: "PIX Mercado Pago",
  pix_manual: "PIX manual",
  credit_on_delivery: "Cartão de crédito — maquininha",
  debit_on_delivery: "Cartão de débito — maquininha",
  custom_manual: "Personalizada",
  percentage: "Percentual",
  fixed: "Fixo",
  manual: "Manual",
  on_accept: "Ao aceitar pedido",
};
