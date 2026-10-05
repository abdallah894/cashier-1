import type { ReceiptData } from "./types";

/**
 * ESC/POS encoding for 80 mm thermal printers. Pure functions from the same
 * ReceiptData every other renderer uses (the receipt interface in
 * lib/receipts/), so the register never knows which device prints.
 *
 * TEXT MODE prints ASCII only (the printer's default code page): anything
 * else becomes "?". Arabic receipts therefore go through the RASTER path:
 * the browser draws the receipt on a canvas (real Arabic shaping and RTL) and
 * `packRaster` turns the pixels into a GS v 0 bitmap.
 */
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export const ESC_POS = {
  init: [ESC, 0x40],
  alignLeft: [ESC, 0x61, 0x00],
  alignCenter: [ESC, 0x61, 0x01],
  boldOn: [ESC, 0x45, 0x01],
  boldOff: [ESC, 0x45, 0x00],
  /** partial cut after feeding the paper past the cutter */
  cut: [GS, 0x56, 0x42, 0x00],
} as const;

/** Feed `lines` lines. */
export const feed = (lines: number): number[] => [ESC, 0x64, Math.max(0, Math.min(255, lines))];

/**
 * Cash-drawer kick through the printer's RJ11 port (ESC p m t1 t2).
 * pin 0 = drawer connector pin 2; pulse times are in units of 2 ms.
 */
export const drawerPulse = (pin: 0 | 1 = 0, onTime = 25, offTime = 250): Uint8Array =>
  Uint8Array.from([ESC, 0x70, pin, onTime, offTime]);

/** Money for a thermal receipt: integer piasters -> "114.00" (no float arithmetic on the value). */
export function formatPiasters(piasters: number): string {
  const sign = piasters < 0 ? "-" : "";
  const abs = Math.abs(Math.round(piasters));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** ASCII-only; every other character prints as "?" rather than as garbage. */
export function toPrinterAscii(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 63;
    out += code >= 0x20 && code < 0x7f ? ch : "?";
  }
  return out;
}

