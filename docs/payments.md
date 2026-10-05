# Payments: lifecycle, providers and scope

This document covers roadmap item 09. It describes what is **built**, what is
**designed but not built**, and what the **business must decide** before a
real gateway is integrated.

## 1. What is built

### Payment records

Every movement of money is a row in `payments` (`supabase/migrations/20261010090000_payments.sql`):

| Field | Meaning |
| --- | --- |
| `direction` | `charge` (money in) or `refund` (money out) |
| `tender` | `cash` or `card` (never `split`; a split sale has several payments) |
| `provider` | `cash`, `manual_terminal`, `sandbox` |
| `provider_reference` | terminal approval code / RRN or provider id; **set once** |
| `amount` | integer piasters, never edited |
| `status` | `pending` → `authorized` → `captured`, or `declined` / `failed` / `voided` |
| `idempotency_key` | unique; a retried begin returns the same payment |
| `sale_id` / `return_id` | the sale a charge pays / the return a refund belongs to |
| `resolved_*` | how staff closed out an exception (note is mandatory) |

Allowed transitions are enforced by a trigger, not by the UI:

```
pending ──> authorized ──> captured
   │             ├──────> voided
   │             └──────> failed
   ├──────────────────> captured
   └──> declined | failed | voided        (captured/declined/failed/voided are final)
```

`payment_events` is an append-only log of every transition (staff, provider or
system) with the actor. `(provider, provider_event_id)` is unique.

### Sale tenders reconcile exactly

* A sale is paid by captured charges whose amounts add up to **exactly** the
  sale total. `create_sale` writes the payment rows in the same transaction.
* **Cash**: one captured cash payment equal to the total (not the cash handed
  over; change is not a payment).
* **Card**: needs a terminal approval reference (`p_card_reference`) or
  already-captured card payments (`p_payment_ids`). A missing, card-number-shaped
  or reused reference is refused.
* **Split (card + cash)**: captured card payments cover part of the total, the
  rest is cash. The sale is stored as `payment_method = 'split'`; change is
  computed on the cash remainder only. The checkout UI does not offer split
  yet; the database and API support it and are tested.
* `report_payment_reconciliation` lists any sale whose captured payments differ
  from its total (should always be empty).

### Refunds follow the tender actually paid

`create_return` now caps a refund **per tender**: what was paid in that tender
minus what was already refunded in it. A refund must use a tender the customer
paid with (a split sale can be refunded to either). Each return creates a
refund payment: cash is captured at once (and already hits the drawer ledger);
card stays **pending until staff confirm the refund on the terminal**.

### Duplicate callbacks cannot duplicate anything

A provider callback can only move the status of an **existing** payment via
`apply_provider_event` (service role only). It can never create a sale or a
refund, so a replay has nothing to duplicate. Beyond that:

* the same `(provider, event id)` is applied once; replays answer `duplicate`;
* an amount that differs from the payment is refused (`amount mismatch`) and
  not recorded as processed;
* a late, out-of-order event (for example `authorized` after `captured`) is
  logged and ignored;
* `/api/payments/webhook/sandbox` verifies an HMAC-SHA256 `x-signature` over the
  raw body in constant time and answers 503 until
  `PAYMENT_SANDBOX_WEBHOOK_SECRET` is set.

### Staff-visible recovery

`/payments` (all roles; cashiers see their own payments through RLS) lists what
needs a human:

| State | Meaning | Staff action |
| --- | --- | --- |
| Awaiting terminal result | charge still pending/authorized | confirm with the approval code, or mark declined/failed/voided |
| Charged, no sale | captured but linked to no sale | re-ring or refund, then (admin) resolve with a note |
| Refund to confirm | card refund recorded, not yet done on the terminal | confirm with the terminal reference |
| Refund failed | refund declined/failed | settle with the customer, then (admin) resolve |

Admins also get the tender summary (charges, refunds, net by tender/provider)
and the reconciliation report, both exportable.

## 2. Providers

