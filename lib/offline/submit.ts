import { createSale } from "@/lib/actions/sales";
import type { OutboxEntry } from "./types";
import type { SubmitResult } from "./sync";

/** Answers that mean "try again later", not "this sale is wrong". */
const TRANSIENT_ERRORS = new Set(["checkoutFailed", "unknown"]);

/** Sends one queued cash sale through the same server action the live register uses. */
export async function submitQueuedSale(entry: OutboxEntry): Promise<SubmitResult> {
  // A thrown fetch (network loss) propagates: the drain keeps the sale queued.
  const result = await createSale({
    items: entry.items,
    payment_method: "cash",
    amount_tendered: entry.amountTendered,
    idempotencyKey: entry.id,
    shiftId: entry.shiftId ?? undefined,
    soldAt: entry.createdAt,
    // The till already printed a provisional total without promotions; applying
    // promotions at sync time would change what the customer paid.
    applyPromotions: false,
    // The receipt in the customer's hand says this total. If a price moved
    // while the till was offline the server refuses (totalChanged) and the sale
    // lands in Offline sales for a manager, instead of being recorded at a
    // different amount than the customer actually paid.
    expectedTotal: entry.provisional.total,
    customerId: entry.customerId ?? undefined,
  });

  if (result.ok) {
    return { kind: "synced", saleId: result.data.saleId, saleNumber: result.data.saleNumber };
  }
  // The session expired while offline: not the sale's fault. Pause the queue
  // (like a network loss) until the cashier signs in again.
  if (result.error === "notAuthorized") throw new Error("notAuthorized");
  if (TRANSIENT_ERRORS.has(result.error)) return { kind: "retry", error: result.error };
  return { kind: "rejected", error: result.error };
}
