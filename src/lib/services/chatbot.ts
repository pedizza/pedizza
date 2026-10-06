import "server-only";
import { z } from "zod";
import { transaction, one, rows, type DB } from "@/lib/db";
import { invariant, AppError } from "@/lib/errors";
import { normalizeText } from "@/lib/domain/normalization";
import { formatCurrency, parseCurrency } from "@/lib/domain/money";
import { getStoreOpenStatus, type BusinessHour } from "@/lib/domain/hours";
import {
  lookupCep,
  quoteDelivery,
  addressSchema,
  deliveryOutOfRangeMessage,
  type Address,
} from "@/lib/integrations/geo";
import { interpretMessage } from "@/lib/integrations/openai";
import { enqueue, notify } from "./events";
import { priceCart } from "./pricing";
import { finalizeCart } from "./orders";
import { orderLabels } from "@/lib/domain/orders";
import type { WhatsAppList } from "@/lib/integrations/evolution";
import { keycapNumber, mainMenuOption } from "@/lib/domain/whatsapp";
import { formatAddress } from "@/lib/domain/address";
import {
  formatCategoryCatalog,
  type CatalogProduct,
} from "@/lib/domain/catalog";
type BotContext = {
  cartId?: string;
  address?: Partial<Address>;
  options?: { id: string; name: string }[];
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

const prompts: Record<string, string> = {
  main_menu: "1️⃣ Fazer pedido\n2️⃣ Ver cardápio\n3️⃣ Acompanhar pedido",
  awaiting_name:
    "Perfeito, vamos começar a anotar seu pedido! 🍕\n\nQual seu nome, por gentileza? 😊",
  awaiting_service:
    "Como deseja receber seu pedido? 🍕\n\n1️⃣ Entrega 🛵\n2️⃣ Retirada 🏪",
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
  awaiting_category: "Escolha uma categoria:",
  browsing_category: "*Escolha uma categoria para ver o cardápio:*",
  awaiting_product: "Escolha um produto:",
  awaiting_size: "Escolha o tamanho:",
  awaiting_split: "Deseja dois sabores?\n\n1️⃣ Sim\n2️⃣ Apenas este sabor",
  awaiting_second_category: "Escolha a categoria do segundo sabor:",
  awaiting_second_flavor: "Escolha o segundo sabor para o mesmo tamanho:",
  awaiting_border: "Escolha uma borda:\n\nDigite 0️⃣ para continuar sem borda.",
  awaiting_observation:
    "Alguma observação?\n\nDigite 0️⃣ para continuar sem observação.",
  cart_menu:
    "1️⃣ Adicionar mais itens\n2️⃣ Finalizar\n3️⃣ Aplicar cupom\n4️⃣ Remover item",
  awaiting_remove: "Digite o número ou o nome do item para remover.",
  awaiting_coupon:
    "Digite o código do cupom.\n\nDigite 0️⃣ para remover o cupom.",
  awaiting_payment: "Escolha a forma de pagamento:",
  awaiting_change:
    "Precisa de troco?\n\nInforme o valor (ex.: 100,00) ou digite 0️⃣ para continuar sem troco.",
  awaiting_final_confirmation:
    "1️⃣ CONFIRMAR PEDIDO\n2️⃣ Adicionar mais itens\n3️⃣ Trocar meu pedido",
};

function cartMenuMessage(summary: string) {
  return joinBlocks("Anotei o seu pedido! 📝", summary, prompts.cart_menu);
}

function mainMenu(store?: { display_name: string; welcome_message: string }) {
  const storeName = store?.display_name.trim() || "nossa pizzaria";
  const greeting =
    store?.welcome_message.trim() || `Olá! Seja bem-vindo (a) ${storeName} 🍕`;
  return {
    text: `${greeting}\n\nComo podemos ajudar?\n\n${prompts.main_menu}`,
    list: {
      title: `Olá! Seja bem-vindo (a) ${storeName} 🍕`.slice(0, 60),
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
      `${keycapNumber(index + 1)} ${item.quantity}x ${item.size_name_snapshot || ""} ${item.name_snapshot}${item.border_name_snapshot ? " · Borda " + item.border_name_snapshot : ""}${item.observation ? "\nObs.: " + item.observation : ""} — ${formatCurrency(item.unit_price_cents * item.quantity)}`,
  );
  return {
    quote: q,
    text: joinBlocks(
      items.join("\n\n"),
      [
        `Subtotal: ${formatCurrency(q.subtotal_cents)}`,
        `Desconto: ${formatCurrency(q.discount_cents)}`,
        `Entrega: ${formatCurrency(q.delivery_fee_cents)}`,
        `Total: ${formatCurrency(q.total_cents)}`,
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
  let savedAddress: Address | undefined;
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
  } catch (e) {
    externalErrorCode = e instanceof AppError ? e.code : undefined;
    externalError =
      e instanceof AppError
        ? e.message
        : "Não conseguimos validar o endereço. Confira os dados e tente novamente.";
  }
  const interpretation =
    !/^\d+$/.test(normalized) && text.includes("?")
      ? await interpretMessage(text)
      : null;
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
    const customer = await one<{ name: string; blocked: boolean }>(
      db,
      "select name,blocked from public.customers where tenant_id=$1 and id=$2",
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
    }>(
      db,
      "select display_name,timezone,status_mode,welcome_message,closed_message,delivery_enabled,pickup_enabled from public.store_settings where tenant_id=$1",
      [tenant],
    );
    const menu = mainMenu(store || undefined);
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
          "select b.id,g.name || ' — ' || b.name name from public.menu_borders b join public.menu_border_groups g on g.tenant_id=b.tenant_id and g.id=b.group_id join public.menu_border_group_categories c on c.tenant_id=g.tenant_id and c.group_id=g.id where b.tenant_id=$1 and c.category_id=$2 and b.active and g.active and b.archived_at is null and g.archived_at is null order by g.sort_order,g.name,b.sort_order,b.name";
        params.push(context.categoryId);
      }
      if (kind === "payment")
        sql =
          "select id,name from public.payment_methods where tenant_id=$1 and active and type<>'pix_mercado_pago' and archived_at is null order by sort_order,id limit 8 offset $2";
      if (!["category", "second_category", "second", "border"].includes(kind))
        params.push(context.page * 8);
      context.options = await rows<{ id: string; name: string }>(
        db,
        sql,
        params,
      );
      return (
        context.options
          .map((o, i) => `${keycapNumber(i + 1)} ${o.name}`)
          .join("\n") +
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
            context.categoryName || "Cardápio",
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
      return context.options?.find(
        (option) => normalizeText(option.name) === normalized,
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
    async function continueAfterAddress() {
      const cart = await one<{ has_items: boolean }>(
        db,
        "select exists(select 1 from public.cart_items where tenant_id=$1 and cart_id=$2) has_items",
        [tenant, context.cartId],
      );
      context.page = 0;
      if (cart?.has_items) {
        step = "awaiting_payment";
        reply = joinBlocks(prompts[step], await options("payment"));
      } else {
        step = "awaiting_category";
        reply = joinBlocks(prompts[step], await options("category"));
      }
    }
    async function buildFinalConfirmation(summary: string) {
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
            ? ` · Troco para ${formatCurrency(cart.change_for_cents)}`
            : " · Sem troco"
          : "");
      const fulfillment =
        cart.service_type === "delivery" && context.address
          ? `Endereço: ${formatAddress(context.address)}`
          : "Retirada no local";
      return joinBlocks(
        "Confirme se o pedido está correto, por gentileza? 😊",
        [summary, payment, fulfillment].join("\n"),
        prompts.awaiting_final_confirmation,
      );
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
      if (externalErrorCode === "delivery_out_of_range") {
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
    } else if (text.includes("?") || interpretation?.intent === "question") {
      const query = (interpretation?.query || text.replace(/[?!]/g, "")).slice(
        0,
        100,
      );
      const candidates = await rows<{ name: string; description: string }>(
        db,
        "select name,description from public.menu_items where tenant_id=$1 and active and available and archived_at is null and (name ilike $2 or description ilike $2) limit 5",
        [tenant, "%" + query + "%"],
      );
      reply = candidates.length
        ? candidates
            .map(
              (x) =>
                `${x.name}: ${x.description || "Não há informações de ingredientes no cardápio."}`,
            )
            .join("\n\n")
        : "Não encontrei essa informação no cardápio. Digite ATENDENTE para falar com a equipe.";
      reply += "\n\n" + (prompts[step] || prompts.main_menu);
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
      reply = cartMenuMessage(summary.text);
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
          break;
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
            await continueAfterAddress();
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
          else await continueAfterAddress();
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
            `Taxa: ${formatCurrency(delivery.fee_cents)}`,
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
            `Taxa: ${formatCurrency(delivery.fee_cents)}`,
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
          reply = prompts[step];
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
              )
                ? ""
                : text,
            ],
          );
          const summary = await cartSummary(db, tenant, context.cartId);
          step = "cart_menu";
          reply = cartMenuMessage(summary.text);
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
            reply = cartMenuMessage(updatedSummary.text);
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
          reply = cartMenuMessage(couponSummary.text);
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
            reply = await buildFinalConfirmation(final.text);
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
          reply = await buildFinalConfirmation(emailQuote.text);
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
          reply = await buildFinalConfirmation(changeQuote.text);
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
                await buildFinalConfirmation(current.text),
              );
              break;
            }
            const order = await finalizeCart(
              db,
              tenant,
              context.cartId!,
              context.quoteHash!,
            );
            reply = `Pedido #${order.order_number} recebido! 🍕\n\nAguardando confirmação da pizzaria. Avisaremos quando for aceito.`;
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
