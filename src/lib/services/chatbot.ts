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
import { mainMenuOption } from "@/lib/domain/whatsapp";
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
  productIds?: string[];
  sizeId?: string | null;
  borderId?: string | null;
  quantity?: number;
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
const prompts: Record<string, string> = {
  main_menu: "1 — Fazer pedido\n2 — Ver cardápio\n3 — Acompanhar pedido",
  awaiting_name: "Como você se chama?",
  awaiting_service: "Como deseja receber?\n1 — Entrega\n2 — Retirada",
  awaiting_cep: "Informe seu CEP (8 números).",
  awaiting_number: "Qual é o número do endereço?",
  awaiting_street: "Qual é o nome da rua?",
  awaiting_neighborhood: "Qual é o bairro?",
  awaiting_complement:
    "Informe complemento ou referência. Digite 0 para continuar sem complemento.",
  awaiting_saved_address:
    "Escolha um endereço salvo ou digite 0 para usar outro:",
  awaiting_address_confirmation:
    "Confirme o endereço e a taxa:\n1 — Confirmar\n2 — Corrigir CEP",
  delivery_out_of_range:
    "Como deseja continuar?\n1 — Retirar na pizzaria\n2 — Voltar ao menu",
  awaiting_category: "Escolha uma categoria:",
  browsing_category: "*Escolha uma categoria para ver o cardápio:*",
  awaiting_product: "Escolha um produto:",
  awaiting_size: "Escolha o tamanho:",
  awaiting_split: "Deseja dois sabores?\n1 — Sim\n2 — Apenas este sabor",
  awaiting_second_flavor: "Escolha o segundo sabor:",
  awaiting_border: "Escolha uma borda ou digite 0 para continuar sem borda:",
  awaiting_quantity: "Qual a quantidade? (1 a 99)",
  awaiting_observation:
    "Alguma observação? Digite 0 para continuar sem observação.",
  cart_menu:
    "1 — Adicionar mais itens\n2 — Finalizar\n3 — Aplicar cupom\n4 — Remover item",
  awaiting_remove: "Digite o número do item para remover.",
  awaiting_coupon: "Digite o código do cupom ou 0 para remover o cupom.",
  awaiting_payment: "Escolha a forma de pagamento:",
  awaiting_change:
    "Precisa de troco? Informe o valor (ex.: 100,00) ou 0 para não precisar.",
  awaiting_final_confirmation: "1 — CONFIRMAR PEDIDO\n2 — Voltar ao carrinho",
};

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
  return {
    quote: q,
    text: [
      ...q.items.map(
        (i, n) =>
          `${n + 1}. ${i.quantity}x ${i.size_name_snapshot || ""} ${i.name_snapshot}${i.border_name_snapshot ? " · Borda " + i.border_name_snapshot : ""}${i.observation ? "\nObs.: " + i.observation : ""} — ${formatCurrency(i.unit_price_cents * i.quantity)}`,
      ),
      `Subtotal: ${formatCurrency(q.subtotal_cents)}`,
      `Desconto: ${formatCurrency(q.discount_cents)}`,
      `Entrega: ${formatCurrency(q.delivery_fee_cents)}`,
      `Total: ${formatCurrency(q.total_cents)}`,
    ].join("\n"),
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
    if (
      initial.current_step === "awaiting_saved_address" &&
      Number(normalized) > 0
    ) {
      const choice = initial.context.options?.[Number(normalized) - 1];
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
      normalized === "1" &&
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
      if (kind === "product" || kind === "second") {
        sql =
          "select id,name from public.menu_items where tenant_id=$1 and category_id=$2 and active and available and archived_at is null order by sort_order,id limit 8 offset $3";
        params.push(context.categoryId);
      }
      if (kind === "size") {
        sql =
          "select s.id,s.name from public.menu_sizes s join public.menu_item_prices p on p.tenant_id=s.tenant_id and p.size_id=s.id where s.tenant_id=$1 and p.item_id=$2 and p.active and s.active and s.archived_at is null order by s.sort_order,s.id limit 8 offset $3";
        params.push(context.productIds?.[0]);
      }
      if (kind === "border") {
        sql =
          "select b.id,g.name || ' — ' || b.name name from public.menu_borders b join public.menu_border_groups g on g.tenant_id=b.tenant_id and g.id=b.group_id join public.menu_border_group_categories c on c.tenant_id=g.tenant_id and c.group_id=g.id where b.tenant_id=$1 and c.category_id=$2 and b.active and g.active and b.archived_at is null and g.archived_at is null order by g.sort_order,g.name,b.sort_order,b.name limit 8 offset $3";
        params.push(context.categoryId);
      }
      if (kind === "payment")
        sql =
          "select id,name from public.payment_methods where tenant_id=$1 and active and type<>'pix_mercado_pago' and archived_at is null order by sort_order,id limit 8 offset $2";
      if (kind !== "category") params.push(context.page * 8);
      context.options = await rows<{ id: string; name: string }>(
        db,
        sql,
        params,
      );
      return (
        context.options.map((o, i) => `${i + 1} — ${o.name}`).join("\n") +
        (kind !== "category" && context.options.length === 8
          ? "\nDigite MAIS para ver outras opções."
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
    const selected = () => {
      const numeric = Number(normalized);
      if (Number.isInteger(numeric) && numeric > 0)
        return context.options?.[numeric - 1];
      return context.options?.find(
        (option) => normalizeText(option.name) === normalized,
      );
    };
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
      reply = "Rascunho cancelado.\n" + prompts.main_menu;
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
          reply = deliveryOutOfRangeMessage + "\n\n" + prompts[step];
        } else {
          step = "main_menu";
          reply = deliveryOutOfRangeMessage + "\n\n" + menu.text;
        }
      } else reply = externalError + "\n" + (prompts[step] || "");
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
            .join("\n")
        : "Não encontrei essa informação no cardápio. Digite ATENDENTE para falar com a equipe.";
      reply += "\n\n" + (prompts[step] || prompts.main_menu);
    } else if (
      normalized === "mais" &&
      [
        "awaiting_second_flavor",
        "awaiting_size",
        "awaiting_border",
        "awaiting_payment",
      ].includes(step)
    ) {
      context.page = (context.page || 0) + 1;
      const kind = (
        {
          awaiting_second_flavor: "second",
          awaiting_size: "size",
          awaiting_border: "border",
          awaiting_payment: "payment",
        } as Record<string, string>
      )[step];
      const list = await options(kind);
      if (!context.options?.length) {
        context.page = 0;
        reply = "Fim da lista.\n" + (await options(kind));
      } else reply = prompts[step] + "\n" + list;
    } else if (normalized === "carrinho" && context.cartId) {
      const summary = await cartSummary(db, tenant, context.cartId);
      step = "cart_menu";
      reply = summary.text + "\n\n" + prompts.cart_menu;
    } else if (normalized === "voltar") {
      step = context.previousStep || "main_menu";
      context.page = 0;
      const previousKind = (
        {
          awaiting_category: "category",
          browsing_category: "category",
          awaiting_second_flavor: "second",
          awaiting_size: "size",
          awaiting_border: "border",
          awaiting_payment: "payment",
        } as Record<string, string>
      )[step];
      reply =
        (prompts[step] || prompts.main_menu) +
        (previousKind
          ? (step === "browsing_category" ? "\n\n" : "\n") +
            (await options(previousKind))
          : "");
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
            reply = prompts[step] + "\n\n" + (await options("category"));
          } else if (mainMenuOption(normalized) === "1") {
            if (!isOpen) {
              reply =
                store?.closed_message ||
                "Estamos fechados neste momento. Você pode consultar o cardápio ou falar com a equipe.";
            } else {
              step = customer?.name ? "awaiting_service" : "awaiting_name";
              reply = prompts[step];
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
          step = "awaiting_service";
          reply = prompts[step];
          break;
        case "delivery_out_of_range":
          if (normalized === "1") {
            const cart = await ensureCart(
              db,
              tenant,
              c.id,
              c.customer_id,
              "pickup",
            );
            context.cartId = cart;
            step = "awaiting_category";
            context.page = 0;
            reply = prompts[step] + "\n" + (await options("category"));
          } else if (normalized === "2") {
            step = "main_menu";
            reply = menu.text;
            replyList = menu.list;
          } else reply = prompts[step];
          break;
        case "awaiting_service":
          if (!["1", "2"].includes(normalized)) {
            reply = prompts[step];
            break;
          }
          invariant(
            normalized === "1"
              ? store?.delivery_enabled
              : store?.pickup_enabled,
            "Esta modalidade está indisponível.",
          );
          if (normalized === "1") {
            const addresses = await rows<{ id: string; name: string }>(
              db,
              "select id,label||': '||street||', '||number||' — '||neighborhood name from public.customer_addresses where tenant_id=$1 and customer_id=$2 and active and archived_at is null order by is_default desc,created_at desc limit 8",
              [tenant, c.customer_id],
            );
            context.options = addresses;
            step = addresses.length ? "awaiting_saved_address" : "awaiting_cep";
            reply =
              prompts[step] +
              (addresses.length
                ? "\n" +
                  addresses.map((a, i) => `${i + 1} — ${a.name}`).join("\n")
                : "");
          } else {
            const cart = await ensureCart(
              db,
              tenant,
              c.id,
              c.customer_id,
              "pickup",
            );
            context.cartId = cart;
            context.address = undefined;
            step = "awaiting_category";
            context.page = 0;
            reply = prompts[step] + "\n" + (await options("category"));
          }
          break;
        case "awaiting_saved_address":
          if (normalized === "0") {
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
          reply =
            Object.values(savedAddress).filter(Boolean).join(", ") +
            `\nTaxa: ${formatCurrency(delivery.fee_cents)}\n` +
            prompts[step];
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
          reply = `${cep.logradouro}, ${cep.bairro} — ${cep.localidade}/${cep.uf}\n${prompts[step]}`;
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
          reply =
            `Taxa: ${formatCurrency(delivery.fee_cents)}\n` + prompts[step];
          break;
        case "awaiting_complement":
          invariant(text.length <= 100, "Use até 100 caracteres.");
          context.address = {
            ...context.address,
            complement: normalized === "0" ? "" : text.trim(),
          };
          await db.query(
            "update public.carts set address_snapshot=$3 where tenant_id=$1 and id=$2",
            [tenant, context.cartId, JSON.stringify(context.address)],
          );
          step = "awaiting_address_confirmation";
          reply =
            Object.values(context.address).filter(Boolean).join(", ") +
            "\n" +
            prompts[step];
          break;
        case "awaiting_address_confirmation":
          if (normalized === "2") {
            step = "awaiting_cep";
            reply = prompts[step];
          } else if (normalized === "1") {
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
                "insert into public.customer_addresses(tenant_id,customer_id,label,postal_code,street,number,complement,neighborhood,city,state) values($1,$2,'WhatsApp',$3,$4,$5,$6,$7,$8,$9)",
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
            step = "awaiting_category";
            context.page = 0;
            reply = prompts[step] + "\n" + (await options("category"));
          } else reply = prompts[step];
          break;
        case "awaiting_category":
          if (!selected()) {
            reply = prompts[step] + "\n" + (await options("category"));
            break;
          }
          context.categoryId = selected()!.id;
          context.categoryName = selected()!.name;
          context.page = 0;
          step = "awaiting_product";
          reply = await categoryCatalog(
            "Responda com o número ou o nome do produto.",
          );
          break;
        case "browsing_category":
          if (!selected()) {
            reply = prompts[step] + "\n\n" + (await options("category"));
            break;
          }
          context.categoryId = selected()!.id;
          context.categoryName = selected()!.name;
          reply = await categoryCatalog(
            "Digite 1 para fazer um pedido ou MENU para voltar.",
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
          context.sizeId = null;
          context.borderId = null;
          context.page = 0;
          const sizes = await options("size");
          if (context.options?.length) {
            step = "awaiting_size";
            reply = prompts[step] + "\n" + sizes;
          } else {
            step = "awaiting_border";
            reply = prompts[step] + "\n" + (await options("border"));
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
            reply = prompts[step] + "\n" + (await options("border"));
          }
          break;
        case "awaiting_split":
          if (normalized === "1") {
            step = "awaiting_second_flavor";
            context.page = 0;
            reply = prompts[step] + "\n" + (await options("second"));
          } else if (normalized === "2") {
            step = "awaiting_border";
            context.page = 0;
            reply = prompts[step] + "\n" + (await options("border"));
          } else reply = prompts[step];
          break;
        case "awaiting_second_flavor":
          if (!selected()) {
            reply = prompts[step];
            break;
          }
          invariant(
            selected()!.id !== context.productIds?.[0],
            "Escolha outro sabor ou volte para manter um sabor.",
          );
          context.productIds = [context.productIds![0], selected()!.id];
          step = "awaiting_border";
          context.page = 0;
          reply = prompts[step] + "\n" + (await options("border"));
          break;
        case "awaiting_border":
          if (normalized !== "0" && !selected()) {
            reply = prompts[step];
            break;
          }
          context.borderId = normalized === "0" ? null : selected()!.id;
          step = "awaiting_quantity";
          reply = prompts[step];
          break;
        case "awaiting_quantity":
          invariant(
            /^\d{1,2}$/.test(normalized) && Number(normalized) > 0,
            "Informe uma quantidade entre 1 e 99.",
          );
          context.quantity = Number(normalized);
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
              context.quantity,
              normalized === "0" ? "" : text,
            ],
          );
          const summary = await cartSummary(db, tenant, context.cartId);
          step = "cart_menu";
          reply = summary.text + "\n\n" + prompts[step];
          break;
        case "cart_menu":
          if (normalized === "1") {
            step = "awaiting_category";
            context.page = 0;
            reply = prompts[step] + "\n" + (await options("category"));
          } else if (normalized === "2") {
            step = "awaiting_payment";
            context.page = 0;
            reply = prompts[step] + "\n" + (await options("payment"));
          } else if (normalized === "3") {
            step = "awaiting_coupon";
            reply = prompts[step];
          } else if (normalized === "4") {
            step = "awaiting_remove";
            reply = prompts[step];
          } else reply = prompts[step];
          break;
        case "awaiting_remove":
          const items = await rows<{ id: string }>(
            db,
            "select id from public.cart_items where tenant_id=$1 and cart_id=$2 order by created_at",
            [tenant, context.cartId],
          );
          invariant(items[Number(normalized) - 1], "Escolha um item da lista.");
          await db.query(
            "delete from public.cart_items where tenant_id=$1 and id=$2",
            [tenant, items[Number(normalized) - 1].id],
          );
          step = items.length > 1 ? "cart_menu" : "awaiting_category";
          reply =
            prompts[step] +
            (items.length === 1 ? "\n" + (await options("category")) : "");
          break;
        case "awaiting_coupon":
          await db.query(
            "update public.carts set coupon_code=$3 where tenant_id=$1 and id=$2",
            [
              tenant,
              context.cartId,
              normalized === "0" ? null : text.trim().toUpperCase(),
            ],
          );
          const couponSummary = await cartSummary(db, tenant, context.cartId!);
          step = "cart_menu";
          reply = couponSummary.text + "\n" + prompts[step];
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
            reply =
              final.text +
              "\nPagamento: " +
              method.name +
              "\n" +
              (context.address
                ? Object.values(context.address).join(", ")
                : "Retirada no local") +
              "\n\n" +
              prompts[step];
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
          reply =
            emailQuote.text +
            "\nPagamento: PIX Mercado Pago\n" +
            (context.address
              ? Object.values(context.address).join(", ")
              : "Retirada no local") +
            "\n" +
            prompts[step];
          break;
        case "awaiting_change":
          const change = normalized === "0" ? null : parseCurrency(text);
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
          reply =
            changeQuote.text +
            "\nPagamento: Dinheiro" +
            (change
              ? " · Troco para " + formatCurrency(change)
              : " · Sem troco") +
            "\n" +
            (context.address
              ? Object.values(context.address).join(", ")
              : "Retirada no local") +
            "\n\n" +
            prompts[step];
          break;
        case "awaiting_final_confirmation":
          if (normalized === "2") {
            step = "cart_menu";
            reply = prompts[step];
          } else if (normalized === "1") {
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
              reply =
                "Os valores foram atualizados. Confira antes de confirmar:\n" +
                current.text +
                "\n" +
                prompts[step];
              break;
            }
            const order = await finalizeCart(
              db,
              tenant,
              context.cartId!,
              context.quoteHash!,
            );
            reply = `Pedido #${order.order_number} recebido! 🍕\nAguardando confirmação da pizzaria. Avisaremos quando for aceito.`;
            if (order.payment_method_type === "pix_manual") {
              const pix = await one<{ pix_key: string }>(
                db,
                "select pix_key from public.payment_methods where tenant_id=$1 and id=(select payment_method_id from public.orders where tenant_id=$1 and id=$2)",
                [tenant, order.id],
              );
              reply +=
                "\nChave PIX: " +
                pix?.pix_key +
                "\nA equipe confirmará o recebimento.";
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
