import { expect, test } from "@playwright/test";
import { ADMIN, CASHIER, signIn } from "./helpers";

test.describe("who can open what", () => {
  test("a cashier lands on the register, not a placeholder", async ({ page }) => {
    await signIn(page, CASHIER);
    await expect(page).toHaveURL(/\/en\/register$/);
  });

  test("an admin lands on the reports", async ({ page }) => {
    await signIn(page, ADMIN);
    await expect(page).toHaveURL(/\/en\/reports$/);
  });

  for (const path of ["/en/users", "/en/products", "/en/products/new", "/en/reports", "/en/devices", "/en/audit", "/en/suppliers", "/en/categories"]) {
    test(`a cashier cannot open ${path}`, async ({ page }) => {
      await signIn(page, CASHIER);
      await page.goto(path);
      await expect(page).toHaveURL(/\/en\/register$/);
    });
  }

  test("an admin can open the staff list", async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto("/en/users");
    await expect(page).toHaveURL(/\/en\/users$/);
    await expect(page.getByRole("table")).toBeVisible();
  });

  test("a wrong password is refused and stays on the login page", async ({ page }) => {
    await page.goto("/en/login");
    await page.locator("#email").fill(CASHIER.email);
    await page.locator("#password").fill("definitely-not-the-password");
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/en\/login/);
    await expect(page.getByRole("alert").or(page.locator("[data-slot='field-error']")).first()).toBeVisible();
  });
});
