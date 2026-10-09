import { z } from "zod";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/context";
import { transaction, one, rows } from "@/lib/db";
import { orderColumns, type Order } from "@/lib/services/orders";
import { calculateChange, formatCurrency } from "@/lib/domain/money";
import { paymentLabels } from "@/lib/domain/orders";
import { formatAddress } from "@/lib/domain/address";
import { PrintButton } from "@/components/print-button";
import Image from "next/image";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ auto?: string }>;
}) {
  const ctx = await requirePage("orders.print");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const result = await transaction(async (db) => {
    const order = await one<Order>(
      db,
      `select ${orderColumns} from public.orders where tenant_id=$1 and id=$2`,
      [ctx.tenantId, id],
    );
    const items = await rows<{
      id: string;
      name_snapshot: string;
      size_name_snapshot: string;
      border_name_snapshot: string;
      quantity: number;
      unit_price_cents: number;
      observation: string;
    }>(
      db,
      "select id,name_snapshot,size_name_snapshot,border_name_snapshot,quantity,unit_price_cents,observation from public.order_items where tenant_id=$1 and order_id=$2",
      [ctx.tenantId, id],
    );
    return { order, items };
  }, ctx.userId);
  if (!result.order) notFound();
  const settings = await transaction((db) =>
    one<{
      paper_width: number;
      copies: number;
      show_customer_phone: boolean;
      show_address: boolean;
      show_payment: boolean;
      show_observations: boolean;
      show_discount: boolean;
    }>(
      db,
      "select paper_width,copies,show_customer_phone,show_address,show_payment,show_observations,show_discount from public.print_settings where tenant_id=$1",
      [ctx.tenantId],
    ),
  );
  const o = result.order;
  return (
    <>
      <PrintButton auto={(await searchParams).auto === "1"} />
      {Array.from({ length: settings?.copies || 1 }, (_, i) => (
        <article
          className="receipt"
          style={{
            width: `${settings?.paper_width || 80}mm`,
            pageBreakAfter: i < (settings?.copies || 1) - 1 ? "always" : "auto",
          }}
          key={i}
        >
          <header className="receipt-header">
            {ctx.hasStoreLogo && ctx.storeSettingsId && (
              <Image
                src={`/api/images?resource=loja&id=${ctx.storeSettingsId}`}
                width={180}
                height={90}
                unoptimized
                alt={`Logotipo da ${ctx.tenantName}`}
              />
            )}
            <h2>{ctx.tenantName}</h2>
            <p>CUPOM NÃO FISCAL</p>
          </header>
          <h1>Pedido #{o.order_number}</h1>
          <small className="receipt-date">
            {new Date(o.created_at).toLocaleString("pt-BR", {
              timeZone: "America/Sao_Paulo",
            })}
          </small>
          <hr />
          <section className="receipt-customer">
            <strong>{o.customer_name_snapshot}</strong>
            {settings?.show_customer_phone && (
              <span>{o.customer_phone_snapshot}</span>
            )}
          </section>
          <section className="receipt-items">
            <h3>Produtos</h3>
            {result.items.map((item) => (
              <div className="receipt-item" key={item.id}>
                <strong>
                  {item.quantity}x {item.size_name_snapshot}{" "}
                  {item.name_snapshot}
                </strong>
                {item.border_name_snapshot && (
                  <span>{item.border_name_snapshot}</span>
                )}
                {settings?.show_observations && item.observation && (
                  <span>Observação: {item.observation}</span>
                )}
                <strong className="receipt-item-price">
                  {formatCurrency(item.quantity * item.unit_price_cents)}
                </strong>
              </div>
            ))}
          </section>
          <hr />
          <section className="receipt-totals">
            <p>
              <span>Subtotal</span>
              <strong>{formatCurrency(o.subtotal_cents)}</strong>
            </p>
            {settings?.show_discount && (
              <p>
                <span>Desconto</span>
                <strong>{formatCurrency(o.discount_cents)}</strong>
              </p>
            )}
            <p>
              <span>Entrega</span>
              <strong>{formatCurrency(o.delivery_fee_cents)}</strong>
            </p>
            <h2>
              <span>Total</span>
              <strong>{formatCurrency(o.total_cents)}</strong>
            </h2>
          </section>
          {settings?.show_address && (
            <section className="receipt-block">
              <strong>
                {o.service_type === "pickup"
                  ? "Retirada"
                  : "Endereço de entrega"}
              </strong>
              <span>
                {o.service_type === "pickup"
                  ? "Retirada no local"
                  : formatAddress(o.delivery_address_snapshot)}
              </span>
            </section>
          )}
          {settings?.show_payment && (
            <section className="receipt-block">
              <strong>Formas de pagamento</strong>
              <span>
                {o.payment_method_name_snapshot} ·{" "}
                {paymentLabels[o.payment_status]}
              </span>
              {o.change_for_cents && (
                <>
                  <span>Troco para {formatCurrency(o.change_for_cents)}</span>
                  <strong>
                    Troco a devolver:{" "}
                    {formatCurrency(
                      calculateChange(o.change_for_cents, o.total_cents),
                    )}
                  </strong>
                </>
              )}
            </section>
          )}
          <hr />
          <p className="receipt-thanks">
            Obrigado por escolher nossa pizzaria!
          </p>
        </article>
      ))}
    </>
  );
}
