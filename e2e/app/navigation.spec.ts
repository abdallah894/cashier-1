import { expect, test } from "@playwright/test";
import { ADMIN, CASHIER, messages, signIn } from "./helpers";

const nav = messages.en.nav;
const sidebar = (page: import("@playwright/test").Page) => page.locator("[data-slot='sidebar']");
// section headings only: "Reports" is both a section and a menu entry
const groupLabel = (page: import("@playwright/test").Page, text: string) =>
  sidebar(page).locator("[data-slot='sidebar-group-label']").getByText(text, { exact: true });

test.describe("navigation", () => {
  test("a cashier sees only the Sell section", async ({ page }) => {
    await signIn(page, CASHIER);
    await expect(groupLabel(page, nav.groups.sell)).toBeVisible();
    await expect(sidebar(page).getByRole("link", { name: nav.register, exact: true })).toBeVisible();
    for (const hidden of [nav.groups.stock, nav.groups.admin]) {
      await expect(groupLabel(page, hidden)).toHaveCount(0);
    }
    await expect(sidebar(page).getByRole("link", { name: nav.products, exact: true })).toHaveCount(0);
  });

  test("an admin sees every section, and the header names the page", async ({ page }) => {
    await signIn(page, ADMIN);
    for (const group of Object.values(nav.groups)) {
      await expect(groupLabel(page, group)).toBeVisible();
    }
    await sidebar(page).getByRole("link", { name: nav.importProducts, exact: true }).click();
    await expect(page).toHaveURL(/\/en\/products\/import$/);
    // the longest match wins: Import products is active, Products is not
    await expect(sidebar(page).getByRole("link", { name: nav.importProducts, exact: true })).toHaveAttribute("data-active", "true");
    await expect(sidebar(page).getByRole("link", { name: nav.products, exact: true })).not.toHaveAttribute("data-active", "true");
    await expect(page.locator("header").getByText(nav.importProducts, { exact: true })).toBeVisible();
  });

  test("a detail page has a way back in the header", async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto("/en/products/new");
    const back = page.locator("header").getByRole("link", { name: nav.products, exact: true });
    await expect(back).toBeVisible();
    await back.click();
    await expect(page).toHaveURL(/\/en\/products$/);
  });
});
