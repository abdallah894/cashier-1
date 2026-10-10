import { expect, test } from "@playwright/test";

const CSP_REPORT_ONLY = "content-security-policy-report-only";

test.describe("security headers", () => {
  test("every page carries the baseline headers", async ({ request }) => {
    const headers = (await request.get("/ar/login")).headers();
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["strict-transport-security"]).toContain("max-age=");
    expect(headers["permissions-policy"]).toContain("camera=(self)");
    expect(headers["permissions-policy"]).toContain("usb=(self)");
  });

  test("the policy is delivered in report-only mode by default", async ({ request }) => {
    const headers = (await request.get("/ar/login")).headers();
    expect(headers[CSP_REPORT_ONLY]).toBeTruthy();
    expect(headers["content-security-policy"]).toBeUndefined();
    expect(headers[CSP_REPORT_ONLY]).toContain("frame-ancestors 'none'");
    expect(headers[CSP_REPORT_ONLY]).toContain("object-src 'none'");
    // no JavaScript eval; 'wasm-unsafe-eval' (WebAssembly only) is allowed for the barcode decoder
    expect(headers[CSP_REPORT_ONLY]).not.toContain("'unsafe-eval'");
    expect(headers[CSP_REPORT_ONLY]).toContain("'wasm-unsafe-eval'");
  });

  test("the nonce changes on every request and matches the page's scripts", async ({ request }) => {
    const nonceOf = (csp: string) => /'nonce-([^']+)'/.exec(csp)?.[1];
    const first = await request.get("/en/login");
    const second = await request.get("/en/login");
    const n1 = nonceOf(first.headers()[CSP_REPORT_ONLY]);
    const n2 = nonceOf(second.headers()[CSP_REPORT_ONLY]);
    expect(n1).toBeTruthy();
    expect(n1).not.toBe(n2);

    const html = await first.text();
    // every INLINE script (no src) must carry this request's nonce, or an enforcing browser would block it
    const inline = [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]).filter((attrs) => !/\bsrc=/.test(attrs));
    expect(inline.length).toBeGreaterThan(0);
    for (const attrs of inline) expect(attrs).toContain(`nonce="${n1}"`);
  });

  test("the policy never breaks the page: no violation is reported while it loads and works", async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (/content security policy|\[report only\]|refused to (load|execute|apply|connect)/i.test(text)) problems.push(text);
    });
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
    await page.goto("/ar/login");
    await page.locator("#email").fill("a@b.co");
    await page.waitForLoadState("networkidle");
    expect(problems).toEqual([]);
  });
});

test.describe("public API routes", () => {
  test("the liveness check answers and never leaks details", async ({ request }) => {
    const response = await request.get("/api/health");
    expect([200, 503]).toContain(response.status());
    const body = await response.json();
    expect(Object.keys(body)).toEqual(["status"]);
    expect(["ok", "degraded"]).toContain(body.status);
  });

  test("the deep health check needs the ops token", async ({ request }) => {
    expect((await request.get("/api/health?deep=1")).status()).toBe(401);
    expect((await request.get("/api/health?deep=1", { headers: { authorization: "Bearer wrong-token-0123456789" } })).status()).toBe(401);
  });

  for (const path of ["/api/ops/check", "/api/ops/eta", "/api/ops/alerts"]) {
    test(`${path} refuses requests without the secret`, async ({ request }) => {
      const response = await request.get(path);
      expect(response.status()).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
    });
  }

  test("the backup report refuses requests without the secret", async ({ request }) => {
    const response = await request.post("/api/ops/backup-result", { data: { status: "ok" } });
    expect(response.status()).toBe(401);
  });

  test("the payment webhook is closed until it is configured and signed", async ({ request }) => {
    const response = await request.post("/api/payments/webhook/sandbox", { data: { eventId: "e1" } });
    expect([401, 503]).toContain(response.status());
    expect(JSON.stringify(await response.json())).not.toMatch(/relation|violates|postgres|select /i);
  });

  test("the assistant needs a signed-in user", async ({ request }) => {
    const response = await request.post("/api/assistant", { data: { message: "hi" } });
    expect([401, 403, 503]).toContain(response.status());
  });

  test("a CSP violation report is accepted quietly", async ({ request }) => {
    const response = await request.post("/api/csp-report", {
      headers: { "content-type": "application/csp-report" },
      data: { "csp-report": { "violated-directive": "script-src", "blocked-uri": "https://evil.example/x.js", "document-uri": "http://localhost/ar/login" } },
    });
    expect(response.status()).toBe(204);
  });

  test("an oversized or garbage violation report is ignored, not an error", async ({ request }) => {
    expect((await request.post("/api/csp-report", { data: "x".repeat(20_000) })).status()).toBe(204);
    expect((await request.post("/api/csp-report", { data: "{not json" })).status()).toBe(204);
  });
});

test.describe("installable app", () => {
  test("the web manifest describes a standalone app with icons", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.status()).toBe(200);
    const manifest = await response.json();
    expect(manifest.display).toBe("standalone");
    expect(manifest.name).toBeTruthy();
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
    expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === "maskable")).toBe(true);
  });

  test("the service worker script is served", async ({ request }) => {
    const response = await request.get("/sw.js");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("javascript");
  });
});
