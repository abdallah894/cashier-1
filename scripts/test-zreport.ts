/**
 * Z-report builder tests — run with: npm run test:zreport
 * expected_cash comes from close_shift (SQL); overShort = counted − expected.
 */
import { buildZReport, type ShiftForZReport } from "../lib/receipts/z-report";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failures++;
}

function fakeShift(over: Partial<ShiftForZReport>): ShiftForZReport {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    cashier_id: "00000000-0000-0000-0000-000000000002",
    opened_at: "2026-07-06T08:00:00Z",
    closed_at: "2026-07-06T16:30:00Z",
    opening_float: 50000,
    closing_counted: 156000,
    expected_cash: 156300,
    till_id: "00000000-0000-0000-0000-0000000000a1",
    created_at: "2026-07-06T08:00:00Z",
    profiles: { full_name: "Test Cashier" },
    ...over,
  };
}

// closed shift: over/short is signed (counted − expected → short = negative)
{
  const r = buildZReport(fakeShift({}), {
    cashSales: 106300,
    cardSales: 40000,
    saleCount: 12,
    drawerEvents: [
      { event_type: "paid_in", amount: 10000 },
      { event_type: "paid_out", amount: -2000 },
      { event_type: "safe_drop", amount: -5000 },
      { event_type: "cash_refund", amount: -3000 },
    ],
  });
  check("expected passthrough", r.expectedCash === 156300);
  check("counted passthrough", r.counted === 156000);
  check("overShort = counted − expected (short → negative)", r.overShort === -300);
  check("totalSales = cash + card", r.totalSales === 146300);
  check("saleCount passthrough", r.saleCount === 12);
  check("cashier name from join", r.cashierName === "Test Cashier");
  check("drawer events are separated by type", r.paidIn === 10000 && r.paidOut === -2000 && r.safeDrops === -5000 && r.cashRefunds === -3000);
  check("store info attached", r.store.nameEn.length > 0);
}

// over: counted above expected → positive
{
  const r = buildZReport(fakeShift({ closing_counted: 156500 }), {
    cashSales: 106300,
    cardSales: 0,
    saleCount: 5,
  });
  check("overShort positive when over", r.overShort === 200);
}

// open shift: closing fields are null
{
  const r = buildZReport(
    fakeShift({ closed_at: null, closing_counted: null, expected_cash: null }),
    { cashSales: 0, cardSales: 0, saleCount: 0 }
  );
  check("open shift → null expected/counted/overShort",
    r.expectedCash === null && r.counted === null && r.overShort === null);
  check("open shift → closedAt null", r.closedAt === null);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failing`);
  process.exit(1);
}
console.log("\nAll Z-report tests passed.");
