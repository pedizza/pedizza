import "server-only";
import { z } from "zod";
import { transaction, one, rows, type DB } from "@/lib/db";
import { invariant, AppError } from "@/lib/errors";
import {
  normalizeSingularChoice,
  normalizeText,
} from "@/lib/domain/normalization";
import {
  calculateChange,
  formatChatCurrency,
  formatCurrency,
  parseCurrency,
} from "@/lib/domain/money";
import { getStoreOpenStatus, type BusinessHour } from "@/lib/domain/hours";
import {
  lookupCep,
  lookupAddress,
  quoteDelivery,
  addressSchema,
  deliveryOutOfRangeMessage,
  type Address,
} from "@/lib/integrations/geo";
import {
  interpretMessage,
  type MessageInterpretation,
  type NaturalOrder,
} from "@/lib/integrations/openai";
import { enqueue, notify } from "./events";
import { priceCart } from "./pricing";
import { finalizeCart } from "./orders";
import { orderLabels } from "@/lib/domain/orders";
import type { WhatsAppList } from "@/lib/integrations/evolution";
import { keycapNumber, mainMenuOption } from "@/lib/domain/whatsapp";
import { formatAddress, normalizeBrazilianState } from "@/lib/domain/address";
import {
  normalizeCatalogTerm,
  parseNaturalPizzaOrder,
} from "@/lib/domain/natural-order";
import {
  formatCategoryCatalog,
  type CatalogProduct,
} from "@/lib/domain/catalog";
type BotContext = {
  cartId?: string;
  address?: Partial<Address>;
  options?: { id: string; name: string; price_cents?: number }[];
  categoryId?: string;
  categoryName?: string;
  secondCategoryId?: string;
  secondCategoryName?: string;
  productIds?: string[];
  sizeId?: string | null;
  borderId?: string | null;
  quoteHash?: string;
  page?: number;
  previousStep?: string;
  pendingOrder?: NaturalOrder;
};
type Conversation = {
  id: string;
  tenant_id: string;
  customer_id: string;
  bot_paused: boolean;
  current_step: string;
  context: BotContext;
  version: number;
  bot_epoch: number;
};

function isChoice(input: string, ...choices: string[]) {
  return choices.some((choice) => normalizeText(choice) === input);
}

function joinBlocks(...blocks: Array<string | null | undefined | false>) {
  return blocks
    .filter((block): block is string => typeof block === "string" && !!block)
    .map((block) => block.trim())
    .join("\n\n");
}

