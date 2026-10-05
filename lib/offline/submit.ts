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
