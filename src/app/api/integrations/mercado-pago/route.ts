import { NextResponse } from "next/server";
function disabled() {
  return NextResponse.json(
    {
      error:
        "A integração Mercado Pago está desativada. Use as formas de pagamento manuais.",
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
export async function GET() {
  return disabled();
}
export async function POST() {
  return disabled();
}
