import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  // Redirect browser pages only; provider callbacks must keep their original URL.
  if (
    process.env.NODE_ENV === "production" &&
    process.env.CANONICAL_REDIRECT_ENABLED === "true" &&
    ["pedizza.vercel.app", "pedizza.com.br"].includes(
      request.nextUrl.hostname,
    ) &&
    ["GET", "HEAD"].includes(request.method) &&
    !request.nextUrl.pathname.startsWith("/api/") &&
    request.nextUrl.pathname !== "/api"
  ) {
    const canonical = new URL(
      request.nextUrl.pathname + request.nextUrl.search,
      "https://www.pedizza.com.br",
    );
    return NextResponse.redirect(canonical, 308);
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV !== "production";
  const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${dev ? "'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ; font-src 'self'; connect-src 'self'   ${dev ? "ws:" : ""}; media-src 'self' blob: ; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';`;
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  const path = request.nextUrl.pathname;
  response.headers.set("Content-Security-Policy", csp);
  if (
    path.startsWith("/app") ||
    path.startsWith("/gestor-pedidos") ||
    path.startsWith("/master") ||
    path.startsWith("/api")
  )
    response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|logo.png|icons/|sw.js|manifest.webmanifest).*)",
  ],
};
