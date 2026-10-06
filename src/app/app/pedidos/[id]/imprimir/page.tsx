import { z } from "zod";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/context";
import { transaction, one, rows } from "@/lib/db";
import { orderColumns, type Order } from "@/lib/services/orders";
import { calculateChange, formatCurrency } from "@/lib/domain/money";
import { paymentLabels } from "@/lib/domain/orders";
import { PrintButton } from "@/components/print-button";
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
          <h2>{ctx.tenantName}</h2>
          <p>COMPROVANTE NÃO FISCAL</p>
          <h1>Pedido #{o.order_number}</h1>
          <small>
            {new Date(o.created_at).toLocaleString("pt-BR", {
              timeZone: "America/Sao_Paulo",
            })}
          </small>
          <hr />
          <strong>{o.customer_name_snapshot}</strong>
          {settings?.show_customer_phone && <p>{o.customer_phone_snapshot}</p>}
          {result.items.map((item) => (
            <div key={item.id}>
              <p>
                <strong>
                  {item.quantity}x {item.size_name_snapshot}{" "}
                  {item.name_snapshot}
                </strong>
                <br />
                {item.border_name_snapshot}
                <br />
                {settings?.show_observations && item.observation}
                <br />
                {formatCurrency(item.quantity * item.unit_price_cents)}
              </p>
            </div>
          ))}
          <hr />
          <p>
            Subtotal: {formatCurrency(o.subtotal_cents)}
            <br />
            {settings?.show_discount && (
              <>
                Desconto: {formatCurrency(o.discount_cents)}
                <br />
              </>
            )}
            Entrega: {formatCurrency(o.delivery_fee_cents)}
          </p>
          <h2>Total: {formatCurrency(o.total_cents)}</h2>
          {settings?.show_address && (
            <p>
              {o.service_type === "pickup"
                ? "RETIRADA NO LOCAL"
                : Object.values(o.delivery_address_snapshot || {})
                    .filter(Boolean)
                    .join(", ")}
            </p>
          )}
          {settings?.show_payment && (
            <p>
              {o.payment_method_name_snapshot} ·{" "}
              {paymentLabels[o.payment_status]}
              {o.change_for_cents && (
                <>
                  <br />
                  Troco para {formatCurrency(o.change_for_cents)}
                  <br />
                  <strong>
                    Troco a devolver:{" "}
                    {formatCurrency(
                      calculateChange(o.change_for_cents, o.total_cents),
                    )}
                  </strong>
                </>
              )}
            </p>
          )}
          <hr />
          <p>Obrigado por escolher nossa pizzaria!</p>
        </article>
      ))}
    </>
  );
}
