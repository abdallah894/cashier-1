import { expect, test } from "@playwright/test";

test.describe("login page", () => {
  test("Arabic is right-to-left", async ({ page }) => {
    await page.goto("/ar/login");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    expect(await page.evaluate(() => getComputedStyle(document.body).direction)).toBe("rtl");
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.getByRole("button", { name: /\S/ }).first()).toBeVisible();
  });

  test("English is left-to-right", async ({ page }) => {
    await page.goto("/en/login");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  });

  test("the form is interactive (the page hydrated)", async ({ page }) => {
    await page.goto("/en/login");
    await page.locator("#email").fill("someone@example.com");
    await page.locator("#password").fill("secret-pass");
    await expect(page.locator("#email")).toHaveValue("someone@example.com");
    await expect(page.locator("#password")).toHaveAttribute("type", "password");
  });

  test("a bare address lands on the default language", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/(ar|en)\/login$/);
  });
});

test.describe("signed-out visitors", () => {
  for (const path of ["/ar/register", "/en/products", "/ar/reports", "/en/users", "/ar/shifts", "/en/receipts"]) {
    test(`${path} redirects to the login page`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/(ar|en)\/login$/);
      await expect(page.locator("#email")).toBeVisible();
    });
  }

  test("the locale of the requested page is kept", async ({ page }) => {
    await page.goto("/en/register");
    await expect(page).toHaveURL(/\/en\/login$/);
    await page.goto("/ar/register");
    await expect(page).toHaveURL(/\/ar\/login$/);
  });
});
