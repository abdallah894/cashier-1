import { expect, test } from "@playwright/test";

// Same app started with CSP_MODE=enforce: the policy now BLOCKS, so this proves
// the page still works with nothing but nonce-stamped scripts allowed.
test("enforced mode sends the blocking header", async ({ request }) => {
  const headers = (await request.get("/ar/login")).headers();
  expect(headers["content-security-policy"]).toContain("script-src 'self' 'nonce-");
  expect(headers["content-security-policy-report-only"]).toBeUndefined();
});

test("the login page loads, hydrates and is interactive under an enforced policy", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (/content security policy|refused to (load|execute|apply|connect)/i.test(message.text())) problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

  await page.goto("/en/login");
  await page.locator("#email").fill("a@b.co");
  await page.waitForLoadState("networkidle");
  // Next's client runtime is itself a nonce-stamped script: if it was blocked this is undefined
  const nextRuntime = await page.evaluate(() => (window as unknown as { next?: { version?: string } }).next?.version);
  expect(nextRuntime).toBeTruthy();
  await expect(page.locator("#email")).toHaveValue("a@b.co");
  expect(problems).toEqual([]);
});

test("injected scripts are blocked", async ({ page }) => {
  await page.goto("/en/login");
  // A parser-inserted inline script without the nonce is what an XSS payload looks like.
  // (Scripts created by trusted scripts are allowed by 'strict-dynamic' by design.)
  const ran = await page.evaluate(() => {
    document.open();
    document.write("<script>window.__injected = true<\/script>");
    document.close();
    return Boolean((window as unknown as { __injected?: boolean }).__injected);
  });
  expect(ran).toBe(false);
});
