import { test, expect } from "@playwright/test";
test.setTimeout(90000);
test("lifetime owner logs in, cannot access Master, and logout revokes the JWT", async ({
  page,
  context,
  baseURL,
}) => {
  test.skip(
    !process.env.E2E_OWNER_EMAIL || !process.env.E2E_OWNER_PASSWORD,
    "Provide test account through environment",
  );
  await page.goto("/login");
  await page
    .getByLabel("E-mail", { exact: true })
    .fill(process.env.E2E_OWNER_EMAIL!);
  await page
    .getByLabel("Senha", { exact: true })
    .fill(process.env.E2E_OWNER_PASSWORD!);
  await page.getByRole("button", { name: "Entrar na minha loja" }).click();
  await expect(page).toHaveURL(/\/app\/visao-geral/, { timeout: 45000 });
  await expect(
    page.getByRole("heading", { name: /^Olá,/ }),
  ).toBeVisible({ timeout: 30000 });
  await page.goto("/app/assinatura");
  await expect(
    page.getByRole("heading", { name: "Vitalício", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  expect((await context.request.get("/api/master")).status()).toBe(403);
  const cookie = (await context.cookies()).find((c) =>
    c.name.endsWith("pedizza-session"),
  )!;
  expect(cookie.httpOnly).toBe(true);
  if (baseURL?.startsWith("https:")) expect(cookie.secure).toBe(true);
  await page.getByRole("button", { name: "Sair da conta" }).click();
  await expect(page).toHaveURL(/\/login/);
  const replay = await context.request.get("/api/orders", {
    headers: { Cookie: `${cookie.name}=${cookie.value}` },
  });
  expect(replay.status()).toBe(401);
});
test("administrator is directed to the mandatory TOTP step", async ({
  page,
  context,
}) => {
  test.skip(
    !process.env.E2E_ADMIN_EMAIL || !process.env.E2E_ADMIN_PASSWORD,
    "Provide admin test account through environment",
  );
  await page.goto("/login");
  await page
    .getByLabel("E-mail", { exact: true })
    .fill(process.env.E2E_ADMIN_EMAIL!);
  await page
    .getByLabel("Senha", { exact: true })
    .fill(process.env.E2E_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Entrar na minha loja" }).click();
  await expect(page).toHaveURL(/\/master\/seguranca/, { timeout: 45000 });
  expect((await context.request.get("/api/master")).status()).toBe(403);
  expect((await context.request.get("/api/auth/mfa")).ok()).toBe(true);
});
