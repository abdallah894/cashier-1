# Testing

| What                         | Command                                  | Needs                            | Covers                                                                                                                     |
| ---------------------------- | ---------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Unit + database suites (40+) | `npm run test:all`                       | nothing (in-memory Postgres)     | money, checkout, RLS, offline outbox, returns, payments, ETA queue, CSP builder, rate limits …                             |
| Types, lint                  | `npm run typecheck`, `npm run lint`      | —                                |                                                                                                                            |
| Migrations                   | `npx tsx scripts/validate-migrations.ts` | nothing                          | naming, RLS on every table, pinned search_path, generated types in sync                                                    |
| Browser tests, no backend    | `npm run build` then `npm run test:e2e`  | Chromium                         | sign-in page in Arabic (RTL) and English, redirects, security headers, CSP report-only **and enforced**, public API routes |
| Browser tests, signed in     | `npm run test:e2e:app`                   | a seeded local Supabase (Docker) | cashier sale by keyboard in AR and EN, scanner safety, shortcuts, offline sale and sync, who can open what                 |

Build with the same `NEXT_PUBLIC_SUPABASE_*` values the browser tests use (the defaults in `playwright.config.ts` match the CI build); Next.js bakes them in at build time.

## The signed-in browser tests

They need `supabase start` (Docker), `npm run seed` and a build against that Supabase; CI does this in the `e2e-app` job. That job is **not required yet**: the specs were written without being able to run them, so expect to fix a selector or two on the first run. Make it required (remove `continue-on-error`) after it has passed once.

## Not covered by automated browser tests yet

Returns, shift close with a cash variance and manager PIN, printing on real hardware, camera scanning, the Windows and Android shells, pixel-level layout (visual snapshots are platform-dependent; add them once CI is the single reference platform).
