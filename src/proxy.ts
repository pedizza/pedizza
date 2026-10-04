import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
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
