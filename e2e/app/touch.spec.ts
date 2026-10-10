import { expect, test } from "@playwright/test";
import { CASHIER, latin, messages, openRegister, signIn } from "./helpers";

const m = messages.en.register;

test("a whole sale by touch: tile, keypad quantity, on-screen cash", async ({ page }) => {
  await signIn(page, CASHIER);
  await openRegister(page);

  // tiles come from the offline catalog, filled by the background sync
  await page.getByRole("button", { name: "Groceries", exact: true }).click();
  await page.locator("[data-product-tile]", { hasText: "Egyptian Rice 1kg" }).click(); // 48.00
  await expect(page.locator("[data-line]")).toHaveCount(1);

  // tap the quantity, type 3 on the keypad
  await page.locator("[data-line]").getByRole("button", { name: m.qtyEdit, exact: true }).click();
  const qtyPad = page.getByRole("dialog");
  await qtyPad.getByRole("button", { name: "3", exact: true }).click();
  await qtyPad.getByRole("button", { name: m.qtySet }).click();
  await expect.poll(async () => latin((await page.getByTestId("cart-total").textContent()) ?? "")).toContain("144.00");

  // pay: 200 on the on-screen keypad, change 56
  await page.getByRole("button", { name: m.checkout }).click();
  const pay = page.getByRole("dialog");
  for (const key of ["2", "0", "0"]) await pay.getByRole("button", { name: key, exact: true }).click();
  await expect(pay.getByLabel(m.checkoutDialog.tendered)).toHaveValue("200");
  await expect.poll(async () => latin((await page.getByTestId("checkout-change").textContent()) ?? "")).toContain("56.00");
  await page.getByTestId("checkout-confirm").click();
  await expect(page).toHaveURL(/\/receipts\/[0-9a-f-]{36}/);
});

test("? lists every keyboard shortcut", async ({ page }) => {
  await signIn(page, CASHIER);
  await openRegister(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); // "?" in a text box is just typing
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: m.shortcuts.title })).toBeVisible();
});
