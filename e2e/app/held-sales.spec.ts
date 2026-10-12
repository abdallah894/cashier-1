import { expect, test } from "@playwright/test";
import { CASHIER, RICE, SUGAR, latin, messages, openRegister, scan, signIn } from "./helpers";

const held = messages.en.register.held;
const total = async (page: import("@playwright/test").Page) => latin((await page.getByTestId("cart-total").textContent()) ?? "");

test("hold a sale, serve the next customer, then bring the first one back", async ({ page }) => {
  await signIn(page, CASHIER);
  await openRegister(page);

  // first customer: rice, then they go to find their wallet
  await scan(page, RICE);
  await expect(page.locator("[data-line]")).toHaveCount(1);
  await page.keyboard.press("F10");
  await expect(page.locator("[data-line]")).toHaveCount(0);
  await expect(page.locator('[data-shortcut="held-sales"]')).toContainText("1");

  // next customer: sugar
  await scan(page, SUGAR);
  await expect(page.locator("[data-line]")).toHaveCount(1);
  await expect.poll(() => total(page)).toContain("38.50");

  // first customer is back: recall swaps the carts, nothing is lost
  await page.keyboard.press("F3");
  const dialog = page.getByRole("dialog", { name: held.title });
  await expect(dialog.locator("[data-held-sale]")).toHaveCount(1);
  await dialog.getByRole("button", { name: held.recall }).click();
  await expect.poll(() => total(page)).toContain("48.00");
  await expect(page.locator('[data-shortcut="held-sales"]')).toContainText("1"); // the sugar cart is held now
});
