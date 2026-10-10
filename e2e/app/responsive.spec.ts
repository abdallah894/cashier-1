import { test, expect, type Page } from "@playwright/test";
import { ADMIN, signIn, type Locale } from "./helpers";

/**
 * Every signed-in page, from a phone (390px) to a wide monitor (2000px), in
 * English and Arabic (RTL): the page itself must never scroll sideways.
 * Wide tables may scroll inside their own box — that is allowed.
 */
const WIDTHS = [390, 768, 1024, 1366, 2000] as const;
const LOCALES: Locale[] = ["en", "ar"];

const LIST_ROUTES = [
  "/register",
  "/receipts",
  "/shifts",
  "/payments",
  "/offline-sales",
  "/products",
  "/products/new",
  "/products/import",
  "/categories",
  "/stock-alerts",
  "/stocktakes",
  "/purchase-orders",
  "/purchase-orders/new",
  "/purchase-orders/reports",
  "/suppliers",
  "/customers",
  "/promotions",
  "/reports",
  "/reports/daily",
  "/reports/reorder",
  "/reports/stock",
  "/reports/vat",
  "/users",
  "/devices",
  "/audit",
];

/** Detail pages: the first link of this shape found on the list page. */
const DETAIL_FROM: Array<{ list: string; pattern: RegExp }> = [
  { list: "/receipts", pattern: /\/receipts\/[0-9a-f-]{36}$/ },
  { list: "/shifts", pattern: /\/shifts\/[0-9a-f-]{36}$/ },
  { list: "/products", pattern: /\/products\/[0-9a-f-]{36}$/ },
  { list: "/customers", pattern: /\/customers\/[0-9a-f-]{36}$/ },
  { list: "/stocktakes", pattern: /\/stocktakes\/[0-9a-f-]{36}$/ },
  { list: "/purchase-orders", pattern: /\/purchase-orders\/[0-9a-f-]{36}$/ },
  { list: "/offline-sales", pattern: /\/offline-sales\/[^/]+$/ },
];

type Finding = { route: string; width: number; locale: Locale; overflow: number; culprits: string[] };

async function measure(page: Page): Promise<{ overflow: number; culprits: string[] }> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const viewport = root.clientWidth;
    const overflow = root.scrollWidth - viewport;
    const clipped = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") return true;
      }
      return false;
    };
    const describe = (el: Element) => {
      const id = el.id ? `#${el.id}` : "";
      const cls = typeof el.className === "string" ? `.${el.className.trim().split(/\s+/).slice(0, 6).join(".")}` : "";
      const text = (el.textContent ?? "").trim().slice(0, 30);
      return `${el.tagName.toLowerCase()}${id}${cls} "${text}"`;
    };
    const offenders: Element[] = [];
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (getComputedStyle(el).position === "fixed") continue;
      if (rect.right <= viewport + 1 && rect.left >= -1) continue;
      if (clipped(el)) continue;
      // only the outermost offender: its children are the same problem
      if (offenders.some((o) => o.contains(el))) continue;
      offenders.push(el);
      if (offenders.length >= 8) break;
    }
    const culprits = offenders.map(describe);
    return { overflow, culprits: overflow > 1 ? culprits : [] };
  });
}

test.describe.configure({ mode: "parallel" });

for (const locale of LOCALES) {
  test(`no sideways page scroll on any page (${locale})`, async ({ page }) => {
    test.setTimeout(600_000);
    await signIn(page, ADMIN, locale);

    const routes = [...LIST_ROUTES];
    for (const { list, pattern } of DETAIL_FROM) {
      await page.goto(`/${locale}${list}`);
      const hrefs = await page.locator("main a[href]").evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
      const hit = hrefs.find((href) => pattern.test(href));
      if (hit) routes.push(hit.replace(`/${locale}`, ""));
    }

    const findings: Finding[] = [];
    for (const route of routes) {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
        await page.goto(`/${locale}${route}`);
        // the till keeps syncing in the background, so "network idle" may never come
        await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
        const { overflow, culprits } = await measure(page);
        if (overflow > 1) findings.push({ route, width, locale, overflow, culprits });
      }
    }

    console.log(`responsive findings (${locale}): ${JSON.stringify(findings, null, 2)}`);
    expect(findings, "pages that scroll sideways").toEqual([]);
  });
}
