import { expect, test } from "@playwright/test";
import { CASHIER, RICE, SUGAR, latin, openRegister, scan, signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page, CASHIER);
  await openRegister(page);
});

test("3* then a scan adds three", async ({ page }) => {
  await page.keyboard.press("/");
  await page.keyboard.type("3*");
  await page.keyboard.press("Enter");
  await scan(page, RICE); // 3 x 48.00
  await expect.poll(async () => latin((await page.getByTestId("cart-total").textContent()) ?? "")).toContain("144.00");
  await expect(page.locator("[data-line]")).toHaveCount(1);
});

test("plus and minus work from the empty search box", async ({ page }) => {
  await scan(page, RICE);
  await page.keyboard.press("/"); // focus the (empty) search box
  await page.keyboard.press("+");
  await expect.poll(async () => latin((await page.getByTestId("cart-total").textContent()) ?? "")).toContain("96.00");
  await page.keyboard.press("-");
  await expect.poll(async () => latin((await page.getByTestId("cart-total").textContent()) ?? "")).toContain("48.00");
});

test("arrow keys move between lines and Delete removes the selected one", async ({ page }) => {
  await scan(page, RICE);
  await scan(page, SUGAR);
  await expect(page.locator("[data-line]")).toHaveCount(2);
  await page.keyboard.press("ArrowUp"); // select the first line (rice)
  await page.keyboard.press("Delete");
  await expect(page.locator("[data-line]")).toHaveCount(1);
  await expect.poll(async () => latin((await page.getByTestId("cart-total").textContent()) ?? "")).toContain("38.50");
});

test("F5 opens the sale discount instead of reloading the till", async ({ page }) => {
  await scan(page, RICE);
  await page.keyboard.press("F5");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator("[data-line]")).toHaveCount(1); // the cart survived: the page did not reload
});

test("F4 opens the discount of the selected line", async ({ page }) => {
  await scan(page, RICE);
  await page.keyboard.press("F4");
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("Ctrl+Delete opens the void-cart confirmation", async ({ page }) => {
  await scan(page, RICE);
  await page.keyboard.press("Control+Delete");
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("F7 focuses the promo code box", async ({ page }) => {
  await scan(page, RICE);
  await page.keyboard.press("F7");
  await expect(page.locator('[data-shortcut="promo-code"]')).toBeFocused();
});
