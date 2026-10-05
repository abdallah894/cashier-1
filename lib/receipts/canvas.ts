import { formatEgp } from "@/lib/money";
import type { EscPosLabels } from "./escpos";
import type { ReceiptData } from "./types";

/**
 * Receipt as drawable rows, shared by the canvas renderer. Rows are plain
 * data (testable); `renderReceiptRgba` only paints them.
 */
export type ReceiptRow =
  | { kind: "center"; text: string; bold?: boolean }
  | { kind: "pair"; start: string; end: string; bold?: boolean }
  | { kind: "rule" }
  | { kind: "gap" };

export type RowOptions = { locale: "ar" | "en"; gift?: boolean; copyNumber?: number; includeCashier?: boolean; formatDate?: (iso: string) => string };

export function buildReceiptRows(receipt: ReceiptData, labels: EscPosLabels, { locale, gift, copyNumber = 1, includeCashier, formatDate }: RowOptions): ReceiptRow[] {
  const isAr = locale === "ar";
  const money = (v: number) => formatEgp(v, locale);
  const rows: ReceiptRow[] = [
    { kind: "center", text: isAr ? receipt.store.nameAr : receipt.store.nameEn, bold: true },
    { kind: "center", text: isAr ? receipt.store.addressAr : receipt.store.addressEn },
    { kind: "center", text: receipt.store.phone },
    { kind: "center", text: labels.taxId },
  ];
  if (gift) rows.push({ kind: "gap" }, { kind: "center", text: labels.gift, bold: true });
  if (receipt.provisionalLabel) rows.push({ kind: "center", text: labels.provisional, bold: true });
  if (copyNumber > 1) rows.push({ kind: "center", text: labels.copy(copyNumber), bold: true });
  rows.push({ kind: "rule" });
  rows.push({ kind: "pair", start: labels.saleNo, end: receipt.provisionalLabel ?? `#${receipt.saleNumber}` });
  rows.push({ kind: "pair", start: labels.date, end: (formatDate ?? ((iso) => iso.slice(0, 16).replace("T", " ")))(receipt.createdAt) });
  if (includeCashier && receipt.cashierName) rows.push({ kind: "pair", start: labels.cashier, end: receipt.cashierName });
  rows.push({ kind: "rule" });

  for (const line of receipt.lines) {
    rows.push({ kind: "center", text: isAr ? line.nameAr : line.nameEn, bold: true });
    if (gift) rows.push({ kind: "pair", start: "×", end: String(line.qty) });
    else {
      rows.push({ kind: "pair", start: `${line.qty} × ${money(line.unitPrice)}`, end: money(line.lineTotal + line.lineDiscount) });
      if (line.lineDiscount > 0) rows.push({ kind: "pair", start: labels.discount, end: `-${money(line.lineDiscount)}` });
    }
  }
  rows.push({ kind: "rule" });

  if (gift) {
    rows.push({ kind: "center", text: labels.giftNote });
  } else {
    rows.push({ kind: "pair", start: labels.subtotal, end: money(receipt.subtotal) });
    for (const row of receipt.vatBreakdown) rows.push({ kind: "pair", start: labels.vatRate(row.rateBp / 100), end: money(row.tax) });
    if (receipt.discountTotal > 0) rows.push({ kind: "pair", start: labels.discount, end: `-${money(receipt.discountTotal)}` });
    rows.push({ kind: "pair", start: labels.total, end: money(receipt.total), bold: true });
    rows.push({ kind: "pair", start: labels.paymentMethod, end: labels.payment });
    if (receipt.amountTendered !== null) {
      rows.push({ kind: "pair", start: labels.tendered, end: money(receipt.amountTendered) });
      rows.push({ kind: "pair", start: labels.change, end: money(receipt.changeDue ?? 0) });
    }
    rows.push({ kind: "gap" }, { kind: "center", text: labels.thankYou });
  }
  return rows;
}

/**
 * Paints the rows on a canvas and returns RGBA pixels for `buildRasterJob`.
 * The browser's own text engine does Arabic shaping and RTL, which is why
 * Arabic receipts print as a bitmap instead of in ESC/POS text mode.
 * Browser-only.
 */
export function renderReceiptRgba(rows: ReceiptRow[], locale: "ar" | "en", widthPx = 576): { width: number; height: number; data: Uint8ClampedArray } {
  const lineHeight = 32;
  const pad = 8;
  const heights = rows.map((row) => (row.kind === "rule" ? 16 : row.kind === "gap" ? 16 : lineHeight));
  const height = heights.reduce((a, b) => a + b, 0) + pad * 2 + 64; // trailing space before the cut
  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas is not available");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, widthPx, height);
  ctx.fillStyle = "#000";
  const rtl = locale === "ar";
  ctx.direction = rtl ? "rtl" : "ltr";
  ctx.textBaseline = "middle";

  let y = pad;
  rows.forEach((row, index) => {
    const h = heights[index];
    const mid = y + h / 2;
    if (row.kind === "rule") {
      ctx.fillRect(pad, mid, widthPx - pad * 2, 2);
    } else if (row.kind === "center") {
      ctx.font = `${row.bold ? "bold " : ""}24px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(row.text, widthPx / 2, mid, widthPx - pad * 2);
    } else if (row.kind === "pair") {
      ctx.font = `${row.bold ? "bold " : ""}24px sans-serif`;
      // start edge = left in LTR, right in RTL
      ctx.textAlign = rtl ? "right" : "left";
      ctx.fillText(row.start, rtl ? widthPx - pad : pad, mid, widthPx * 0.6);
      ctx.textAlign = rtl ? "left" : "right";
      ctx.fillText(row.end, rtl ? pad : widthPx - pad, mid, widthPx * 0.4);
    }
    y += h;
  });
  return { width: widthPx, height, data: ctx.getImageData(0, 0, widthPx, height).data };
}
