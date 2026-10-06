import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests (Phase 2). Two tiers:
 *  - `public` / `public-enforce`: need only a built app with dummy Supabase
 *    settings (login page, redirects, security headers, CSP, public API
 *    routes). They run anywhere, including a laptop without Docker.
 *  - `app`: signed-in till flows. They need a real Supabase (CI starts one
 *    with `supabase start` and seeds it; see .github/workflows/ci.yml).
 *
 * The app must be built first (`npm run build`) with the SAME NEXT_PUBLIC_*
 * values the tests run with: Next inlines them at build time.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const ENFORCE_PORT = PORT + 1;

const serverEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "dummy-publishable-key",
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "dummy-service-role-key",
  OPS_API_TOKEN: process.env.OPS_API_TOKEN ?? "e2e-ops-token-0123456789abcdef",
  CRON_SECRET: process.env.CRON_SECRET ?? "e2e-cron-secret-0123456789abcdef",
};

const server = (port: number, cspMode: string) => ({
  command: `npx next start -p ${port}`,
  // not /api/health: it answers 503 when the database is unreachable, which Playwright reads as "not ready"
  url: `http://localhost:${port}/manifest.webmanifest`,
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
  env: { ...serverEnv, CSP_MODE: cspMode, PORT: String(port) } as Record<string, string>,
});

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: [server(PORT, "report-only"), server(ENFORCE_PORT, "enforce")],
  projects: [
    { name: "public", testDir: "./e2e/public", use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${PORT}` } },
    { name: "public-enforce", testDir: "./e2e/public-enforce", use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${ENFORCE_PORT}` } },
    {
      name: "app",
      testDir: "./e2e/app",
      // a till is a landscape counter screen
      use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 }, baseURL: `http://localhost:${PORT}` },
    },
  ],
});
