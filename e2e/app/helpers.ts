import { expect, type Page } from "@playwright/test";
import { ean13CheckDigit } from "../../lib/barcode/weighed";
import en from "../../messages/en.json";
import ar from "../../messages/ar.json";

/**
 * Helpers for the signed-in tests. They run against a real Supabase seeded
 * with scripts/seed.ts (CI starts one with `supabase start`). UI text comes
 * from the real message files so a reworded label does not break the tests.
 */
export type Locale = "en" | "ar";
export const messages = { en, ar };

export const CASHIER = {
  email: process.env.SEED_CASHIER_EMAIL ?? "cashier@cachier.local",
  password: process.env.SEED_CASHIER_PASSWORD ?? "change-me-cashier",
};
export const ADMIN = {
  email: process.env.SEED_ADMIN_EMAIL ?? "admin@cachier.local",
  password: process.env.SEED_ADMIN_PASSWORD ?? "change-me-admin",
};

/** Barcode of seeded product N (scripts/seed.ts numbers them in file order). */
export function seedBarcode(n: number): string {
  const base = `622100${String(n).padStart(6, "0")}`;
  return base + ean13CheckDigit(base);
}
/** Egyptian Rice 1kg: EGP 48.00, VAT-exempt. */
export const RICE = seedBarcode(1);
/** Sugar 1kg: EGP 38.50, VAT-exempt. */
export const SUGAR = seedBarcode(2);

/** Arabic-Indic digits and separators → plain ASCII, so one assertion fits both languages. */
export function latin(text: string): string {
  return text
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/٫/g, ".")
    .replace(/٬/g, ",");
}

export async function signIn(page: Page, who: { email: string; password: string }, locale: Locale = "en") {
  await page.goto(`/${locale}/login`);
  await page.locator("#email").fill(who.email);
  await page.locator("#password").fill(who.password);
  await page.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** Opens the register and, if the shift gate is showing, opens a shift with a 100 EGP float. */
export async function openRegister(page: Page, locale: Locale = "en") {
  await page.goto(`/${locale}/register`);
  const gateInput = page.getByLabel(messages[locale].shifts.openingFloat);
  const total = page.getByTestId("cart-total");
  await expect(gateInput.or(total)).toBeVisible();
  if (await gateInput.isVisible()) {
    await gateInput.fill("100");
    await page.getByRole("button", { name: messages[locale].shifts.open, exact: true }).click();
  }
  await expect(total).toBeVisible();
}

/** A USB scanner is a keyboard that types the code in one quick burst and presses Enter. */
export async function scan(page: Page, code: string) {
  await page.keyboard.type(code);
  await page.keyboard.press("Enter");
}

/** Reads a table of the offline database straight from IndexedDB. */
export async function readOfflineStore(page: Page, store: "meta" | "outbox"): Promise<Array<Record<string, unknown>>> {
  // the till reloads data when it reconnects; a navigation mid-read just means "read again"
  for (let attempt = 0; ; attempt++) {
    try {
      return await readOfflineStoreOnce(page, store);
    } catch (error) {
      if (attempt >= 3 || !/context was destroyed|navigation/i.test(String(error))) throw error;
      await page.waitForLoadState("domcontentloaded");
    }
  }
}

function readOfflineStoreOnce(page: Page, store: "meta" | "outbox"): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(
    (storeName) =>
      new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
        const open = indexedDB.open("cachier-offline");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const request = open.result.transaction(storeName, "readonly").objectStore(storeName).getAll();
          request.onsuccess = () => resolve(request.result as Array<Record<string, unknown>>);
          request.onerror = () => reject(request.error);
        };
      }),
    store
  );
}
