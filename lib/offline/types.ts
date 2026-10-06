import type { ReceiptLine, VatBreakdownRow } from "@/lib/receipts/types";

export type OutboxStatus = "queued" | "syncing" | "synced" | "rejected" | "resolved";

export type QueuedSaleItem = { product_id: string; qty: number; line_discount: number };

/** Everything needed to print a provisional receipt before the server has numbered the sale. */
export type ProvisionalReceipt = {
  lines: ReceiptLine[];
  vatBreakdown: VatBreakdownRow[];
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  total: number;
  amountTendered: number;
  changeDue: number;
  cashierName: string | null;
};

/**
 * One queued cash sale. `id` doubles as the server idempotency key, so a
 * retry can never create a second sale. Money is integer piasters.
 */
export type OutboxEntry = {
  id: string;
  userId: string;
  shiftId: string | null;
  items: QueuedSaleItem[];
  amountTendered: number;
  provisional: ProvisionalReceipt;
  /** Customer attached when the sale was rung (absent on entries queued before this field existed). */
  customerId?: string | null;
  /** ISO time the till rang the sale (offline clocks are advisory). */
  createdAt: string;
  /** per-device counter shown as the provisional receipt number */
  localNumber: number;
  status: OutboxStatus;
  attempts: number;
  syncingSince: number | null;
  error: string | null;
  saleId: string | null;
  saleNumber: number | null;
  syncedAt: string | null;
  resolution: { note: string; at: string } | null;
};