class Builder {
  private chunks: number[] = [];
  raw(bytes: readonly number[] | Uint8Array) {
    for (const byte of bytes) this.chunks.push(byte);
    return this;
  }
  text(value: string) {
    for (const ch of toPrinterAscii(value)) this.chunks.push(ch.charCodeAt(0));
    return this;
  }
  line(value = "") {
    return this.text(value).raw([LF]);
  }
  build(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

/** "left        right" padded to `columns`; the left side is truncated, never the amount. */
export function twoColumns(left: string, right: string, columns: number): string {
  const l = toPrinterAscii(left);
  const r = toPrinterAscii(right);
  const room = Math.max(1, columns - r.length - 1);
  const cut = l.length > room ? l.slice(0, room) : l;
  return cut + " ".repeat(Math.max(1, columns - cut.length - r.length)) + r;
}

function wrap(text: string, columns: number): string[] {
  const words = toPrinterAscii(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > columns) {
      if (current) lines.push(current);
      for (let i = 0; i < word.length; i += columns) lines.push(word.slice(i, i + columns));
      current = "";
    } else if ((current + " " + word).trim().length > columns) {
      lines.push(current);
      current = word;
    } else {
      current = (current + " " + word).trim();
    }
  }
  if (current) lines.push(current);
  return lines;
}

export type EscPosLabels = {
  taxId: string;
  saleNo: string;
  date: string;
  cashier: string;
  subtotal: string;
  vatRate: (rate: number) => string;
  discount: string;
  total: string;
  paymentMethod: string;
  payment: string;
  tendered: string;
  change: string;
  thankYou: string;
  gift: string;
  giftNote: string;
  provisional: string;
  copy: (n: number) => string;
};

export type EscPosOptions = {
  /** characters per line: 48 for 80 mm (Font A), 32 for 58 mm */
  columns?: number;
  /** 1 = original; >1 prints "COPY n" */
  copyNumber?: number;
  /** gift receipt: items and quantities only, never prices or payment */
  gift?: boolean;
  /** printed on the customer copy only when asked; off by default (staff privacy) */
  includeCashier?: boolean;
  /** kick the cash drawer at the end of the job */
  openDrawer?: boolean;
  /** formats the receipt timestamp (the caller owns the locale and timezone) */
  formatDate?: (iso: string) => string;
};

/** Sale receipt (or gift receipt) as one ESC/POS job. */
export function buildReceiptEscPos(receipt: ReceiptData, labels: EscPosLabels, options: EscPosOptions = {}): Uint8Array {
  const columns = options.columns ?? 48;
  const dash = "-".repeat(columns);
  const b = new Builder();

  b.raw(ESC_POS.init).raw(ESC_POS.alignCenter).raw(ESC_POS.boldOn);
  for (const part of wrap(receipt.store.nameEn, columns)) b.line(part);
  b.raw(ESC_POS.boldOff);
  for (const part of wrap(receipt.store.addressEn, columns)) b.line(part);
  b.line(receipt.store.phone).line(labels.taxId);
  if (options.gift) b.raw(ESC_POS.boldOn).line().line(labels.gift).raw(ESC_POS.boldOff);
  if (receipt.provisionalLabel) b.raw(ESC_POS.boldOn).line(labels.provisional).raw(ESC_POS.boldOff);
  if ((options.copyNumber ?? 1) > 1) b.raw(ESC_POS.boldOn).line(labels.copy(options.copyNumber ?? 1)).raw(ESC_POS.boldOff);

  b.raw(ESC_POS.alignLeft).line(dash);
  b.line(twoColumns(labels.saleNo, receipt.provisionalLabel ?? `#${receipt.saleNumber}`, columns));
  b.line(twoColumns(labels.date, (options.formatDate ?? ((iso) => iso.slice(0, 16).replace("T", " ")))(receipt.createdAt), columns));
  if (options.includeCashier && receipt.cashierName) b.line(twoColumns(labels.cashier, receipt.cashierName, columns));
  b.line(dash);

  for (const line of receipt.lines) {
    for (const part of wrap(line.nameEn, columns)) b.line(part);
    if (options.gift) {
      b.line(`  x ${line.qty}`);
    } else {
      b.line(twoColumns(`  ${line.qty} x ${formatPiasters(line.unitPrice)}`, formatPiasters(line.lineTotal + line.lineDiscount), columns));
      if (line.lineDiscount > 0) b.line(twoColumns(`  ${labels.discount}`, `-${formatPiasters(line.lineDiscount)}`, columns));
    }
  }
  b.line(dash);

  if (options.gift) {
    b.raw(ESC_POS.alignCenter).line(labels.giftNote);
  } else {
    b.line(twoColumns(labels.subtotal, formatPiasters(receipt.subtotal), columns));
    for (const row of receipt.vatBreakdown) b.line(twoColumns(labels.vatRate(row.rateBp / 100), formatPiasters(row.tax), columns));
    if (receipt.discountTotal > 0) b.line(twoColumns(labels.discount, `-${formatPiasters(receipt.discountTotal)}`, columns));
    b.raw(ESC_POS.boldOn).line(twoColumns(labels.total, formatPiasters(receipt.total), columns)).raw(ESC_POS.boldOff);
    b.line(twoColumns(labels.paymentMethod, labels.payment, columns));
    if (receipt.amountTendered !== null) {
      b.line(twoColumns(labels.tendered, formatPiasters(receipt.amountTendered), columns));
      b.line(twoColumns(labels.change, formatPiasters(receipt.changeDue ?? 0), columns));
    }
    b.raw(ESC_POS.alignCenter).line().line(labels.thankYou);
  }

  b.raw(feed(4)).raw(ESC_POS.cut);
  if (options.openDrawer) b.raw(drawerPulse());
  return b.build();
}

/**
 * Packs RGBA pixels into a monochrome GS v 0 raster bitmap (1 = black).
 * `threshold` is on the luma scale; transparent pixels print as white.
 */
export function packRaster(width: number, height: number, rgba: ArrayLike<number>, threshold = 128): Uint8Array {
  if (width <= 0 || height <= 0 || rgba.length < width * height * 4) throw new Error("invalid bitmap dimensions");
  const bytesPerRow = Math.ceil(width / 8);
  const out = new Uint8Array(8 + bytesPerRow * height);
  out.set([GS, 0x76, 0x30, 0x00, bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff]);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const alpha = rgba[i + 3] / 255;
      const luma = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) * alpha + 255 * (1 - alpha);
      if (luma < threshold) out[8 + y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return out;
}

/** A complete raster job: init, bitmap, feed, cut (and optionally the drawer kick). */
export function buildRasterJob(width: number, height: number, rgba: ArrayLike<number>, options: { openDrawer?: boolean } = {}): Uint8Array {
  const bitmap = packRaster(width, height, rgba);
  const tail = [...feed(4), ...ESC_POS.cut, ...(options.openDrawer ? drawerPulse() : [])];
  const out = new Uint8Array(ESC_POS.init.length + bitmap.length + tail.length);
  out.set(ESC_POS.init, 0);
  out.set(bitmap, ESC_POS.init.length);
  out.set(tail, ESC_POS.init.length + bitmap.length);
  return out;
}
