import { expect, test } from "@playwright/test";

/**
 * Offline page loads go through the service worker: a page saved on this
 * device opens from the saved copy, anything else shows the bilingual
 * offline page instead of the browser's "unable to connect".
 */
// Playwright's setOffline does not reach requests the service worker makes, so
// "offline" here means every request is refused (PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS
// lets context.route see the worker's own fetches).
async function goOffline(context: import("@playwright/test").BrowserContext) {
  await context.setOffline(true);
  await context.route("**/*", (route) => route.abort("internetdisconnected"));
}
async function goOnline(context: import("@playwright/test").BrowserContext) {
  await context.unroute("**/*");
  await context.setOffline(false);
}

test.describe("offline page loads", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/en/login");
    // wait until the service worker controls the page
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
      }
    });
  });

  test("a page never saved shows the offline page, not the browser error", async ({ page, context }) => {
    await goOffline(context);
    await page.goto("/ar/reports");
    await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to register" })).toHaveAttribute("href", "/en/register");
    await goOnline(context);
  });

  test("a page the app saved ahead of time opens offline", async ({ page, context }) => {
    // the app asks the worker to save pages (it does this for the register and pending sales)
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      registration.active?.postMessage({ type: "WARM_PAGES", urls: ["/ar/login"] });
    });
    await expect
      .poll(() => page.evaluate(async () => !!(await (await caches.open("offline-pages")).match("/ar/login"))))
      .toBe(true);
    await goOffline(context);
    await page.goto("/ar/login");
    await expect(page.locator("#email")).toBeVisible();
    await goOnline(context);
  });

  test("going back online does not reload the page", async ({ page, context }) => {
    await page.evaluate(() => {
      (window as unknown as { marker: number }).marker = 42;
    });
    await context.setOffline(true);
    await context.setOffline(false);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { marker?: number }).marker)).toBe(42);
  });
});
