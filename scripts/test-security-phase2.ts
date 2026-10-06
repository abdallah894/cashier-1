/** Phase 2: CSP builder, in-memory and database rate limits. */
import { buildCsp, cspHeaderName, cspMode, newNonce } from "../lib/security/csp";
import { nonceFromHeaders } from "../lib/security/nonce";
import { clientIp, ipRateLimitKey, memoryRateLimit, resetMemoryRateLimits } from "../lib/ops/rate-limit-core";
import { createTestDb, asUser, asAdminService, seedUser } from "./lib/pglite-db";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}
const has = (csp: string, directive: string, value: string) => csp.split("; ").some((d) => d.startsWith(directive + " ") && d.split(" ").includes(value));

// ---- CSP ----
const prod = buildCsp({ nonce: "abc123", supabaseUrl: "https://proj.supabase.co" });
check("scripts need the request nonce", has(prod, "script-src", "'nonce-abc123'") && has(prod, "script-src", "'strict-dynamic'"));
check("production never allows eval or inline scripts", !prod.includes("unsafe-eval") && !/script-src[^;]*'unsafe-inline'/.test(prod));
check("the Supabase origin may be called and its images shown", has(prod, "connect-src", "https://proj.supabase.co") && has(prod, "connect-src", "wss://proj.supabase.co") && has(prod, "img-src", "https://proj.supabase.co"));
check("the page cannot be framed, embedded as an object, or re-based", has(prod, "frame-ancestors", "'none'") && has(prod, "object-src", "'none'") && has(prod, "base-uri", "'self'"));
check("forms can only post to this site", has(prod, "form-action", "'self'"));
check("violations are reported to our endpoint", has(prod, "report-uri", "/api/csp-report"));
check("insecure requests are upgraded when enforcing in production", prod.split("; ").includes("upgrade-insecure-requests"));
check("but not in report-only mode, where browsers ignore it and warn", !buildCsp({ nonce: "n", supabaseUrl: "https://proj.supabase.co", enforce: false }).includes("upgrade-insecure-requests"));
check("camera/worker features still work (blob workers and media)", has(prod, "worker-src", "blob:") && has(prod, "media-src", "blob:"));
const dev = buildCsp({ nonce: "n", supabaseUrl: "http://127.0.0.1:54321", dev: true });
check("development allows eval and local sockets for hot reload", has(dev, "script-src", "'unsafe-eval'") && dev.includes("ws://localhost:*") && !dev.includes("upgrade-insecure-requests"));
check("a local http Supabase gets ws:// not wss://", has(dev, "connect-src", "ws://127.0.0.1:54321"));
const broken = buildCsp({ nonce: "n", supabaseUrl: "not a url" });
check("an unparsable Supabase URL allows no extra origin and does not throw", !broken.includes("supabase") && has(broken, "connect-src", "'self'"));
check("report-only is the default mode", cspMode(undefined) === "report-only" && cspMode("") === "report-only" && cspMode("nonsense") === "report-only");
check("enforce must be asked for explicitly", cspMode("enforce") === "enforce" && cspMode(" ENFORCE ") === "enforce");
check("header name follows the mode", cspHeaderName("enforce") === "Content-Security-Policy" && cspHeaderName("report-only") === "Content-Security-Policy-Report-Only");
const n1 = newNonce(), n2 = newNonce();
check("nonces are unique and base64", n1 !== n2 && /^[A-Za-z0-9+/=]+$/.test(n1) && n1.length >= 40);

// ---- nonce lookup ----
check("the nonce comes from x-nonce first", nonceFromHeaders(new Headers({ "x-nonce": "abc", "content-security-policy": "script-src 'nonce-zzz'" })) === "abc");
check("or from the CSP header", nonceFromHeaders(new Headers({ "content-security-policy": "default-src 'self'; script-src 'self' 'nonce-QUJD' 'strict-dynamic'" })) === "QUJD");
check("or from the report-only header", nonceFromHeaders(new Headers({ "content-security-policy-report-only": "script-src 'nonce-REVG'" })) === "REVG");
check("no nonce when there is no policy", nonceFromHeaders(new Headers()) === undefined);

