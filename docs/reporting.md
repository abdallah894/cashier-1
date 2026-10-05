# Reporting, business day and reorder

Roadmap item 11. All figures are integer piasters; every report is admin-only
(`reports_guard`, enforced in SQL) and exportable as CSV.

## Business day (Cairo)

* A **business day** is the span from local midnight (plus an optional
  cutoff, default `00:00`) to the next, in the **store timezone**
  (default `Africa/Cairo`, editable in *Reports > Store settings*).
* The boundaries come from PostgreSQL's tz database, so they are exact across
  the Egyptian DST changes: one day a year is **23 hours** (clocks forward)
  and one is **25 hours** (clocks back). Consecutive days tile the timeline
  with no gap or overlap. `test-ops-reports.ts` checks every day of 2026.
* A sale belongs to the business day of its `created_at` (the server time it
  was recorded). An offline sale is therefore counted on the day it
  **syncs**; the till's own clock is kept in `sales.client_sold_at` for
  reference.
* **Closing a day** (*Reports > Daily close*) stores an immutable snapshot of
  that day's totals. Only a finished day can be closed, and only when no shift
  that started on it is still open.

## Gross vs net

| Term | Meaning |
| --- | --- |
| **Gross** | what the customer paid, VAT included (`sales.total`) |
| **Net / ex VAT** | revenue after extracting VAT line by line (`round(line_total / (1 + rate))`), exactly as `create_sale` does |
| **VAT on sales** | gross - net |
| **Refunds (gross)** | what was paid back; VAT refunded is reported at the original line's rate |
| **Cash / card (net)** | captured payments in that tender minus refunds paid out in it |

Profit uses net revenue and the **cost snapshot** stored on each sale line
(`sale_items.unit_cost`), so editing a product's cost never changes history.

## Reports

* **Daily close**: sales, gross, net, VAT, discounts (manual + promotion,
  with the count of manager-approved overrides), refunds, gross after refunds,
  cash/card net and cart voids per day; plus refund and void listings.
* **VAT**: per rate output VAT, VAT refunded, net output VAT and the input VAT
  paid on goods received. It is an operational summary for preparing a return:
  confirm the format with your accountant.
* **Stock movements**: opening, received, sold, returned, adjusted, closing.
* **Stock valuation**: quantity x moving-average cost, and retail value both
  gross and net of VAT.
* **Stock aging**: days since each product last sold, in buckets. The system
  keeps an average cost, not cost layers, so the age of a batch is not known.

## Low-stock alerts and reorder suggestions

* An **alert** opens when a product's stock falls to its low-stock threshold
  and resolves itself when stock recovers. One live alert per product; staff
  with the stock permission can acknowledge it, link a purchase order, or
  dismiss it with a note (a dismissed alert stays quiet until stock recovers).
* A **suggestion** is computed from stored inputs and shows all of them:

  ```
  avg_daily = net units sold (sales - returns) in the look-back window / look-back days
  need      = avg_daily x (lead time + cover days) + safety stock (the low-stock threshold)
  shortfall = need - stock - quantity already on open purchase orders
  suggested = round shortfall up to whole packs, at least the minimum order
  ```

  Lead time, pack size, minimum order and unit cost come from the **preferred
  supplier link** (`product_suppliers`), falling back to the store defaults.
  The *Why?* dialog and the CSV `explanation` column spell out the arithmetic.
* **Create draft order** turns one supplier's suggestions into a draft
  purchase order.
