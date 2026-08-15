// Client-side PDF receipt (80mm-wide page, mirrors the print view).
// jsPDF + embedded Amiri: jsPDF's Arabic shaper/bidi engine produces
// correctly connected RTL Arabic once an Arabic-capable font is active.
// Imported dynamically from ReceiptActions so jsPDF stays out of the
// main bundle.
import { formatEgp } from "@/lib/money";
import type { ReceiptData } from "./types";

export type ReceiptPdfLabels = {
  taxId: string; // pre-interpolated, e.g. "Tax ID: 100-200-300"
  saleNo: string;
  date: string;
  cashier: string;
  discount: string;
  subtotal: string;
  vatRate: (ratePercent: number) => string;
  total: string;
  paymentMethod: string;
  payment: string; // localized "Cash"/"Card"
  tendered: string;
  change: string;
  thankYou: string;
};

const FONT_URL = "/fonts/Amiri-Regular.ttf";
let cachedFontBase64: string | null = null;

async function loadFontBase64(): Promise<string> {
  if (cachedFontBase64) return cachedFontBase64;
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error(`receipt font fetch failed: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000; // stay under the fn-arg-count limit
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  cachedFontBase64 = btoa(bin);
  return cachedFontBase64;
}

const W = 80; // page width, mm — same as the thermal paper
const M = 5; // side margin, mm
const LH = 4.6; // base line height, mm

export async function downloadReceiptPdf(
  receipt: ReceiptData,
  locale: string,
  labels: ReceiptPdfLabels
): Promise<void> {
  const [{ jsPDF }, qrcodeModule, font] = await Promise.all([
    import("jspdf"),
    import("qrcode"),
    loadFontBase64(),
  ]);
  const QRCode = qrcodeModule.default;
  const isAr = locale === "ar";
  const money = (v: number) => formatEgp(v, locale);

  // jsPDF pages can't grow after creation — estimate the height up front
  const itemRows = receipt.lines.reduce((n, l) => n + 2 + (l.lineDiscount > 0 ? 1 : 0), 0);
  const totalRows = 4 + receipt.vatBreakdown.length + (receipt.amountTendered !== null ? 2 : 0);
  const height = 40 + (itemRows + totalRows) * LH + 45;

  const doc = new jsPDF({ unit: "mm", format: [W, height] });
  doc.addFileToVFS("Amiri-Regular.ttf", font);
  doc.addFont("Amiri-Regular.ttf", "Amiri", "normal");
  doc.setFont("Amiri");
  doc.setFontSize(10);

  let y = 10;

  const center = (text: string, size = 10) => {
    doc.setFontSize(size);
    doc.text(text, W / 2, y, { align: "center" });
    y += LH * (size / 10);
    doc.setFontSize(10);
  };
  // label at the reading start, value at the end — mirrors under RTL
  const row = (label: string, value: string, size = 10) => {
    doc.setFontSize(size);
    if (isAr) {
      doc.text(label, W - M, y, { align: "right" });
      doc.text(value, M, y, { align: "left" });
    } else {
      doc.text(label, M, y, { align: "left" });
      doc.text(value, W - M, y, { align: "right" });
    }
    y += LH * (size / 10);
    doc.setFontSize(10);
  };
  const dashes = () => {
    doc.setLineDashPattern([1, 1], 0);
    doc.line(M, y - 1.5, W - M, y - 1.5);
    y += 2.5;
  };

  center(isAr ? receipt.store.nameAr : receipt.store.nameEn, 13);
  center(isAr ? receipt.store.addressAr : receipt.store.addressEn);
  center(receipt.store.phone);
  center(labels.taxId);
  dashes();

  row(labels.saleNo, `#${receipt.saleNumber}`);
  row(
    labels.date,
    new Intl.DateTimeFormat(isAr ? "ar-EG" : "en-EG", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(receipt.createdAt))
  );
  if (receipt.cashierName) row(labels.cashier, receipt.cashierName);
  dashes();

  for (const line of receipt.lines) {
    const name = isAr ? line.nameAr : line.nameEn;
    if (isAr) doc.text(name, W - M, y, { align: "right" });
    else doc.text(name, M, y, { align: "left" });
    y += LH;
    row(`${line.qty} × ${money(line.unitPrice)}`, money(line.lineTotal + line.lineDiscount));
    if (line.lineDiscount > 0) row(labels.discount, `-${money(line.lineDiscount)}`);
  }
  dashes();

  row(labels.subtotal, money(receipt.subtotal));
  for (const rate of receipt.vatBreakdown) {
    row(labels.vatRate(rate.rateBp / 100), money(rate.tax));
  }
  if (receipt.discountTotal > 0) row(labels.discount, `-${money(receipt.discountTotal)}`);
  row(labels.total, money(receipt.total), 13);
  row(labels.paymentMethod, labels.payment);
  if (receipt.amountTendered !== null) {
    row(labels.tendered, money(receipt.amountTendered));
    row(labels.change, money(receipt.changeDue ?? 0));
  }
  dashes();

  const qr = await QRCode.toDataURL(receipt.qrValue, { margin: 0, width: 256 });
  doc.addImage(qr, "PNG", (W - 20) / 2, y, 20, 20);
  y += 24;
  center(`#${receipt.saleNumber}`);
  center(labels.thankYou);

  doc.save(`receipt-${receipt.saleNumber}.pdf`);
}