// ---- in-memory limiter ----
resetMemoryRateLimits();
{
  const t0 = 1_000_000;
  const r = [1, 2, 3, 4].map(() => memoryRateLimit("k", 3, 60_000, t0));
  check("requests up to the limit pass", r.slice(0, 3).every((x) => x.allowed));
  check("the next one is refused with a retry time", !r[3].allowed && r[3].retryAfterSeconds === 60);
  check("another key is unaffected", memoryRateLimit("other", 3, 60_000, t0).allowed);
  check("the window resets", memoryRateLimit("k", 3, 60_000, t0 + 60_001).allowed);
  check("retry-after shrinks as the window runs down", memoryRateLimit("k", 3, 60_000, t0 + 60_002).allowed && memoryRateLimit("k", 1, 60_000, t0 + 90_000).retryAfterSeconds <= 31);
}

// ---- helpers ----
check("the first forwarded address is the client", clientIp(new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } })) === "1.2.3.4");
check("falls back to x-real-ip then unknown", clientIp(new Request("http://x", { headers: { "x-real-ip": "5.6.7.8" } })) === "5.6.7.8" && clientIp(new Request("http://x")) === "unknown");
const key = ipRateLimitKey("ops", "1.2.3.4");
check("the stored key never contains the raw address and fits the column", !key.includes("1.2.3.4") && key.startsWith("ops:") && key.length <= 100 && key === ipRateLimitKey("ops", "1.2.3.4") && key !== ipRateLimitKey("ops", "1.2.3.5"));

// ---- database limiter ----
async function database() {
  const db = await createTestDb();
  await seedUser(db, "00000000-0000-0000-0000-00000000000b", "cashier", "cashier");
  await asAdminService(db);
  const hit = async (k: string, limit = 3, window = 60) => (await db.query<{ allowed: boolean; remaining: number; retry_after_seconds: number }>(`select * from public.consume_ip_rate_limit('${k}', ${limit}, ${window})`)).rows[0];
  const a = [await hit("ops:abc"), await hit("ops:abc"), await hit("ops:abc"), await hit("ops:abc")];
  check("database: calls up to the limit are allowed", a.slice(0, 3).every((r) => r.allowed) && a[2].remaining === 0);
  check("database: the next call is refused with a retry time", !a[3].allowed && a[3].retry_after_seconds >= 1 && a[3].retry_after_seconds <= 60);
  check("database: keys are independent", (await hit("ops:other")).allowed);
  for (const [name, sql] of [["an empty key", `select * from public.consume_ip_rate_limit('', 3, 60)`], ["a huge key", `select * from public.consume_ip_rate_limit('${"x".repeat(101)}', 3, 60)`], ["a zero limit", `select * from public.consume_ip_rate_limit('k', 0, 60)`], ["a zero window", `select * from public.consume_ip_rate_limit('k', 3, 0)`]] as const) {
    try {
      await db.query(sql);
      check(`database: ${name} is refused`, false, "no error");
    } catch (e) {
      check(`database: ${name} is refused`, (e as Error).message.includes("invalid arguments"));
    }
  }
  await asUser(db, "00000000-0000-0000-0000-00000000000b");
  try {
    await db.query(`select * from public.consume_ip_rate_limit('k', 3, 60)`);
    check("database: a signed-in user cannot call it", false, "no error");
  } catch (e) {
    check("database: a signed-in user cannot call it", (e as Error).message.includes("permission denied"));
  }
}

database().then(() => {
  if (failures > 0) {
    console.error(`\n${failures} check(s) failing`);
    process.exit(1);
  }
  console.log("\nPhase 2 security tests passed.");
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