| Provider | Status | Notes |
| --- | --- | --- |
| `cash` | built | recorded by the sale |
| `manual_terminal` | built | cashier charges a bank POS terminal, records the approval code |
| `sandbox` | built (test double) | exercises begin → signed callback → capture |
| Real gateway | **not built** | needs a business decision (below) |

### Decision needed from the business

Which card acquirer/gateway will the store use? Candidates commonly used in
Egypt include **Paymob**, **Fawry**, **Geidea**, **Nearpay**, and the POS
terminals and APIs of the store's own bank. Pick one only after confirming
with the bank/provider: the available API (cloud vs terminal-integrated),
settlement fees, refund/void support, Arabic receipt requirements and local
regulatory requirements (Central Bank of Egypt rules). Until then
`manual_terminal` is the supported production path and needs no integration.

To add a gateway: create its webhook route that verifies the gateway's own
signature and calls `apply_provider_event`, add a provider id to
`lib/payments/providers.ts`, and widen the `payments.provider` CHECK in a new
migration. The sandbox route is the template.

## 3. Designed, not built: voucher, store credit, gift card

Do **not** implement these until the accounting rules below are agreed.

* **Representation**: a stored-value *instrument* with an immutable
  **balance ledger** (`issue`, `redeem`, `refund_to_balance`, `expire`,
  `adjust`); the balance is a sum, never a mutable number.
* **Tender**: redeeming is a `payments` row with a new tender (`voucher`,
  `store_credit`, `gift_card`), `provider = 'stored_value'`, linked to the
  instrument. It participates in split tender like card does; redemption and
  the sale are one transaction so a balance cannot be spent twice.
* **Rules to define**: liability account and VAT point of recognition
  (issue vs. redemption), expiry and unclaimed-balance policy, refunds to the
  instrument vs. to the original tender, cash-out policy and limits, fraud
  limits, and who may issue or adjust (new capability, manager approval).
* **Refunds**: a refund of a stored-value payment must return to the instrument.
  The per-tender refund cap built here already models this.

## 4. PCI DSS scope note

**Design goal: keep the POS outside cardholder-data scope.**

* The POS **never receives, transmits or stores** a card number (PAN), expiry,
  CVV or track data. The cashier uses a bank terminal that talks to the
  acquirer; the POS records only the terminal's **approval code / RRN** and the
  amount.
* `provider_reference` rejects card-number-shaped values (13-19 digits) in the
  database (`valid_payment_reference`), the server actions and the checkout
  field, so a PAN cannot be typed in by mistake.
* Webhook secrets are server-only environment variables; nothing sensitive is
  logged (callback logs carry event id and error text only).
* With a bank-supplied terminal this is a **SAQ-P2PE/SAQ-A-style** posture for
  the merchant, but the actual validation level is set by the acquirer. Confirm
  the applicable SAQ with the bank before go-live.
* If a gateway integration ever collects card data in the browser, that
  integration must use the gateway's hosted fields/redirect (so card data never
  touches this app) and this note must be revisited.

## 5. Tests

* `npm run test:all` runs `test-payments.ts` (state machine, idempotency,
  exact tender reconciliation, split tender, per-tender refunds, provider
  callbacks, recovery, RLS) and `test-payment-webhook.ts` (HMAC verification,
  event schema, PAN guard) on every change.
* Sandbox integration: with `PAYMENT_SANDBOX_WEBHOOK_SECRET` set, post a signed
  body to `/api/payments/webhook/sandbox`:

  ```bash
  body='{"eventId":"evt-1","reference":"SBX-1","status":"captured","amount":5000}'
  sig=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$PAYMENT_SANDBOX_WEBHOOK_SECRET" -hex | sed 's/^.* //')
  curl -X POST http://localhost:3000/api/payments/webhook/sandbox \
    -H "x-signature: $sig" -H "content-type: application/json" -d "$body"
  ```

  Re-posting the same body answers `{"status":"duplicate"}`.
