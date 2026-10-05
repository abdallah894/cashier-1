import type { Tables } from "@/lib/supabase/database.types";
import { STORE_INFO } from "./store-info";
import type { StoreInfo } from "./types";

// Defined here (not in the server-only queries module) so the tsx test
// script and client components can import it — same pattern as SaleForReceipt.
export type ShiftForZReport = Tables<"shifts"> & {
  profiles: Pick<Tables<"profiles">, "full_name"> | null;
};

export type ZReportData = {
  store: StoreInfo;
  shiftId: string;
  cashierName: string | null;
  openedAt: string;
  closedAt: string | null;
  saleCount: number;
  openingFloat: number; // piasters
  cashSales: number;
  cardSales: number;
  paidIn: number;
  paidOut: number;
  safeDrops: number;
  cashRefunds: number;
  totalSales: number;
  expectedCash: number | null; // set by close_shift; null while open
  counted: number | null;
  /** counted − expected: negative = short, positive = over */
  overShort: number | null;
};

export function buildZReport(
  shift: ShiftForZReport,
  agg: {
    cashSales: number;
    cardSales: number;
    saleCount: number;
    drawerEvents?: Array<{ event_type: "paid_in" | "paid_out" | "safe_drop" | "cash_refund" | "cash_sale"; amount: number }>;
  }
): ZReportData {
  const expected = shift.expected_cash === null ? null : Number(shift.expected_cash);
  const counted = shift.closing_counted === null ? null : Number(shift.closing_counted);
  const totals = { paid_in: 0, paid_out: 0, safe_drop: 0, cash_refund: 0, cash_sale: 0 };
  for (const event of agg.drawerEvents ?? []) totals[event.event_type] += event.amount;
  return {
    store: STORE_INFO,
    shiftId: shift.id,
    cashierName: shift.profiles?.full_name ?? null,
    openedAt: shift.opened_at,
    closedAt: shift.closed_at,
    saleCount: agg.saleCount,
    openingFloat: Number(shift.opening_float),
    cashSales: agg.cashSales,
    cardSales: agg.cardSales,
    paidIn: totals.paid_in,
    paidOut: totals.paid_out,
    safeDrops: totals.safe_drop,
    cashRefunds: totals.cash_refund,
    totalSales: agg.cashSales + agg.cardSales,
    expectedCash: expected,
    counted,
    overShort: expected !== null && counted !== null ? counted - expected : null,
  };
}
