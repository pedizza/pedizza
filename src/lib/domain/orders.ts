export const orderLabels: Record<string, string> = {
  new: "Novo",
  accepted: "Aceito",
  preparing: "Em preparo",
  ready: "Pronto",
  ready_for_pickup: "Pronto para retirada",
  out_for_delivery: "Em entrega",
  delivered: "Entregue",
  picked_up: "Retirado",
  cancelled: "Cancelado",
  refused: "Recusado",
};
export const paymentLabels: Record<string, string> = {
  pending: "Pendente",
  paid: "Pago",
  awaiting_manual_confirmation: "Aguardando confirmação",
  pay_on_delivery: "Pagar na entrega",
  failed: "Falhou",
  expired: "Expirado",
  refunded: "Reembolsado",
};
export function nextOrderStatus(status: string, service: string) {
  return (
    {
      new: "accepted",
      accepted: "preparing",
      preparing: service === "pickup" ? "ready_for_pickup" : "ready",
      ready: "out_for_delivery",
      ready_for_pickup: "picked_up",
      out_for_delivery: "delivered",
    } as Record<string, string>
  )[status];
}
export function canTransition(from: string, to: string, service: string) {
  if (["delivered", "picked_up", "cancelled", "refused"].includes(from))
    return false;
  if (to === "refused") return from === "new";
  if (to === "cancelled") return from !== "new";
  return nextOrderStatus(from, service) === to;
}
export const isCompleted = (s: string) =>
  s === "delivered" || s === "picked_up";
