import { expect, test } from "@playwright/test";
import { CASHIER, RICE, messages, openRegister, readOfflineStore, scan, signIn } from "./helpers";

test("a sale rung while offline shows its receipt on the register and syncs once, later", async ({ page, context }) => {
  test.setTimeout(120_000); // catalog copy + offline sale + sync after reconnect
  await signIn(page, CASHIER);
  await openRegister(page);

  // the till copies the catalog to the browser in the background: wait for that before cutting the network
  await expect
    .poll(async () => (await readOfflineStore(page, "meta")).some((row) => row.key === "catalogRefreshedAt"), { timeout: 30_000 })
    .toBe(true);

  await context.setOffline(true);
  await scan(page, RICE);
  await expect(page.locator("[data-line]")).toHaveCount(1);
  await page.keyboard.press("F2");
  const received = page.getByLabel(messages.en.register.checkoutDialog.tendered);
  await received.fill("100");
  await received.press("Enter");

  // the receipt is shown in place: no navigation to a page that cannot load offline
  const receipt = page.getByTestId("provisional-receipt");
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText("P-");
  await page.getByTestId("provisional-receipt-close").click();
  await expect(receipt).toBeHidden();
  await expect(page).toHaveURL(/\/register$/);

  const queued = await readOfflineStore(page, "outbox");
  expect(queued.filter((row) => row.status === "queued")).toHaveLength(1);

  // back online: it is sent exactly once
  await context.setOffline(false);
  await expect
    .poll(async () => (await readOfflineStore(page, "outbox")).map((row) => row.status), { timeout: 60_000 })
    .toEqual(["synced"]);
});
