import { test, expect } from "@playwright/test";
test("public pages hydrate, remain usable on mobile, and protect private navigation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Sua pizzaria. Tudo no ponto." }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page.getByRole("link", { name: "Entrar", exact: true }).click();
  await expect(page.getByLabel("E-mail")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Entrar na minha loja/ }),
  ).toBeEnabled();
  await page.goto("/app/pedidos");
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/master");
  await expect(page).toHaveURL(/\/login/);
  expect(errors).toEqual([]);
});
test("private API and untrusted webhook requests are rejected", async ({
  request,
}) => {
  for (const path of [
    "/api/orders",
    "/api/conversations",
    "/api/notifications",
    "/api/master",
    "/api/data/clientes",
  ]) {
    const r = await request.get(path);
    expect(r.status(), path).toBe(401);
  }
  const result = await request.post("/api/tenant", {
    headers: { Origin: "https://untrusted.example" },
    data: { id: "00000000-0000-4000-8000-000000000000" },
  });
  expect(result.status()).toBe(403);
  for (const provider of ["evolution", "mercado-pago", "bravopay"]) {
    const r = await request.post("/api/webhooks/" + provider, {
      data: { fake: true },
    });
    expect([400, 401, 403, 503], provider).toContain(r.status());
  }
});
test("manifest and service worker expose offline resources without caching private API", async ({
  request,
}) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  expect((await manifest.json()).display).toBe("standalone");
  const sw = await request.get("/sw.js");
  expect(sw.ok()).toBe(true);
  const health = await request.get("/api/health");
  expect(health.ok()).toBe(true);
});