function firstName(name?: string) {
  return (
    name
      ?.trim()
      .split(/\s+/)[0]
      ?.replace(/[*_~`]/g, "") || ""
  );
}

function namedMessage(name: string | undefined, message: string) {
  const namePart = firstName(name);
  return namePart ? `*${namePart}*, ${message}` : message;
}

function shouldInterpretMessage(step: string, text: string) {
  if (!text.trim() || /^\d+$/.test(normalizeText(text))) return false;
  const normalized = normalizeText(text);
  if (
    [
      "awaiting_category",
      "browsing_category",
      "awaiting_second_category",
    ].includes(step) &&
    normalized.split(" ").length <= 4 &&
    !/\b(quero|gostaria|pedido|pedir|meia|meio|borda|entrega|retirada)\b/.test(
      normalized,
    )
  )
    return false;
  const naturalLanguageIntent =
    /\b(quero|pedido|pedir|pizza|meia|meio|sabor|borda|entrega|retirada|status|tempo|demora|pronto|endere[cç]o|hor[aá]rio|pagamento|pagar|rob[oô]|intelig[eê]ncia|ia|atendente|humano|obrigad[oa]|oi|ol[aá])\b/i.test(
      text,
    );
  if (text.includes("?")) return true;
  if (naturalLanguageIntent) return true;
  if (
    [
      "awaiting_name",
      "awaiting_cep",
      "awaiting_number",
      "awaiting_street",
      "awaiting_neighborhood",
      "awaiting_complement",
      "awaiting_observation",
      "awaiting_coupon",
      "awaiting_change",
      "awaiting_email",
      "ai_awaiting_size",
      "ai_awaiting_border",
    ].includes(step)
  )
    return false;
  return false;
}

function localInterpretation(
  text: string,
  step: string,
): MessageInterpretation | null {
  const normalized = normalizeText(text);
  if (step === "main_menu" && mainMenuOption(normalized)) return null;
  if (
    /\b(status|acompanhar|rastrear|demora|tempo)\b/.test(normalized) &&
    /\b(pedido|pronto|chegar|entrega)\b/.test(normalized)
  )
    return { intent: "order_status", query: text, order: null };
  if (
    /\b(endereco|onde fica|localizacao)\b/.test(normalized) &&
    /\b(loja|pizzaria|retirada|entrega)\b/.test(normalized)
  )
    return { intent: "store_address", query: text, order: null };
  if (/\b(horario|aberto|abre|fecha|funcionamento)\b/.test(normalized))
    return { intent: "store_hours", query: text, order: null };
  if (/\b(pagamento|pagar|cartao|pix|dinheiro)\b/.test(normalized))
    return { intent: "payment_methods", query: text, order: null };
  if (
    /\b(como|pode|posso|funciona|pedir|escolher)\b/.test(normalized) &&
    /\b(dois sabores|meio a meio|meia a meia)\b/.test(normalized)
  )
    return { intent: "split_help", query: text, order: null };
  if (/\b(robo|inteligencia artificial|voce e ia)\b/.test(normalized))
    return { intent: "identity", query: text, order: null };
  if (
    /\b(vende|vendem|tem|possui|serve|oferece)\b/.test(normalized) &&
    !/\b(status|pedido|horario|pagamento)\b/.test(normalized)
  )
    return { intent: "search", query: text, order: null };
  if (
    /^(oi|ola|bom dia|boa tarde|boa noite)( tudo bem)?[!.? ]*$/.test(normalized)
  )
    return { intent: "small_talk", query: text, order: null };
  return null;
}

const prompts: Record<string, string> = {
  main_menu: "1️⃣ Fazer pedido\n2️⃣ Ver cardápio\n3️⃣ Acompanhar pedido",
  awaiting_name:
    "Perfeito, vamos começar a anotar seu pedido! 🍕\n\nQual seu nome, por gentileza? 😊",
  awaiting_service:
    "Como você prefere receber seu pedido? 🍕\n\n1️⃣ Entrega 🛵\n2️⃣ Retirada 🏪",
  awaiting_cep: "Informe seu CEP (8 números).",
  awaiting_number: "Qual é o número do endereço?",
  awaiting_street: "Qual é o nome da rua?",
  awaiting_neighborhood: "Qual é o bairro?",
  awaiting_complement:
    "Informe um complemento ou uma referência.\n\nDigite 0️⃣ para continuar sem complemento.",
  awaiting_saved_address:
    "Escolha um endereço salvo ou digite 0️⃣ para usar outro:",
  awaiting_address_confirmation:
    "Confirme o endereço e a taxa:\n\n1️⃣ Confirmar\n2️⃣ Corrigir CEP",
  delivery_out_of_range:
    "Como deseja continuar?\n\n1️⃣ Retirar na pizzaria\n2️⃣ Voltar ao menu",
  awaiting_category:
    "O que você gostaria de pedir? 😋\n\nEscolha uma categoria:",
  browsing_category: "*Escolha uma categoria para ver o cardápio:*",
  awaiting_product: "Escolha um produto:",
  awaiting_size: "Agora escolha o tamanho ideal para você 🍕",
  awaiting_split:
    "Quer aproveitar dois sabores na mesma pizza? 😋\n\n1️⃣ Sim\n2️⃣ Apenas este sabor",
  awaiting_second_category: "Escolha a categoria do segundo sabor:",
  awaiting_second_flavor: "Escolha o segundo sabor para o mesmo tamanho:",
  awaiting_border:
    "Que tal deixar seu pedido ainda mais gostoso? 😍\n\nEscolha uma borda ou digite 0️⃣ para continuar sem borda:",
  awaiting_observation:
    "Alguma observação?\n\nDigite 0️⃣ para continuar sem observação.",
  cart_menu:
    "1️⃣ Adicionar mais itens\n2️⃣ Finalizar\n3️⃣ Aplicar cupom\n4️⃣ Remover item",
  awaiting_remove: "Digite o número ou o nome do item para remover.",
  awaiting_coupon:
    "Digite o código do cupom.\n\nDigite 0️⃣ para remover o cupom.",
  awaiting_payment:
    "Estamos quase terminando! 🙌\n\nEscolha a forma de pagamento:",
  awaiting_change:
    "Vai precisar de troco? 💵\n\nInforme o valor (ex.: 100,00) ou digite 0️⃣ para continuar sem troco.",
  awaiting_final_confirmation:
    "1️⃣ CONFIRMAR PEDIDO\n2️⃣ Adicionar mais itens\n3️⃣ Trocar meu pedido",
};

function cartMenuMessage(summary: string, customerName?: string) {
  return joinBlocks(
    namedMessage(customerName, "seu pedido ficou assim até agora! 🍕"),
    summary,
    prompts.cart_menu,
  );
}

function mainMenu(
  store?: { display_name: string; welcome_message: string },
  returningCustomer?: { name: string; has_order: boolean },
) {
  const storeName = store?.display_name.trim() || "nossa pizzaria";
  const customerFirstName = firstName(returningCustomer?.name);
  const returningGreeting =
    returningCustomer?.has_order && customerFirstName
      ? `Olá! Seja bem-vindo (a) de volta *${customerFirstName}* 🍕`
      : undefined;
  const greeting =
    returningGreeting ||
    store?.welcome_message.trim() ||
    `Olá! Seja bem-vindo (a) ${storeName} 🍕`;
  const listTitle = returningGreeting
    ? `Olá! Seja bem-vindo (a) de volta ${customerFirstName} 🍕`
    : `Olá! Seja bem-vindo (a) ${storeName} 🍕`;
  return {
    text: `${greeting}\n\nComo podemos ajudar?\n\n${prompts.main_menu}`,
    list: {
      title: listTitle.slice(0, 60),
      description: "Como podemos ajudar?",
      buttonText: "Escolha aqui",
      footerText: "Selecione uma opção para continuar.",
      sections: [
        {
          title: "Opções",
          rows: [
            {
              title: "Fazer pedido",
              description: "Monte seu pedido",
              rowId: "1",
            },
            {
              title: "Ver cardápio",
              description: "Confira nossos produtos",
              rowId: "2",
            },
            {
              title: "Acompanhar pedido",
              description: "Veja o status do seu pedido",
              rowId: "3",
            },
          ],
        },
      ],
    } satisfies WhatsAppList,
  };
}
async function cartSummary(db: DB, tenant: string, cart: string) {
  const q = await priceCart(db, tenant, cart);
  const items = q.items.map(
    (item, index) =>
      `${keycapNumber(index + 1)} ${item.quantity}x ${item.size_name_snapshot || ""} ${item.name_snapshot}${item.border_name_snapshot ? " · " + item.border_name_snapshot : ""} — ${formatChatCurrency(item.unit_price_cents * item.quantity)}${item.observation ? "\nObservação do Pedido: " + item.observation : ""}`,
  );
  return {
    quote: q,
    text: joinBlocks(
      items.join("\n\n"),
      [
        `Subtotal: ${formatChatCurrency(q.subtotal_cents)}`,
        q.discount_cents > 0
          ? `Desconto: ${formatChatCurrency(q.discount_cents)}`
          : "Desconto: Sem desconto aplicado",
        `Entrega: ${formatChatCurrency(q.delivery_fee_cents)}`,
        `Total: ${formatChatCurrency(q.total_cents)}`,
      ].join("\n"),
    ),
  };
}
export async function processBotMessage(
  tenant: string,
  conversationId: string,
  messageId: string,
  text: string,
) {
  const initial = await transaction((db) =>
    one<Conversation>(
      db,
      "select id,tenant_id,customer_id,bot_paused,current_step,context,version,bot_epoch from public.conversations where tenant_id=$1 and id=$2",
      [tenant, conversationId],
    ),
  );
  if (!initial) return;
  const normalized = normalizeText(text);
  const locallyParsedOrder = parseNaturalPizzaOrder(text);
  const quickInterpretation = localInterpretation(text, initial.current_step);
  const interpretation =
    (locallyParsedOrder && !locallyParsedOrder.address_query
      ? ({
          intent: "order",
          query: text,
          order: locallyParsedOrder,
        } satisfies MessageInterpretation)
      : quickInterpretation) ||
    (shouldInterpretMessage(initial.current_step, text)
      ? await interpretMessage(text, initial.current_step)
      : null);
  if (
    interpretation &&
    interpretation.intent !== "order" &&
    normalized.includes("endereco") &&
    ["entrega", "loja", "pizzaria", "retirada"].some((word) =>
      normalized.includes(word),
    )
  )
    interpretation.intent = "store_address";
  if (
    interpretation &&
    (normalized.includes("meio a meio") ||
      normalized.includes("meia a meia")) &&
    !interpretation.order?.flavors.length
  )
    interpretation.intent = "split_help";
  if (
    interpretation &&
    ["robo", "inteligencia artificial", "voce e ia"].some((word) =>
      normalized.includes(word),
    )
  )
    interpretation.intent = "identity";
  const extractedOrder = interpretation?.order;
  const naturalOrder = extractedOrder
    ? {
        ...extractedOrder,
        category:
          extractedOrder.category ||
          (initial.current_step === "awaiting_product" ||
          initial.context.previousStep === "awaiting_product"
            ? initial.context.categoryName || null
            : null) ||
          (normalized.includes("broto")
            ? "broto"
            : normalized.includes("pizza")
              ? "pizza"
              : null),
        size:
          extractedOrder.size ||
          (normalized.includes("grande")
            ? "Grande"
            : normalized.includes("broto")
              ? "Broto"
              : null),
        service:
          extractedOrder.service ||
          (normalized.includes("entrega")
            ? ("delivery" as const)
            : normalized.includes("retirada") || normalized.includes("retirar")
              ? ("pickup" as const)
              : null),
      }
    : initial.context.pendingOrder;
  let savedAddress: Address | undefined;
  let naturalAddress: Address | undefined;
  let cep: Awaited<ReturnType<typeof lookupCep>> | undefined,
    delivery: Awaited<ReturnType<typeof quoteDelivery>> | undefined,
    externalError: string | undefined,
    externalErrorCode: string | undefined;
  try {
    if (initial.current_step === "awaiting_saved_address") {
      const numeric = Number(normalized);
      const choice =
        Number.isInteger(numeric) && numeric > 0
          ? initial.context.options?.[numeric - 1]
          : initial.context.options?.find(
              (option) => normalizeText(option.name) === normalized,
            );
      if (choice) {
        const address = await transaction((db) =>
          one(
            db,
            "select postal_code,street,number,complement,neighborhood,city,state from public.customer_addresses where tenant_id=$1 and customer_id=$2 and id=$3 and active and archived_at is null",
            [tenant, initial.customer_id, choice.id],
          ),
        );
        if (address) {
          savedAddress = addressSchema.parse(address);
          delivery = await quoteDelivery(tenant, savedAddress);
        }
      }
    }
    if (
      initial.current_step === "awaiting_cep" &&
      /^\d{8}$/.test(text.replace(/\D/g, ""))
    )
      cep = await lookupCep(tenant, text.replace(/\D/g, ""));
    if (
      initial.current_step === "awaiting_number" &&
      text.trim().length <= 20 &&
      initial.context.address
    )
      delivery = await quoteDelivery(
        tenant,
        addressSchema.parse({
          ...initial.context.address,
          number: text.trim(),
        }),
      );
    if (
      initial.current_step === "awaiting_final_confirmation" &&
      isChoice(normalized, "1", "confirmar", "confirmar pedido") &&
      initial.context.address
    )
      delivery = await quoteDelivery(
        tenant,
        addressSchema.parse(initial.context.address),
      );
    if (
      naturalOrder?.service === "delivery" &&
      (naturalOrder.address_query || naturalOrder.number)
    ) {
      if (naturalOrder.postal_code) {
        const naturalCep = await lookupCep(
          tenant,
          naturalOrder.postal_code.replace(/\D/g, ""),
        );
        naturalAddress = addressSchema.parse({
          postal_code: naturalCep.cep.replace(/\D/g, ""),
          street: naturalOrder.street || naturalCep.logradouro,
          number: naturalOrder.number,
          complement: naturalOrder.complement || "",
          neighborhood: naturalOrder.neighborhood || naturalCep.bairro,
          city: naturalOrder.city || naturalCep.localidade,
          state:
            normalizeBrazilianState(naturalOrder.state) ||
            naturalCep.uf.toUpperCase(),
        });
      } else if (naturalOrder.address_query || naturalOrder.street) {
        naturalAddress = await lookupAddress(tenant, {
          query:
            naturalOrder.street && naturalOrder.number
              ? undefined
              : naturalOrder.address_query || undefined,
          street: naturalOrder.street || undefined,
          number: naturalOrder.number || undefined,
          complement: naturalOrder.complement || "",
          neighborhood: naturalOrder.neighborhood || undefined,
          city: naturalOrder.city || undefined,
          state: normalizeBrazilianState(naturalOrder.state),
        });
      }
      if (naturalAddress)
        delivery = await quoteDelivery(tenant, naturalAddress);
    }
  } catch (e) {
    externalErrorCode = e instanceof AppError ? e.code : undefined;
    externalError =
      e instanceof AppError
        ? e.message
        : "Não conseguimos validar o endereço. Confira os dados e tente novamente.";
  }
  await transaction(async (db) => {
    const c = await one<Conversation>(
      db,
      "select id,tenant_id,customer_id,bot_paused,current_step,context,version,bot_epoch from public.conversations where tenant_id=$1 and id=$2 for update",
      [tenant, conversationId],
    );
    invariant(c, "Conversa indisponível.");
    const customerId = c.customer_id;
    if (
      await one(
        db,
        "select id from public.conversation_messages where tenant_id=$1 and id=$2 and processed_at is not null",
        [tenant, messageId],
      )
    )
      return;
    invariant(
      c.version === initial.version,
      "Estado atualizado; tentar novamente.",
      409,
    );
    const customer = await one<{
      name: string;
      blocked: boolean;
      has_order: boolean;
    }>(
      db,
      "select c.name,c.blocked,exists(select 1 from public.orders o where o.tenant_id=c.tenant_id and o.customer_id=c.id) has_order from public.customers c where c.tenant_id=$1 and c.id=$2",
      [tenant, c.customer_id],
    );
    const access = await one<{ active: boolean }>(
      db,
      "select private.subscription_active($1) active",
      [tenant],
    );
    const store = await one<{
      display_name: string;
      timezone: string;
      status_mode: string;
      welcome_message: string;
      closed_message: string;
      delivery_enabled: boolean;
      pickup_enabled: boolean;
      postal_code: string;
      street: string;
      number: string;
      complement: string;
      neighborhood: string;
      city: string;
      state: string;
    }>(
      db,
      "select display_name,timezone,status_mode,welcome_message,closed_message,delivery_enabled,pickup_enabled,postal_code,street,number,complement,neighborhood,city,state from public.store_settings where tenant_id=$1",
      [tenant],
    );
    const menu = mainMenu(store || undefined, customer || undefined);
    if (normalized === "reiniciar" && !customer?.blocked && access?.active) {
      await db.query(
        "update public.carts set status='cancelled' where tenant_id=$1 and conversation_id=$2 and status='active'",
        [tenant, c.id],
      );
      await db.query(
        "update public.conversations set status='bot',bot_paused=false,bot_epoch=bot_epoch+1,current_step='main_menu',context='{}'::jsonb,version=version+1,assigned_user_id=null,archived_at=null where tenant_id=$1 and id=$2",
        [tenant, c.id],
      );
      await db.query(
        "update public.conversation_messages set processed_at=now() where tenant_id=$1 and id=$2",
        [tenant, messageId],
      );
      await enqueue(db, tenant, "message", "bot:" + messageId, {
        conversationId: c.id,
        sender: "bot",
        text: "Fluxo reiniciado.\n\n" + menu.text,
        list: menu.list,
        epoch: c.bot_epoch + 1,
      });
      return;
    }
    if (c.bot_paused || customer?.blocked || !access?.active) {
      await db.query(
        "update public.conversation_messages set processed_at=now() where tenant_id=$1 and id=$2",
        [tenant, messageId],
      );
      return;
    }
    const context = c.context;
    let step = c.current_step;
    let reply = "";
    let followUp = "";
    let handoff = false;
    let replyList: WhatsAppList | undefined;
    const hours = await rows<BusinessHour>(
      db,
      "select day_of_week,start_time::text,end_time::text from public.store_business_hours where tenant_id=$1",
      [tenant],
    );
    const isOpen =
      !!store &&
      getStoreOpenStatus(hours, store.timezone, store.status_mode).isOpen;
    async function options(kind: string) {
      let sql = "";
      const params: unknown[] = [tenant];
      context.page = context.page || 0;
      if (kind === "category")
        sql =
          "select id,name from public.menu_categories where tenant_id=$1 and active and archived_at is null order by sort_order,id";
      if (kind === "product") {
        sql =
          "select id,name from public.menu_items where tenant_id=$1 and category_id=$2 and active and available and archived_at is null order by sort_order,id limit 8 offset $3";
        params.push(context.categoryId);
      }
      if (kind === "second") {
        sql =
          "select i.id,i.name from public.menu_items i join public.menu_item_prices p on p.tenant_id=i.tenant_id and p.item_id=i.id and p.active join public.menu_sizes s on s.tenant_id=p.tenant_id and s.id=p.size_id and s.active and s.archived_at is null where i.tenant_id=$1 and i.category_id=$2 and lower(s.name)=lower((select name from public.menu_sizes where tenant_id=$1 and id=$3)) and i.active and i.available and i.archived_at is null order by i.sort_order,i.id";
        params.push(context.secondCategoryId, context.sizeId);
      }
      if (kind === "second_category") {
        sql =
          "select distinct c.id,c.name,c.sort_order from public.menu_categories c join public.menu_sizes s on s.tenant_id=c.tenant_id and s.category_id=c.id and s.active and s.archived_at is null join public.menu_item_prices p on p.tenant_id=s.tenant_id and p.size_id=s.id and p.active join public.menu_items i on i.tenant_id=p.tenant_id and i.id=p.item_id and i.category_id=c.id and i.active and i.available and i.archived_at is null where c.tenant_id=$1 and c.active and c.allow_split and c.archived_at is null and lower(s.name)=lower((select name from public.menu_sizes where tenant_id=$1 and id=$2)) and c.split_pricing=(select split_pricing from public.menu_categories where tenant_id=$1 and id=$3) order by c.sort_order,c.id";
        params.push(context.sizeId, context.categoryId);
      }
      if (kind === "size") {
        sql =
          "select s.id,s.name from public.menu_sizes s join public.menu_item_prices p on p.tenant_id=s.tenant_id and p.size_id=s.id where s.tenant_id=$1 and p.item_id=$2 and p.active and s.active and s.archived_at is null order by s.sort_order,s.id limit 8 offset $3";
        params.push(context.productIds?.[0]);
      }
      if (kind === "border") {
        sql =
          "select b.id,g.name || ' — ' || b.name name,coalesce(bp.price_cents,b.base_price_cents) price_cents from public.menu_borders b join public.menu_border_groups g on g.tenant_id=b.tenant_id and g.id=b.group_id join public.menu_border_group_categories c on c.tenant_id=g.tenant_id and c.group_id=g.id left join public.menu_border_prices bp on bp.tenant_id=b.tenant_id and bp.border_id=b.id and bp.size_id=$3 where b.tenant_id=$1 and c.category_id=$2 and b.active and g.active and b.archived_at is null and g.archived_at is null order by g.sort_order,g.name,b.sort_order,b.name";
        params.push(context.categoryId, context.sizeId || null);
      }
      if (kind === "payment")
        sql =
          "select id,name from public.payment_methods where tenant_id=$1 and active and type<>'pix_mercado_pago' and archived_at is null order by sort_order,id limit 8 offset $2";
      if (!["category", "second_category", "second", "border"].includes(kind))
        params.push(context.page * 8);
      context.options = await rows<{
        id: string;
        name: string;
        price_cents?: number;
      }>(db, sql, params);
      return (
        context.options
          .map((option, index) =>
            kind === "border"
              ? `${keycapNumber(index + 1)} ${option.name}\n*${formatChatCurrency(option.price_cents || 0)}*`
              : `${keycapNumber(index + 1)} ${option.name}`,
          )
          .join(kind === "border" ? "\n\n" : "\n") +
        (["size", "payment"].includes(kind) && context.options.length === 8
          ? "\n\nDigite MAIS para ver outras opções."
          : "")
      );
    }
    async function categoryCatalog(footer: string) {
      const products = await rows<CatalogProduct>(
        db,
        `select i.id,i.name,i.description,
          coalesce(min(p.price_cents) filter(where p.active and s.active and s.archived_at is null),i.base_price_cents) price_cents,
          count(distinct p.price_cents) filter(where p.active and s.active and s.archived_at is null)::int price_count
        from public.menu_items i
        left join public.menu_item_prices p on p.tenant_id=i.tenant_id and p.item_id=i.id
        left join public.menu_sizes s on s.tenant_id=p.tenant_id and s.id=p.size_id
        where i.tenant_id=$1 and i.category_id=$2 and i.active and i.available and i.archived_at is null
        group by i.id,i.name,i.description,i.base_price_cents,i.sort_order
        order by i.sort_order,i.name,i.id`,
        [tenant, context.categoryId],
      );
      context.options = products.map(({ id, name }) => ({ id, name }));
      return products.length
        ? formatCategoryCatalog(
            `Confira nossas opções de ${context.categoryName || "cardápio"} 😋`,
            products,
            footer,
          )
        : "Nenhum produto disponível nesta categoria.";
    }
    async function secondFlavorCatalog(footer: string) {
      const products = await rows<CatalogProduct>(
        db,
        `select i.id,i.name,i.description,min(p.price_cents) price_cents,
          count(distinct p.price_cents)::int price_count
        from public.menu_items i
        join public.menu_item_prices p on p.tenant_id=i.tenant_id and p.item_id=i.id and p.active
        join public.menu_sizes s on s.tenant_id=p.tenant_id and s.id=p.size_id and s.active and s.archived_at is null
        where i.tenant_id=$1 and i.category_id=$2 and i.active and i.available and i.archived_at is null
          and lower(s.name)=lower((select name from public.menu_sizes where tenant_id=$1 and id=$3))
        group by i.id,i.name,i.description,i.sort_order
        order by i.sort_order,i.name,i.id`,
        [tenant, context.secondCategoryId, context.sizeId],
      );
      context.options = products.map(({ id, name }) => ({ id, name }));
      return products.length
        ? formatCategoryCatalog(
            context.secondCategoryName || "Segundo sabor",
            products,
            footer,
          )
        : "Nenhum sabor disponível nesta categoria para o tamanho escolhido.";
    }
    const selected = () => {
      const numeric = Number(normalized);
      if (Number.isInteger(numeric) && numeric > 0)
        return context.options?.[numeric - 1];
      const exact = context.options?.find(
        (option) => normalizeText(option.name) === normalized,
      );
      if (exact) return exact;
      if (
        ![
          "awaiting_category",
          "browsing_category",
          "awaiting_second_category",
        ].includes(step)
      )
        return undefined;
      const singularInput = normalizeSingularChoice(normalized);
      return context.options?.find(
        (option) => normalizeSingularChoice(option.name) === singularInput,
      );
    };
    async function requestDeliveryAddress() {
      const addresses = await rows<{ id: string; name: string }>(
        db,
        `select id,
          'Endereço: ' || street || ', nº ' || number ||
          case when nullif(complement, '') is not null then ' - ' || complement else '' end ||
          ' - ' || neighborhood || ' - ' || city || ' - ' || state name
         from public.customer_addresses
         where tenant_id=$1 and customer_id=$2 and active and archived_at is null
         order by is_default desc,created_at desc limit 8`,
        [tenant, customerId],
      );
      context.options = addresses;
      step = addresses.length ? "awaiting_saved_address" : "awaiting_cep";
      reply = joinBlocks(
        prompts[step],
        addresses.length
          ? addresses
              .map(
                (address, index) =>
                  `${keycapNumber(index + 1)} ${address.name}`,
              )
              .join("\n")
          : undefined,
      );
    }
    function pickupAddressMessage() {
      if (!store) return undefined;
      const address = formatAddress(store);
      if (!address) return undefined;
      const postalCode = store.postal_code.replace(/\D/g, "");
      const formattedPostalCode = /^\d{8}$/.test(postalCode)
        ? postalCode.replace(/^(\d{5})(\d{3})$/, "$1-$2")
        : store.postal_code;
      return joinBlocks(
        "📍 *Endereço para retirada:*",
        address + (formattedPostalCode ? `\nCEP: ${formattedPostalCode}` : ""),
      );
    }
    async function continueAfterAddress(introduction?: string) {
      const cart = await one<{ has_items: boolean }>(
        db,
        "select exists(select 1 from public.cart_items where tenant_id=$1 and cart_id=$2) has_items",
        [tenant, context.cartId],
      );
      context.page = 0;
      if (cart?.has_items) {
        step = "awaiting_payment";
        reply = joinBlocks(
          introduction,
          prompts[step],
          await options("payment"),
        );
      } else {
        step = "awaiting_category";
        reply = joinBlocks(prompts[step], await options("category"));
      }
    }
    async function buildFinalConfirmation(summary: string, totalCents: number) {
      const cart = await one<{
        service_type: string;
        payment_name: string;
        payment_type: string;
        change_for_cents: number | null;
      }>(
        db,
        `select c.service_type,pm.name payment_name,pm.type payment_type,c.change_for_cents
         from public.carts c
         join public.payment_methods pm on pm.tenant_id=c.tenant_id and pm.id=c.payment_method_id
         where c.tenant_id=$1 and c.id=$2 and c.status='active'`,
        [tenant, context.cartId],
      );
      invariant(cart, "Carrinho indisponível.");
      const payment =
        `Pagamento: ${cart.payment_name}` +
        (cart.payment_type === "cash"
          ? cart.change_for_cents
            ? ` · Troco para ${formatCurrency(cart.change_for_cents)} · Troco a devolver: ${formatCurrency(calculateChange(cart.change_for_cents, totalCents))}`
            : " · Sem troco"
          : "");
      const fulfillment =
        cart.service_type === "delivery" && context.address
          ? `Endereço: ${formatAddress(context.address)}`
          : "Retirada no local";
      return joinBlocks(
        namedMessage(
          customer?.name,
          "Confirme se o pedido está correto, por gentileza? 😊",
        ),
        [summary, payment, fulfillment].join("\n"),
        prompts.awaiting_final_confirmation,
      );
    }

    async function currentStepMessage() {
      if (step === "main_menu")
        return joinBlocks("Como podemos ajudar?", prompts.main_menu);
      if (step === "awaiting_product")
        return categoryCatalog("Responda com o número ou o nome do produto.");
      if (step === "awaiting_second_flavor")
        return secondFlavorCatalog(
          "Responda com o número ou o nome do segundo sabor.",
        );
      if (step === "cart_menu" && context.cartId) {
        const summary = await cartSummary(db, tenant, context.cartId);
        return cartMenuMessage(summary.text, customer?.name);
      }
      if (step === "awaiting_final_confirmation" && context.cartId) {
        const summary = await cartSummary(db, tenant, context.cartId);
        return buildFinalConfirmation(summary.text, summary.quote.total_cents);
      }
      if (
        ["ai_awaiting_size", "ai_awaiting_border"].includes(step) &&
        context.options?.length
      )
        return joinBlocks(
          step === "ai_awaiting_size"
            ? "Escolha o tamanho para continuarmos 🍕"
            : "Escolha a borda para continuarmos 😋",
          context.options
            .map((item, index) => `${keycapNumber(index + 1)} ${item.name}`)
            .join("\n"),
        );
      if (step === "awaiting_saved_address" && context.options?.length)
        return joinBlocks(
          prompts[step],
          context.options
            .map((item, index) => `${keycapNumber(index + 1)} ${item.name}`)
            .join("\n"),
        );
      const kind = (
        {
          awaiting_category: "category",
          browsing_category: "category",
          awaiting_second_category: "second_category",
          awaiting_size: "size",
          awaiting_border: "border",
          awaiting_payment: "payment",
        } as Record<string, string>
      )[step];
      return joinBlocks(
        prompts[step] || "Vamos continuar de onde paramos 😊",
        kind ? await options(kind) : undefined,
      );
    }

    async function latestOrderMessage() {
      const order = await one<{
        order_number: number;
        order_status: string;
        preparation_minutes: number | null;
        accepted_at: Date | null;
      }>(
        db,
        `select order_number,order_status,preparation_minutes,accepted_at
         from public.orders where tenant_id=$1 and customer_id=$2
         order by created_at desc limit 1`,
        [tenant, c!.customer_id],
      );
      if (!order) return "Você ainda não tem pedidos nesta pizzaria. 😊";
      let detail = `Seu pedido #${order.order_number} está: *${orderLabels[order.order_status]}*.`;
      if (order.order_status === "new")
        detail += " A pizzaria ainda precisa confirmar o recebimento.";
      if (
        ["accepted", "preparing"].includes(order.order_status) &&
        order.accepted_at &&
        order.preparation_minutes
      ) {
        const expected =
          order.accepted_at.getTime() + order.preparation_minutes * 60_000;
        const remaining = Math.ceil((expected - Date.now()) / 60_000);
        detail +=
          remaining > 0
            ? ` A estimativa atual é de aproximadamente ${remaining} minuto${remaining === 1 ? "" : "s"}.`
            : " A estimativa inicial já foi atingida; acompanhe a próxima atualização da pizzaria.";
      }
      return detail + " 🍕";
    }

    async function splitHelpMessage() {
      const rules = await rows<{ split_pricing: string }>(
        db,
        "select distinct split_pricing from public.menu_categories where tenant_id=$1 and active and allow_split and archived_at is null",
        [tenant],
      );
      if (!rules.length)
        return "No momento, o cardápio desta pizzaria não possui categorias com dois sabores.";
      const pricing =
        rules.length === 1
          ? rules[0].split_pricing === "highest"
            ? "O valor considerado é o do sabor de maior preço."
            : "O valor é calculado proporcionalmente entre os sabores."
          : "O valor segue a regra configurada na categoria escolhida.";
      return `Você pode pedir dois sabores meia a meia 🍕 Escolha o primeiro sabor e o tamanho; depois selecione o segundo sabor disponível no mesmo tamanho. ${pricing}`;
    }

    function businessHoursMessage() {
      const days = [
        "Domingo",
        "Segunda-feira",
        "Terça-feira",
        "Quarta-feira",
        "Quinta-feira",
        "Sexta-feira",
        "Sábado",
      ];
      const schedule = days.map((day, index) => {
        const periods = hours.filter((hour) => hour.day_of_week === index);
        return periods.length
          ? `${day}: ${periods
              .map(
                (period) =>
                  `${period.start_time.slice(0, 5)} às ${period.end_time.slice(0, 5)}`,
              )
              .join(" e ")}`
          : `${day}: Fechado`;
      });
      return joinBlocks(
        isOpen ? "Estamos abertos agora! 🍕" : "Estamos fechados agora.",
        `*Horários de atendimento:*\n${schedule.join("\n")}`,
      );
    }

    async function paymentMethodsMessage() {
      const methods = await rows<{ name: string }>(
        db,
        "select name from public.payment_methods where tenant_id=$1 and active and type<>'pix_mercado_pago' and archived_at is null order by sort_order,id",
        [tenant],
      );
      return methods.length
        ? `Aceitamos estas formas de pagamento: ${methods.map((method) => method.name).join(", ")}. 💳`
        : "As formas de pagamento ainda não foram cadastradas. Posso chamar a equipe para ajudar.";
    }

    type NaturalProduct = {
      id: string;
      name: string;
      description: string;
      categoryId: string;
      categoryName: string;
      allowSplit: boolean;
      splitPricing: string;
      basePrice: number | null;
      sizes: { id: string; name: string }[];
    };

    async function naturalProducts() {
      const result = await rows<{
        id: string;
        name: string;
        description: string;
        category_id: string;
        category_name: string;
        allow_split: boolean;
        split_pricing: string;
        base_price_cents: number | null;
        size_id: string | null;
        size_name: string | null;
      }>(
        db,
        `select i.id,i.name,i.description,i.category_id,c.name category_name,
          c.allow_split,c.split_pricing,i.base_price_cents,s.id size_id,s.name size_name
         from public.menu_items i
         join public.menu_categories c on c.tenant_id=i.tenant_id and c.id=i.category_id
         left join public.menu_item_prices p on p.tenant_id=i.tenant_id and p.item_id=i.id and p.active
         left join public.menu_sizes s on s.tenant_id=p.tenant_id and s.id=p.size_id and s.active and s.archived_at is null
         where i.tenant_id=$1 and i.active and i.available and i.archived_at is null
           and c.active and c.archived_at is null
         order by c.sort_order,i.sort_order,i.id,s.sort_order,s.id`,
        [tenant],
      );
      const grouped = new Map<string, NaturalProduct>();
      for (const row of result) {
        const product = grouped.get(row.id) || {
          id: row.id,
          name: row.name,
          description: row.description,
          categoryId: row.category_id,
          categoryName: row.category_name,
          allowSplit: row.allow_split,
          splitPricing: row.split_pricing,
          basePrice: row.base_price_cents,
          sizes: [],
        };
        if (row.size_id && row.size_name)
          product.sizes.push({ id: row.size_id, name: row.size_name });
        grouped.set(row.id, product);
      }
      return [...grouped.values()];
    }

    function naturalMatches(
      products: NaturalProduct[],
      flavor: string,
      category?: string | null,
      size?: string | null,
    ) {
      const wanted = normalizeCatalogTerm(flavor);
      const exactMatches = products.filter(
        (product) => normalizeCatalogTerm(product.name) === wanted,
      );
      let matches = (exactMatches.length ? exactMatches : products).filter(
        (product) => {
          const name = normalizeCatalogTerm(product.name);
          const full = normalizeCatalogTerm(
            `${product.name} ${product.description}`,
          );
          return name === wanted || full === wanted || full.includes(wanted);
        },
      );
      const categoryName = normalizeText(category || "");
      const sizeName = normalizeText(size || "");
      if (categoryName) {
        matches = matches.filter((product) => {
          const candidate = normalizeText(product.categoryName);
          if (sizeName === "broto") return candidate.includes("broto");
          if (sizeName === "grande" && categoryName.includes("broto"))
            return candidate.includes("pizza") && !candidate.includes("broto");
          if (categoryName.includes("broto"))
            return candidate.includes("broto");
          if (categoryName.includes("pizza"))
            return candidate.includes("pizza") && !candidate.includes("broto");
          return (
            candidate.includes(categoryName) || categoryName.includes(candidate)
          );
        });
      }
      if (sizeName)
        matches = matches.filter(
          (product) =>
            !product.sizes.length ||
            product.sizes.some((item) => normalizeText(item.name) === sizeName),
        );
      return matches;
    }

    async function applyNaturalOrder(draft: NaturalOrder) {
      if (!isOpen) {
        reply =
          store?.closed_message ||
          "Estamos fechados neste momento. Você pode consultar o cardápio ou falar com a equipe.";
        return;
      }
      if (!customer?.name) {
        const suppliedName = draft.customer_name?.trim();
        if (suppliedName && suppliedName.length >= 2) {
          await db.query(
            "update public.customers set name=$3 where tenant_id=$1 and id=$2",
            [tenant, c!.customer_id, suppliedName],
          );
          customer!.name = suppliedName;
        } else {
          context.pendingOrder = draft;
          step = "awaiting_name";
          reply = prompts[step];
          return;
        }
      }
      if (!draft.flavors.length) {
        context.pendingOrder = undefined;
        context.page = 0;
        step = "awaiting_category";
        reply = joinBlocks(prompts[step], await options("category"));
        return;
      }
      const products = await naturalProducts();
      if (!draft.size) {
        const requestedFamily = normalizeText(draft.category || "")
          .replace(/\b(?:pizza|pizzas|broto|brotos)\b/g, "")
          .trim();
        const sizeSets = draft.flavors.map((flavor) => {
          const variants = naturalMatches(products, flavor).filter(
            (product) => {
              const category = normalizeText(product.categoryName);
              if (!category.includes("pizza") && !category.includes("broto"))
                return false;
              if (!requestedFamily) return true;
              const family = category
                .replace(/\b(?:pizza|pizzas|broto|brotos)\b/g, "")
                .trim();
              return family === requestedFamily;
            },
          );
          return new Set(
            variants.flatMap((product) =>
              product.sizes.map((size) => size.name),
            ),
          );
        });
        const availableSizes = [...(sizeSets[0] || new Set<string>())].filter(
          (size) => sizeSets.slice(1).every((candidate) => candidate.has(size)),
        );
        if (availableSizes.length > 1) {
          context.pendingOrder = draft;
          context.options = availableSizes
            .sort((a, b) => {
              const order = (value: string) =>
                normalizeText(value) === "grande"
                  ? 0
                  : normalizeText(value) === "broto"
                    ? 1
                    : 2;
              return order(a) - order(b) || a.localeCompare(b, "pt-BR");
            })
            .map((name) => ({ id: name, name }));
          step = "ai_awaiting_size";
          reply = joinBlocks(
            "Qual tamanho você prefere para essa pizza? 🍕",
            context.options
              .map((item, index) => `${keycapNumber(index + 1)} ${item.name}`)
              .join("\n"),
          );
          return;
        }
        if (availableSizes.length === 1) draft.size = availableSizes[0];
      }
      const selectedProducts: NaturalProduct[] = [];
      for (const flavor of draft.flavors) {
        const matches = naturalMatches(
          products,
          flavor,
          draft.category,
          draft.size,
        );
        if (matches.length !== 1) {
          context.pendingOrder = undefined;
          context.page = 0;
          step = "awaiting_category";
          reply = joinBlocks(
            matches.length
              ? `Encontrei mais de uma opção para *${flavor}*. Vamos escolher pelo cardápio para eu anotar certinho 😊`
              : `Não encontrei *${flavor}* no cardápio disponível. Vamos conferir as opções 😊`,
            prompts[step],
            await options("category"),
          );
          return;
        }
        selectedProducts.push(matches[0]);
      }
      const first = selectedProducts[0];
      if (
        selectedProducts.length === 2 &&
        (!selectedProducts.every((product) => product.allowSplit) ||
          selectedProducts.some(
            (product) => product.splitPricing !== first.splitPricing,
          ))
      ) {
        context.pendingOrder = undefined;
        reply = joinBlocks(
          "Essa combinação não está disponível como meia a meia. Escolha sabores de categorias compatíveis.",
          await splitHelpMessage(),
          await currentStepMessage(),
        );
        return;
      }
      const compatibleSizes = first.sizes.filter((size) =>
        selectedProducts
          .slice(1)
          .every((product) =>
            product.sizes.some(
              (candidate) =>
                normalizeText(candidate.name) === normalizeText(size.name),
            ),
          ),
      );
      const size = draft.size
        ? compatibleSizes.find(
            (item) => normalizeText(item.name) === normalizeText(draft.size!),
          )
        : compatibleSizes.length === 1
          ? compatibleSizes[0]
          : undefined;
      if (first.sizes.length && !size) {
        context.pendingOrder = draft;
        context.options = compatibleSizes.map((item) => ({
          id: item.id,
          name: item.name,
        }));
        step = "ai_awaiting_size";
        reply = joinBlocks(
          "Só falta escolher o tamanho para eu montar esse item 🍕",
          context.options
            .map((item, index) => `${keycapNumber(index + 1)} ${item.name}`)
            .join("\n"),
        );
        return;
      }
      context.cartId = await ensureCart(
        db,
        tenant,
        c!.id,
        c!.customer_id,
        draft.service || "pickup",
      );
      let borderId: string | null = null;
      if (draft.border) {
        const borders = await rows<{ id: string; name: string }>(
          db,
          `select b.id,g.name || ' — ' || b.name name
           from public.menu_borders b
           join public.menu_border_groups g on g.tenant_id=b.tenant_id and g.id=b.group_id
           join public.menu_border_group_categories bc on bc.tenant_id=g.tenant_id and bc.group_id=g.id
           where b.tenant_id=$1 and bc.category_id=$2 and b.active and g.active
             and b.archived_at is null and g.archived_at is null
           order by g.sort_order,g.name,b.sort_order,b.name`,
          [tenant, first.categoryId],
        );
        const borderName = normalizeText(draft.border);
        const matches = borders.filter((border) => {
          const full = normalizeText(border.name);
          const option = full.split(" — ").at(-1) || full;
          return (
            full === borderName ||
            option === borderName ||
            full.includes(borderName)
          );
        });
        if (matches.length !== 1) {
          context.pendingOrder = draft;
          context.options = matches.length ? matches : borders;
          step = "ai_awaiting_border";
          reply = joinBlocks(
            matches.length
              ? "Temos mais de uma borda com esse sabor. Qual você prefere? 😋"
              : "Não encontrei essa borda. Escolha uma opção disponível:",
            context.options
              .map((item, index) => `${keycapNumber(index + 1)} ${item.name}`)
              .join("\n"),
          );
          return;
        }
        borderId = matches[0].id;
      }
      await db.query(
        "insert into public.cart_items(tenant_id,cart_id,product_ids,size_id,border_id,quantity,observation) values($1,$2,$3,$4,$5,1,'')",
        [
          tenant,
          context.cartId,
          selectedProducts.map((product) => product.id),
          size?.id || null,
          borderId,
        ],
      );
      context.pendingOrder = undefined;
      context.categoryId = first.categoryId;
      context.categoryName = first.categoryName;
      context.productIds = selectedProducts.map((product) => product.id);
      context.sizeId = size?.id || null;
      context.borderId = borderId;
      if (draft.service === "delivery" && naturalAddress && delivery) {
        context.address = naturalAddress;
        await db.query(
          "update public.carts set service_type='delivery',address_snapshot=$3,delivery_fee_cents=$4,distance_meters=$5 where tenant_id=$1 and id=$2",
          [
            tenant,
            context.cartId,
            JSON.stringify(naturalAddress),
            delivery.fee_cents,
            delivery.distance_meters,
          ],
        );
        step = "awaiting_payment";
        context.page = 0;
        reply = joinBlocks(
          "Pedido e endereço anotados! 🛵",
          formatAddress(naturalAddress),
          `Taxa: ${formatChatCurrency(delivery.fee_cents)}`,
          prompts[step],
          await options("payment"),
        );
      } else if (draft.service === "delivery") {
        await requestDeliveryAddress();
      } else if (draft.service === "pickup") {
        await continueAfterAddress(pickupAddressMessage());
      } else {
        const summary = await cartSummary(db, tenant, context.cartId);
        step = "cart_menu";
        reply = cartMenuMessage(summary.text, customer?.name);
      }
    }
    if (
      normalized === "atendente" ||
      normalized === "humano" ||
      interpretation?.intent === "human" ||
      (step === "main_menu" && normalized === "4")
    ) {
      await db.query(
        "update public.conversations set bot_paused=true,status='waiting_human',bot_epoch=bot_epoch+1 where tenant_id=$1 and id=$2",
        [tenant, c.id],
      );
      await notify(
        db,
        tenant,
        "handoff:" + messageId,
        "conversation.handoff",
        "Cliente aguardando atendimento",
        "Uma conversa precisa da sua equipe.",
        "/app/conversas?id=" + c.id,
        "conversations.view",
        c.id,
      );
      handoff = true;
      reply =
        "Vou chamar alguém da equipe para ajudar. Seu pedido continua salvo. 🍕";
    } else if (normalized === "cancelar") {
      if (context.cartId)
        await db.query(
          "update public.carts set status='cancelled' where tenant_id=$1 and id=$2 and status='active'",
          [tenant, context.cartId],
        );
      c.context = {};
      step = "main_menu";
      reply = joinBlocks("Rascunho cancelado.", prompts.main_menu);
    } else if (normalized === "menu") {
      step = "main_menu";
      reply = menu.text;
      replyList = menu.list;
    } else if (externalError) {
      if (naturalOrder?.flavors.length) {
        await applyNaturalOrder(naturalOrder);
        const waitingForOrderDetail = [
          "awaiting_name",
          "ai_awaiting_size",
          "ai_awaiting_border",
          "awaiting_category",
        ].includes(step);
        if (waitingForOrderDetail) {
          // Revalidamos o endereço depois que o dado pendente for informado.
        } else if (externalErrorCode === "delivery_out_of_range") {
          context.address = undefined;
          context.quoteHash = undefined;
          if (store?.pickup_enabled) {
            step = "delivery_out_of_range";
            reply = joinBlocks(deliveryOutOfRangeMessage, prompts[step]);
          } else {
            step = "main_menu";
            reply = deliveryOutOfRangeMessage + "\n\n" + menu.text;
          }
        } else reply = joinBlocks(externalError, reply);
      } else if (externalErrorCode === "delivery_out_of_range") {
        context.address = undefined;
        context.quoteHash = undefined;
        if (store?.pickup_enabled) {
          step = "delivery_out_of_range";
          reply = joinBlocks(deliveryOutOfRangeMessage, prompts[step]);
        } else {
          step = "main_menu";
          reply = deliveryOutOfRangeMessage + "\n\n" + menu.text;
        }
      } else reply = joinBlocks(externalError, prompts[step]);
    } else if (interpretation?.intent === "order_status") {
      reply = joinBlocks(
        await latestOrderMessage(),
        "Vamos continuar de onde paramos 😊",
        await currentStepMessage(),
      );
    } else if (interpretation?.intent === "store_address") {
      const address = store ? formatAddress(store) : "";
      const postalCode = store?.postal_code.replace(/\D/g, "");
      reply = joinBlocks(
        address
          ? `📍 *Endereço da ${store!.display_name}:*\n${address}${postalCode ? `\nCEP: ${postalCode.replace(/^(\d{5})(\d{3})$/, "$1-$2")}` : ""}`
          : "O endereço ainda não foi cadastrado. Vou chamar a equipe para ajudar.",
        "Vamos continuar de onde paramos 😊",
        await currentStepMessage(),
      );
    } else if (interpretation?.intent === "store_hours") {
      reply = joinBlocks(
        businessHoursMessage(),
        "Vamos continuar de onde paramos 😊",
        await currentStepMessage(),
      );
    } else if (interpretation?.intent === "payment_methods") {
      reply = joinBlocks(
        await paymentMethodsMessage(),
        "Vamos continuar de onde paramos 😊",
        await currentStepMessage(),
      );
    } else if (interpretation?.intent === "split_help") {
      reply = joinBlocks(
        await splitHelpMessage(),
        "Vamos continuar de onde paramos 😊",
        await currentStepMessage(),
      );
    } else if (interpretation?.intent === "identity") {
      reply = joinBlocks(
        `Sou atendente da ${store?.display_name || "pizzaria"} e estou aqui para cuidar do seu pedido 😊🍕`,
        "Vamos continuar de onde paramos:",
        await currentStepMessage(),
      );
    } else if (interpretation?.intent === "small_talk") {
      reply = joinBlocks(
        normalized.includes("obrigad")
          ? "Por nada! É um prazer ajudar 😊🍕"
          : "Oi! Que bom falar com você 😊🍕",
        await currentStepMessage(),
      );
    } else if (
      interpretation?.intent === "order" &&
      naturalOrder?.flavors.length
    ) {
      await applyNaturalOrder(naturalOrder);
    } else if (
      text.includes("?") ||
      interpretation?.intent === "question" ||
      interpretation?.intent === "search"
    ) {
      const query = (interpretation?.query || text.replace(/[?!]/g, "")).slice(
        0,
        200,
      );
      const words = normalizeText(query)
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter(
          (word) =>
            word.length >= 3 &&
            ![
              "qual",
              "quais",
              "quanto",
              "como",
              "voces",
              "voce",
              "tem",
              "vende",
              "vendem",
              "possui",
              "serve",
              "oferece",
              "kkk",
            ].includes(word),
        );
      const catalog = await rows<{
        name: string;
        description: string;
        price_cents: number | null;
      }>(
        db,
        `select i.name,i.description,
          coalesce(min(p.price_cents) filter(where p.active),i.base_price_cents) price_cents
         from public.menu_items i
         left join public.menu_item_prices p on p.tenant_id=i.tenant_id and p.item_id=i.id
         where i.tenant_id=$1 and i.active and i.available and i.archived_at is null
         group by i.id,i.name,i.description,i.base_price_cents,i.sort_order
         order by i.sort_order,i.name limit 250`,
        [tenant],
      );
      const candidates = catalog
        .filter((item) => {
          const source = normalizeText(`${item.name} ${item.description}`);
          return (
            words.length > 0 && words.every((word) => source.includes(word))
          );
        })
        .slice(0, 8);
      reply = candidates.length
        ? candidates
            .map(
              (x) =>
                `*${x.name}${x.price_cents === null ? "" : ` — ${formatChatCurrency(x.price_cents)}`}*\n${x.description || "Não há informações adicionais no cardápio."}`,
            )
            .join("\n\n")
        : words.includes("pao")
          ? "Pão não vendemos 😄 Por aqui, o forno está ocupado preparando nossas pizzas e outras delícias do cardápio! 🍕"
          : "Essa opção não aparece no nosso cardápio 😄 Mas temos várias delícias esperando por você! 🍕";
      reply = joinBlocks(
        reply,
        "Vamos continuar de onde paramos 😊",
        await currentStepMessage(),
      );
    } else if (
      normalized === "mais" &&
      ["awaiting_size", "awaiting_border", "awaiting_payment"].includes(step)
    ) {
      context.page = (context.page || 0) + 1;
      const kind = (
        {
          awaiting_size: "size",
          awaiting_border: "border",
          awaiting_payment: "payment",
        } as Record<string, string>
      )[step];
      const list = await options(kind);
      if (!context.options?.length) {
        context.page = 0;
        reply = joinBlocks("Fim da lista.", await options(kind));
      } else reply = joinBlocks(prompts[step], list);
    } else if (normalized === "carrinho" && context.cartId) {
      const summary = await cartSummary(db, tenant, context.cartId);
      step = "cart_menu";
      reply = cartMenuMessage(summary.text, customer?.name);
    } else if (normalized === "voltar") {
      step = context.previousStep || "main_menu";
      context.page = 0;
      const previousKind = (
        {
          awaiting_category: "category",
          browsing_category: "category",
          awaiting_second_category: "second_category",
          awaiting_size: "size",
          awaiting_border: "border",
          awaiting_payment: "payment",
        } as Record<string, string>
      )[step];
      reply =
        step === "awaiting_second_flavor"
          ? await secondFlavorCatalog(
              "Responda com o número ou o nome do segundo sabor.",
            )
          : joinBlocks(
              prompts[step] || prompts.main_menu,
              previousKind ? await options(previousKind) : undefined,
            );
    } else
      switch (step) {
        case "main_menu":
          if (mainMenuOption(normalized) === "3") {
            const last = await one<{
              order_number: number;
              order_status: string;
            }>(
              db,
              "select order_number,order_status from public.orders where tenant_id=$1 and customer_id=$2 order by created_at desc limit 1",
              [tenant, c.customer_id],
            );
            reply = last
              ? `Pedido #${last.order_number}: ${orderLabels[last.order_status]}`
              : "Você ainda não tem pedidos.";
          } else if (mainMenuOption(normalized) === "2") {
            step = "browsing_category";
            context.page = 0;
            reply = joinBlocks(prompts[step], await options("category"));
          } else if (mainMenuOption(normalized) === "1") {
            if (!isOpen) {
              reply =
                store?.closed_message ||
                "Estamos fechados neste momento. Você pode consultar o cardápio ou falar com a equipe.";
            } else if (!customer?.name) {
              step = "awaiting_name";
              reply = prompts[step];
            } else {
              context.cartId = await ensureCart(
                db,
                tenant,
                c.id,
                c.customer_id,
                "pickup",
              );
              context.address = undefined;
              step = "awaiting_category";
              context.page = 0;
              reply = joinBlocks(prompts[step], await options("category"));
            }
          } else {
            reply = menu.text;
            replyList = menu.list;
          }
          break;
        case "awaiting_name":
          invariant(
            text.trim().length >= 2 && text.length <= 120,
            "Informe seu nome (2 a 120 caracteres).",
          );
          await db.query(
            "update public.customers set name=$3 where tenant_id=$1 and id=$2",
            [tenant, c.customer_id, text.trim()],
          );
          if (customer) customer.name = text.trim();
          if (context.pendingOrder) {
            const pending = {
              ...context.pendingOrder,
              customer_name: text.trim(),
            };
            await applyNaturalOrder(pending);
          } else {
            context.cartId = await ensureCart(
              db,
              tenant,
              c.id,
              c.customer_id,
              "pickup",
            );
            context.address = undefined;
            step = "awaiting_category";
            context.page = 0;
            reply = joinBlocks(prompts[step], await options("category"));
          }
          break;
        case "ai_awaiting_size": {
          const choice = selected();
          invariant(
            choice && context.pendingOrder,
            "Escolha um tamanho da lista.",
          );
          await applyNaturalOrder({
            ...context.pendingOrder,
            size: choice.name,
          });
          break;
        }
        case "ai_awaiting_border": {
          const choice = selected();
          invariant(
            choice && context.pendingOrder,
            "Escolha uma borda da lista.",
          );
          await applyNaturalOrder({
            ...context.pendingOrder,
            border: choice.name,
          });
          break;
        }
        case "delivery_out_of_range":
          if (
            isChoice(
              normalized,
              "1",
              "retirada",
              "retirar",
              "retirar na pizzaria",
            )
          ) {
            const cart = await ensureCart(
              db,
              tenant,
              c.id,
              c.customer_id,
              "pickup",
            );
            context.cartId = cart;
            context.address = undefined;
            await continueAfterAddress(pickupAddressMessage());
          } else if (isChoice(normalized, "2", "voltar", "voltar ao menu")) {
            step = "main_menu";
            reply = menu.text;
            replyList = menu.list;
          } else reply = prompts[step];
          break;
        case "awaiting_service":
          const deliveryChoice = isChoice(normalized, "1", "entrega");
          const pickupChoice = isChoice(normalized, "2", "retirada", "retirar");
          if (!deliveryChoice && !pickupChoice) {
            reply = prompts[step];
            break;
          }
          invariant(
            deliveryChoice ? store?.delivery_enabled : store?.pickup_enabled,
            "Esta modalidade está indisponível.",
          );
          context.cartId = await ensureCart(
            db,
            tenant,
            c.id,
            c.customer_id,
            deliveryChoice ? "delivery" : "pickup",
          );
          context.address = undefined;
          const cartItems = await one<{ has_items: boolean }>(
            db,
            "select exists(select 1 from public.cart_items where tenant_id=$1 and cart_id=$2) has_items",
            [tenant, context.cartId],
          );
          if (!cartItems?.has_items) {
            step = "awaiting_category";
            context.page = 0;
            reply = joinBlocks(prompts[step], await options("category"));
          } else if (deliveryChoice) await requestDeliveryAddress();
          else await continueAfterAddress(pickupAddressMessage());
          break;
        case "awaiting_saved_address":
          if (
            isChoice(normalized, "0", "outro", "usar outro", "outro endereço")
          ) {
            step = "awaiting_cep";
            reply = prompts[step];
            break;
          }
          if (!savedAddress || !delivery) {
            reply = prompts[step];
            break;
          }
          context.address = savedAddress;
          context.cartId = await ensureCart(
            db,
            tenant,
            c.id,
            c.customer_id,
            "delivery",
          );
          await db.query(
            "update public.carts set address_snapshot=$3,delivery_fee_cents=$4,distance_meters=$5 where tenant_id=$1 and id=$2",
            [
              tenant,
              context.cartId,
              JSON.stringify(savedAddress),
              delivery.fee_cents,
              delivery.distance_meters,
            ],
          );
          step = "awaiting_address_confirmation";
          reply = joinBlocks(
            formatAddress(savedAddress),
            `Taxa: ${formatChatCurrency(delivery.fee_cents)}`,
            prompts[step],
          );
          break;
        case "awaiting_cep":
          if (!cep) {
            reply = "Confira seu CEP e envie os 8 números.";
            break;
          }
          context.address = {
            postal_code: cep.cep.replace(/\D/g, ""),
            street: cep.logradouro,
            neighborhood: cep.bairro,
            city: cep.localidade,
            state: cep.uf,
            complement: "",
          };
          step = !cep.logradouro
            ? "awaiting_street"
            : !cep.bairro
              ? "awaiting_neighborhood"
              : "awaiting_number";
          reply = joinBlocks(
            [cep.logradouro, cep.bairro, cep.localidade, cep.uf]
              .filter(Boolean)
              .join(" - "),
            prompts[step],
          );
          break;
        case "awaiting_street":
          invariant(
            text.trim().length >= 2 && text.length <= 200,
            "Informe o nome da rua.",
          );
          context.address = { ...context.address, street: text.trim() };
          step = context.address.neighborhood
            ? "awaiting_number"
            : "awaiting_neighborhood";
          reply = prompts[step];
          break;
        case "awaiting_neighborhood":
          invariant(
            text.trim().length >= 2 && text.length <= 100,
            "Informe o bairro.",
          );
          context.address = { ...context.address, neighborhood: text.trim() };
          step = "awaiting_number";
          reply = prompts[step];
          break;
        case "awaiting_number":
          if (!delivery) {
            reply =
              "Não foi possível validar este endereço. Confira o número ou digite ATENDENTE.";
            break;
          }
          context.address = { ...context.address, number: text.trim() };
          context.cartId = await ensureCart(
            db,
            tenant,
            c.id,
            c.customer_id,
            "delivery",
          );
          await db.query(
            "update public.carts set address_snapshot=$3,delivery_fee_cents=$4,distance_meters=$5 where tenant_id=$1 and id=$2",
            [
              tenant,
              context.cartId,
              JSON.stringify(context.address),
              delivery.fee_cents,
              delivery.distance_meters,
            ],
          );
          step = "awaiting_complement";
          reply = joinBlocks(
            `Taxa: ${formatChatCurrency(delivery.fee_cents)}`,
            prompts[step],
          );
          break;
        case "awaiting_complement":
          invariant(text.length <= 100, "Use até 100 caracteres.");
          context.address = {
            ...context.address,
            complement: isChoice(
              normalized,
              "0",
              "sem complemento",
              "nenhum complemento",
              "nenhum",
            )
              ? ""
              : text.trim(),
          };
          await db.query(
            "update public.carts set address_snapshot=$3 where tenant_id=$1 and id=$2",
            [tenant, context.cartId, JSON.stringify(context.address)],
          );
          step = "awaiting_address_confirmation";
          reply = joinBlocks(formatAddress(context.address), prompts[step]);
          break;
        case "awaiting_address_confirmation":
          if (
            isChoice(normalized, "2", "corrigir", "corrigir cep", "outro cep")
          ) {
            step = "awaiting_cep";
            reply = prompts[step];
          } else if (isChoice(normalized, "1", "confirmar", "sim")) {
            const a = addressSchema.parse(context.address);
            const exists = await one(
              db,
              "select id from public.customer_addresses where tenant_id=$1 and customer_id=$2 and postal_code=$3 and street=$4 and number=$5 and complement=$6 and archived_at is null",
              [
                tenant,
                c.customer_id,
                a.postal_code,
                a.street,
                a.number,
                a.complement,
              ],
            );
            if (!exists)
              await db.query(
                "insert into public.customer_addresses(tenant_id,customer_id,label,postal_code,street,number,complement,neighborhood,city,state) values($1,$2,'Endereço',$3,$4,$5,$6,$7,$8,$9)",
                [
                  tenant,
                  c.customer_id,
                  a.postal_code,
                  a.street,
                  a.number,
                  a.complement,
                  a.neighborhood,
                  a.city,
                  a.state,
                ],
              );
            await continueAfterAddress();
          } else reply = prompts[step];
          break;
        case "awaiting_category":
          if (!selected()) {
            reply = joinBlocks(prompts[step], await options("category"));
            break;
          }
          context.categoryId = selected()!.id;
          context.categoryName = selected()!.name;
          context.secondCategoryId = undefined;
          context.secondCategoryName = undefined;
          context.page = 0;
          step = "awaiting_product";
          reply = await categoryCatalog(
            "Responda com o número ou o nome do produto.",
          );
          const category = await one<{ allow_split: boolean }>(
            db,
            "select allow_split from public.menu_categories where tenant_id=$1 and id=$2 and active and archived_at is null",
            [tenant, context.categoryId],
          );
          if (category?.allow_split)
            followUp =
              "🍕 *Quer dois sabores?*\n\nEscolha o primeiro sabor agora. Depois de escolher o tamanho, confirme em 1️⃣ Sim. Em seguida, escolha a categoria e o segundo sabor do mesmo tamanho. 😋";
          break;
        case "browsing_category":
          if (!selected()) {
            reply = joinBlocks(prompts[step], await options("category"));
            break;
          }
          context.categoryId = selected()!.id;
          context.categoryName = selected()!.name;
          reply = await categoryCatalog(
            "Digite 1️⃣ para fazer um pedido ou MENU para voltar.",
          );
          step = "main_menu";
          break;
        case "awaiting_product":
          if (!selected()) {
            reply = await categoryCatalog(
              "Responda com o número ou o nome do produto.",
            );
            break;
          }
          context.productIds = [selected()!.id];
          context.secondCategoryId = undefined;
          context.secondCategoryName = undefined;
          context.sizeId = null;
          context.borderId = null;
          context.page = 0;
          const sizes = await options("size");
          if (context.options?.length) {
            step = "awaiting_size";
            reply = joinBlocks(prompts[step], sizes);
          } else {
            step = "awaiting_border";
            reply = joinBlocks(prompts[step], await options("border"));
          }
          break;
        case "awaiting_size":
          if (!selected()) {
            reply = prompts[step];
            break;
          }
          context.sizeId = selected()!.id;
          const split = await one<{
            allow_split: boolean;
            max_flavors: number;
          }>(
            db,
            "select c.allow_split,s.max_flavors from public.menu_sizes s join public.menu_categories c on c.id=s.category_id and c.tenant_id=s.tenant_id where s.tenant_id=$1 and s.id=$2",
            [tenant, context.sizeId],
          );
          if (split?.allow_split && split.max_flavors === 2) {
            step = "awaiting_split";
            reply = prompts[step];
          } else {
            step = "awaiting_border";
            context.page = 0;
            reply = joinBlocks(prompts[step], await options("border"));
          }
          break;
        case "awaiting_split":
          if (
            isChoice(
              normalized,
              "1",
              "sim",
              "dois sabores",
              "adicionar outro sabor",
            )
          ) {
            step = "awaiting_second_category";
            context.page = 0;
            reply = joinBlocks(prompts[step], await options("second_category"));
          } else if (
            isChoice(normalized, "2", "não", "apenas este sabor", "um sabor")
          ) {
            step = "awaiting_border";
            context.page = 0;
            reply = joinBlocks(prompts[step], await options("border"));
          } else reply = prompts[step];
          break;
        case "awaiting_second_category":
          if (!selected()) {
            reply = joinBlocks(prompts[step], await options("second_category"));
            break;
          }
          context.secondCategoryId = selected()!.id;
          context.secondCategoryName = selected()!.name;
          step = "awaiting_second_flavor";
          reply = await secondFlavorCatalog(
            "Responda com o número ou o nome do segundo sabor.",
          );
          break;
        case "awaiting_second_flavor":
          if (!selected()) {
            reply = await secondFlavorCatalog(
              "Responda com o número ou o nome do segundo sabor.",
            );
            break;
          }
          invariant(
            selected()!.id !== context.productIds?.[0],
            "Escolha outro sabor ou volte para manter um sabor.",
          );
          context.productIds = [context.productIds![0], selected()!.id];
          step = "awaiting_border";
          context.page = 0;
          reply = joinBlocks(prompts[step], await options("border"));
          break;
        case "awaiting_border":
          const withoutBorder = isChoice(
            normalized,
            "0",
            "sem borda",
            "nenhuma borda",
            "não quero borda",
          );
          if (!withoutBorder && !selected()) {
            context.page = 0;
            reply = joinBlocks(prompts[step], await options("border"));
            break;
          }
          context.borderId = withoutBorder ? null : selected()!.id;
          step = "awaiting_observation";
          reply = joinBlocks(
            namedMessage(customer?.name, "Anotei o seu pedido! 📝"),
            prompts[step],
          );
          break;
        case "awaiting_observation":
          invariant(text.length <= 500, "Use até 500 caracteres.");
          invariant(
            context.cartId && context.productIds,
            "Carrinho indisponível.",
          );
          await db.query(
            "insert into public.cart_items(tenant_id,cart_id,product_ids,size_id,border_id,quantity,observation) values($1,$2,$3,$4,$5,$6,$7)",
            [
              tenant,
              context.cartId,
              context.productIds,
              context.sizeId,
              context.borderId,
              1,
              isChoice(
                normalized,
                "0",
                "sem observação",
                "nenhuma observação",
                "nenhuma",
                "não",
                "sem",
              )
                ? ""
                : text,
            ],
          );
          const summary = await cartSummary(db, tenant, context.cartId);
          step = "cart_menu";
          reply = cartMenuMessage(summary.text, customer?.name);
          break;
        case "cart_menu":
          if (
            isChoice(normalized, "1", "adicionar mais itens", "adicionar item")
          ) {
            step = "awaiting_category";
            context.page = 0;
            reply = joinBlocks(prompts[step], await options("category"));
          } else if (
            isChoice(normalized, "2", "finalizar", "finalizar pedido")
          ) {
            step = "awaiting_service";
            reply = prompts[step];
          } else if (isChoice(normalized, "3", "aplicar cupom", "cupom")) {
            step = "awaiting_coupon";
            reply = prompts[step];
          } else if (isChoice(normalized, "4", "remover item", "remover")) {
            step = "awaiting_remove";
            reply = prompts[step];
          } else reply = prompts[step];
          break;
        case "awaiting_remove":
          const items = await rows<{ id: string; name: string }>(
            db,
            `select ci.id,
              (select string_agg(i.name,' / ' order by array_position(ci.product_ids,i.id))
               from public.menu_items i where i.tenant_id=ci.tenant_id and i.id=any(ci.product_ids)) name
             from public.cart_items ci where ci.tenant_id=$1 and ci.cart_id=$2 order by ci.created_at`,
            [tenant, context.cartId],
          );
          const itemNumber = Number(normalized);
          const itemToRemove =
            Number.isInteger(itemNumber) && itemNumber > 0
              ? items[itemNumber - 1]
              : items.find((item) => normalizeText(item.name) === normalized);
          invariant(itemToRemove, "Escolha um item da lista.");
          await db.query(
            "delete from public.cart_items where tenant_id=$1 and id=$2",
            [tenant, itemToRemove.id],
          );
          if (items.length > 1) {
            const updatedSummary = await cartSummary(
              db,
              tenant,
              context.cartId!,
            );
            step = "cart_menu";
            reply = cartMenuMessage(updatedSummary.text, customer?.name);
          } else {
            step = "awaiting_category";
            reply = joinBlocks(prompts[step], await options("category"));
          }
          break;
        case "awaiting_coupon":
          await db.query(
            "update public.carts set coupon_code=$3 where tenant_id=$1 and id=$2",
            [
              tenant,
              context.cartId,
              isChoice(
                normalized,
                "0",
                "sem cupom",
                "remover cupom",
                "nenhum cupom",
              )
                ? null
                : text.trim().toUpperCase(),
            ],
          );
          const couponSummary = await cartSummary(db, tenant, context.cartId!);
          step = "cart_menu";
          reply = cartMenuMessage(couponSummary.text, customer?.name);
          break;
        case "awaiting_payment":
          if (!selected()) {
            reply = prompts[step];
            break;
          }
          const method = await one<{ type: string; name: string }>(
            db,
            "select type,name from public.payment_methods where tenant_id=$1 and id=$2 and active and type<>'pix_mercado_pago'",
            [tenant, selected()!.id],
          );
          invariant(method, "Forma de pagamento indisponível.");
          await db.query(
            "update public.carts set payment_method_id=$3,change_for_cents=null where tenant_id=$1 and id=$2",
            [tenant, context.cartId, selected()!.id],
          );
          if (method.type === "pix_mercado_pago") {
            step = "awaiting_email";
            reply = "Informe seu e-mail para gerar o PIX.";
          } else if (method.type === "cash") {
            step = "awaiting_change";
            reply = prompts[step];
          } else {
            const final = await cartSummary(db, tenant, context.cartId!);
            context.quoteHash = final.quote.hash;
            step = "awaiting_final_confirmation";
            reply = await buildFinalConfirmation(
              final.text,
              final.quote.total_cents,
            );
          }
          break;
        case "awaiting_email":
          invariant(
            z.email().safeParse(text.trim()).success,
            "Informe um e-mail válido.",
          );
          await db.query(
            "update public.customers set email=$3 where tenant_id=$1 and id=$2",
            [tenant, c.customer_id, text.trim().toLowerCase()],
          );
          const emailQuote = await cartSummary(db, tenant, context.cartId!);
          context.quoteHash = emailQuote.quote.hash;
          step = "awaiting_final_confirmation";
          reply = await buildFinalConfirmation(
            emailQuote.text,
            emailQuote.quote.total_cents,
          );
          break;
        case "awaiting_change":
          const change = isChoice(
            normalized,
            "0",
            "sem troco",
            "não precisa de troco",
            "não",
          )
            ? null
            : parseCurrency(text);
          const changeQuote = await cartSummary(db, tenant, context.cartId!);
          invariant(
            !change || change >= changeQuote.quote.total_cents,
            "Informe um valor igual ou maior que o total.",
          );
          await db.query(
            "update public.carts set change_for_cents=$3 where tenant_id=$1 and id=$2",
            [tenant, context.cartId, change],
          );
          context.quoteHash = changeQuote.quote.hash;
          step = "awaiting_final_confirmation";
          reply = await buildFinalConfirmation(
            changeQuote.text,
            changeQuote.quote.total_cents,
          );
          break;
        case "awaiting_final_confirmation":
          if (
            isChoice(
              normalized,
              "2",
              "adicionar mais itens",
              "adicionar item",
              "mais itens",
            )
          ) {
            context.quoteHash = undefined;
            context.page = 0;
            step = "awaiting_category";
            reply = joinBlocks(prompts[step], await options("category"));
          } else if (
            isChoice(
              normalized,
              "3",
              "trocar meu pedido",
              "trocar pedido",
              "refazer pedido",
            )
          ) {
            await db.query(
              "delete from public.cart_items where tenant_id=$1 and cart_id=$2",
              [tenant, context.cartId],
            );
            await db.query(
              "update public.carts set service_type='pickup',address_snapshot=null,delivery_fee_cents=0,distance_meters=null,payment_method_id=null,change_for_cents=null,coupon_code=null where tenant_id=$1 and id=$2 and status='active'",
              [tenant, context.cartId],
            );
            context.address = undefined;
            context.categoryId = undefined;
            context.categoryName = undefined;
            context.secondCategoryId = undefined;
            context.secondCategoryName = undefined;
            context.productIds = undefined;
            context.sizeId = undefined;
            context.borderId = undefined;
            context.quoteHash = undefined;
            context.page = 0;
            step = "awaiting_category";
            reply = joinBlocks(
              "Vamos montar seu pedido novamente. 🍕",
              prompts[step],
              await options("category"),
            );
          } else if (
            isChoice(normalized, "1", "confirmar", "confirmar pedido")
          ) {
            if (delivery)
              await db.query(
                "update public.carts set delivery_fee_cents=$3,distance_meters=$4 where tenant_id=$1 and id=$2",
                [
                  tenant,
                  context.cartId,
                  delivery.fee_cents,
                  delivery.distance_meters,
                ],
              );
            const current = await cartSummary(db, tenant, context.cartId!);
            if (current.quote.hash !== context.quoteHash) {
              context.quoteHash = current.quote.hash;
              reply = joinBlocks(
                "Os valores foram atualizados.",
                await buildFinalConfirmation(
                  current.text,
                  current.quote.total_cents,
                ),
              );
              break;
            }
            const order = await finalizeCart(
              db,
              tenant,
              context.cartId!,
              context.quoteHash!,
            );
            reply = joinBlocks(
              `Pedido #${order.order_number} recebido! 🍕`,
              namedMessage(
                customer?.name,
                "assim que seu pedido for confirmado, vamos te avisar! 🔔",
              ),
            );
            if (order.payment_method_type === "pix_manual") {
              const pix = await one<{ pix_key: string }>(
                db,
                "select pix_key from public.payment_methods where tenant_id=$1 and id=(select payment_method_id from public.orders where tenant_id=$1 and id=$2)",
                [tenant, order.id],
              );
              reply = joinBlocks(
                reply,
                `Chave PIX: ${pix?.pix_key}`,
                "A equipe confirmará o recebimento.",
              );
            }
            step = "main_menu";
            c.context = {};
          } else reply = prompts[step];
          break;
        default:
          step = "main_menu";
          reply = menu.text;
          replyList = menu.list;
      }
    if (c.context === context && step !== c.current_step)
      context.previousStep = c.current_step;
    await db.query(
      "update public.conversations set current_step=$3,context=$4,version=version+1 where tenant_id=$1 and id=$2",
      [tenant, c.id, step, JSON.stringify(c.context)],
    );
    await db.query(
      "update public.conversation_messages set processed_at=now() where tenant_id=$1 and id=$2",
      [tenant, messageId],
    );
    if (reply)
      await enqueue(db, tenant, "message", "bot:" + messageId, {
        conversationId: c.id,
        sender: handoff ? "system" : "bot",
        text: reply,
        ...(replyList ? { list: replyList } : {}),
        epoch: c.bot_epoch,
      });
    if (followUp)
      await enqueue(db, tenant, "message", "bot:" + messageId + ":followup", {
        conversationId: c.id,
        sender: "bot",
        text: followUp,
        epoch: c.bot_epoch,
      });
  });
}
async function ensureCart(
  db: DB,
  tenant: string,
  conversation: string,
  customer: string,
  service: string,
) {
  await db.query(
    "update public.carts set status='expired' where tenant_id=$1 and conversation_id=$2 and status='active' and expires_at<=now()",
    [tenant, conversation],
  );
  const current = await one<{ id: string }>(
    db,
    "select id from public.carts where tenant_id=$1 and conversation_id=$2 and status='active'",
    [tenant, conversation],
  );
  if (current) {
    await db.query(
      "update public.carts set service_type=$3,delivery_fee_cents=0,address_snapshot=null where tenant_id=$1 and id=$2",
      [tenant, current.id, service],
    );
    return current.id;
  }
  const cart = await one<{ id: string }>(
    db,
    "insert into public.carts(tenant_id,conversation_id,customer_id,service_type) values($1,$2,$3,$4) returning id",
    [tenant, conversation, customer, service],
  );
  return cart!.id;
}
