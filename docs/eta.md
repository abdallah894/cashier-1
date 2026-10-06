# Egyptian Tax Authority (ETA) e-receipts — status and how to finish

**Status: the plumbing is built; the connection to the authority is NOT.** Nothing is ever sent to the authority today, and the app does not claim to be e-receipt compliant. Do not turn the feature on in production until every step under "Still missing" is done.

## Why it is only half built

The authority's technical specification (the document format, how the receipt UUID is produced, signing, authentication, and what must be printed on the paper receipt) is published at <https://sdk.invoicing.eta.gov.eg/>. That site could not be opened while this was written, so no document builder, signer or client was written from memory. A guessed implementation would either be rejected by the authority or, worse, be accepted with wrong data.

## What is built (provider-independent)

- `store_settings.eta_enabled` — off by default. Switch: **Reports → Store settings → Tax authority e-receipts** (admin).
- `eta_submissions` table (admin read only). While the switch is on, every new **sale and return** is queued by a database trigger **inside the same transaction** (one cheap insert, no network), so a portal outage can never stop the till. Sales made before the switch are not queued.
- Statuses: `queued → submitting → accepted | rejected | failed`.
  - `rejected`: the authority refused the document (needs a person).
  - `failed`: 8 temporary failures in a row (backoff 2, 4, 8 … up to 360 minutes).
  - A worker that crashes mid-send is recovered after 10 minutes — so a provider **must treat resubmitting the same document as safe**.
- `GET /api/ops/eta` (called every 30 minutes by `.github/workflows/ops-cron.yml` once you set the repository variable `ETA_QUEUE_ENABLED=true`; `CRON_SECRET`) drains the queue through the provider chosen by `ETA_PROVIDER`. With no provider it does nothing.
- Alerts (existing webhook): `eta_backlog` (warning: something waited over 30 minutes) and `eta_rejected` (critical: rejected or failed documents exist). Both are silent while the switch is off.
- `lib/eta/types.ts` (the `EtaProvider` interface), `lib/eta/worker.ts` (tested), `lib/eta/providers.ts` (the place a provider is registered).

## Still missing (needs you)

1. **Accountant:** confirm the shop must issue e-receipts now, and from which date.
2. **Registration:** register the shop and each till (POS) on the authority's portal and obtain the credentials and POS serial number(s). Start in the authority's **pre-production** environment.
3. **Read the official specification** and write one provider (for example `lib/eta/providers/eta-v1.ts`, implementing `EtaProvider.submit`) covering: building the receipt document from the sale snapshot (all needed data already exists in `sales`, `sale_items`, `returns`); the receipt UUID rules; signing (if required for receipts); authentication; mapping the response to `accepted` / `rejected` / `retry`. Register it in `lib/eta/providers.ts`.
4. **Secrets** in Vercel (server-only, never `NEXT_PUBLIC_`): whatever the provider needs (client id/secret, POS serial, environment). Set `ETA_PROVIDER` to the provider's name.
5. **Paper receipt:** print what the specification requires (typically the authority's identifier and QR). Today the receipt QR is only the sale number. Because the identifier may only exist after submission, check whether it must be computed before printing.
6. **Test** end to end in pre-production: a sale, a return, an offline sale that syncs later, a portal outage (documents wait, the till is unaffected), a rejected document (alert fires).
7. Only then switch **Queue sales and returns** on in production.

## Operating it

- See what is waiting: `select status, count(*) from eta_submissions group by 1;` (service role / SQL editor).
- A `rejected` or `failed` row keeps its reason in `last_error`. Fix the cause, then (SQL editor, service role) set it back: `update eta_submissions set status = 'queued', attempts = 0, next_attempt_at = now() where id = '…';`.
