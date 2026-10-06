import { expect, test } from "@playwright/test";
import { CASHIER, RICE, SUGAR, latin, messages, openRegister, scan, signIn, type Locale } from "./helpers";

for (const locale of ["en", "ar"] as Locale[]) {
  test.describe(`a cash sale, keyboard only (${locale})`, () => {
    test("scan, pay, receipt", async ({ page }) => {
      const m = messages[locale];
      await signIn(page, CASHIER, locale);
      await openRegister(page, locale);

      // the page is laid out for the language
      await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");

      await scan(page, RICE); // 48.00
      await scan(page, SUGAR); // 38.50
      await expect(page.locator("[data-line]")).toHaveCount(2);
      await expect.poll(async () => latin((await page.getByTestId("cart-total").textContent()) ?? "")).toContain("86.50");

      // F2 opens payment; type the cash received and press Enter: no mouse
      await page.keyboard.press("F2");
      const received = page.getByLabel(m.register.checkoutDialog.tendered);
      await expect(received).toBeVisible();
      await received.fill("100");
      await expect(page.getByTestId("checkout-confirm")).toBeEnabled();
      await received.press("Enter");

      await expect(page).toHaveURL(/\/receipts\/[0-9a-f-]{36}/);
      await expect.poll(async () => latin((await page.getByTestId("receipt-total").first().textContent()) ?? "")).toContain("86.50");
    });
  });
}

test("a scanned barcode never lands in the payment box or confirms the sale", async ({ page }) => {
  await signIn(page, CASHIER);
  await openRegister(page);
  await scan(page, RICE);
  await page.keyboard.press("F2");
  const received = page.getByLabel(messages.en.register.checkoutDialog.tendered);
  await expect(received).toBeVisible();

  await scan(page, SUGAR); // a stray scan while paying
  await expect(page).toHaveURL(/\/register$/); // not confirmed
  await expect(received).toBeVisible();
  await expect(page.locator("[data-line]")).toHaveCount(1); // not added either
});

test("an amount that is clearly a barcode is refused as cash received", async ({ page }) => {
  await signIn(page, CASHIER);
  await openRegister(page);
  await scan(page, RICE);
  await page.keyboard.press("F2");
  const received = page.getByLabel(messages.en.register.checkoutDialog.tendered);
  await received.fill(SUGAR);
  await expect(page.getByTestId("checkout-confirm")).toBeDisabled();
  await expect(page.getByText(messages.en.register.checkoutDialog.tenderedTooLarge)).toBeVisible();
});
