# Security notes (headers, CSP, rate limits)

Database-level security (RLS, least-privilege grants, immutable ledgers) is described in the review and the migrations. This page covers the web layer added in Phase 2.

## Content-Security-Policy

A CSP tells the browser which scripts, connections and images the app may use, so an injected script cannot run or send data away. It is built per request in `proxy.ts` from `lib/security/csp.ts` and applies to the website, the Windows app and the Android app (they load the same site).

- Scripts need this request's **nonce**; Next.js stamps its own scripts, and the layout passes the nonce to the theme script (`lib/security/nonce.ts`). `'strict-dynamic'` lets those trusted scripts load their chunks.
- Allowed connections/images: this site and your Supabase project (taken from `NEXT_PUBLIC_SUPABASE_URL`). Nothing else.
- Also: no framing (`frame-ancestors 'none'`), no plugins, forms post only to this site, `upgrade-insecure-requests` when enforcing.

### Rollout (do this, in order)

1. Deploy with `CSP_MODE=report-only` (the default). The browser enforces nothing and sends a report for every violation to `/api/csp-report`, which logs `csp_violation` (directive, blocked address, page).
2. Use the shop normally for a few trading days: sell, print, scan with the camera, go offline, open every screen in Arabic and English, install the desktop and Android apps.
3. Search the logs for `csp_violation`. Each one is either something to allow (add it in `lib/security/csp.ts` with a test) or something that should not be happening.
4. When there are none, set `CSP_MODE=enforce` and redeploy. Keep watching the logs for a week. To roll back, set it back to `report-only`.

What has been verified: in a real browser, the sign-in page loads, hydrates and works under an **enforced** policy, every inline script carries the nonce, and an injected script is blocked (`e2e/public*`). **Not yet verified:** the signed-in screens (register, receipts, reports, camera scanning, PDF, printing) — that is exactly what step 2 is for. Do not skip it.

## Rate limits

- `/api/ops/*` (alerts, check, eta, backup report) and the payment webhook: **30 / 120 requests per minute per IP**, counted in the database so every server instance shares it (`consume_ip_rate_limit`). The check runs _before_ the secret check, so guessing a token is limited too. If the limiter itself fails, the request is let through (logged as `ip_rate_limit_unavailable`): the routes still require their secret, and a database hiccup must not stop the cron or payment callbacks.
- `/api/health`: 120 / minute per IP, in memory per server instance (a per-request database write would defeat a cheap check). The database answer is cached for 5 seconds.
- `/api/csp-report`: 30 / minute per IP, in memory, body limited to 8 KB.
- The assistant keeps its own per-user limits. Sign-in attempts are limited by Supabase Auth.
- Raw IP addresses are never stored: the key is a SHA-256 of the address.

## Errors reach you

- Server errors: `instrumentation.ts` logs one redacted line and posts to `ERROR_WEBHOOK_URL`.
- Page crashes in a browser: the error screen reports `client_render_error` (10 per minute per user) through the same webhook.
- Webhook responses carry fixed codes only; database error text never leaves the server.

## Known gaps (not done)

- **Cashiers can read product cost prices.** Row-level security cannot hide a column, and the offline catalog copies full product rows into the till's browser. Fixing it properly means moving cost into an admin-only table and giving the register a cost-free view of products. Planned; until then treat cost as visible to anyone with a cashier login.
- No CSP on the Electron "offline" page or the Android fallback page (local static files).
- Payment webhook has no timestamp/replay window beyond the event id de-duplication.
