import {
  buildRasterJob,
  buildReceiptEscPos,
  drawerPulse,
  formatPiasters,
  packRaster,
  toPrinterAscii,
  twoColumns,
  type EscPosLabels,
} from "../lib/receipts/escpos";
import { buildTextReceipt, deliverReceipt, maskEmail, maskPhone } from "../lib/receipts/delivery";
import type { ReceiptData } from "../lib/receipts/types";
import { storeInfoFromSettings } from "../lib/receipts/store-info";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures++;
}

const labels: EscPosLabels = {
  taxId: "Tax ID: 100-200-300",
  saleNo: "Receipt #",
  date: "Date",
  cashier: "Cashier",
  subtotal: "Subtotal",
  vatRate: (rate) => `VAT ${rate}%`,
  discount: "Discount",
  total: "TOTAL",
  paymentMethod: "Payment",
  payment: "Cash",
  tendered: "Received",
  change: "Change",
  thankYou: "Thank you!",
  gift: "GIFT RECEIPT",
  giftNote: "Prices are not shown",
  provisional: "PROVISIONAL",
  copy: (n) => `COPY ${n}`,
};

const receipt: ReceiptData = {
  store: {
    nameAr: "س",
    nameEn: "Cachier Supermarket",
    addressAr: "ع",
    addressEn: "15 Tahrir St., Dokki, Giza",
    phone: "0100 000 0000",
    taxId: "100-200-300",
    footerAr: "",
    footerEn: "Exchange within 14 days",
  },
  saleId: "00000000-0000-0000-0000-000000000001",
  saleNumber: 42,
  createdAt: "2026-10-05T10:30:00Z",
  cashierName: "Secret Cashier Name",
  paymentMethod: "cash",
  lines: [
    { nameAr: "حليب", nameEn: "Milk 1L", qty: 2, unitPrice: 2500, lineDiscount: 0, lineTotal: 5000 },
    {
      nameAr: "قهوة",
      nameEn: "Café très long product name that must wrap onto more lines than one",
      qty: 1,
      unitPrice: 6400,
      lineDiscount: 400,
      lineTotal: 6000,
    },
  ],
  vatBreakdown: [{ rateBp: 1400, net: 9649, tax: 1351 }],
  subtotal: 9649,
  taxTotal: 1351,
  discountTotal: 400,
  total: 11000,
  amountTendered: 20000,
  changeDue: 9000,
  qrValue: "42",
};

const decode = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");
// strip the ESC/POS control sequences this encoder emits, leaving only what would print
const printable = (line: string) =>
  line
    .replace(/\x1b@|\x1b[aE][\x00-\x02]|\x1bd[\x00-\xff]|\x1dVB\x00|\x1bp[\x00-\xff]{3}/g, "")
    .replace(/[\x00-\x1f]/g, "");
const textLines = (bytes: Uint8Array) => decode(bytes).split("\n");
const startsWith = (bytes: Uint8Array, prefix: number[]) => prefix.every((b, i) => bytes[i] === b);
const endsWith = (bytes: Uint8Array, suffix: number[]) => suffix.every((b, i) => bytes[bytes.length - suffix.length + i] === b);

// ---- primitives ----
check("money is formatted from integer piasters", formatPiasters(11000) === "110.00" && formatPiasters(5) === "0.05" && formatPiasters(-1250) === "-12.50");
check("non-ASCII prints as ? instead of garbage", toPrinterAscii("Café ح") === "Caf? ?");
check("two columns right-align the amount", twoColumns("Total", "110.00", 20) === "Total".padEnd(20 - 6) + "110.00");
check(
  "a long label is truncated, never the amount",
  twoColumns("A very long product label indeed", "110.00", 20).endsWith("110.00") && twoColumns("A very long product label indeed", "110.00", 20).length === 20
);
check("the drawer pulse is ESC p 0 25 250", Array.from(drawerPulse()).join() === [0x1b, 0x70, 0, 25, 250].join());

// ---- store identity (Phase 0): empty fields are left off, never printed blank or as demo data ----
{
  const bare: ReceiptData = { ...receipt, store: { ...receipt.store, addressEn: "", phone: "", taxId: "", footerEn: "" } };
  const bareText = decode(buildReceiptEscPos(bare, { ...labels, taxId: "Tax ID: " }, { columns: 48, formatDate: () => "d" }));
  check("an unset tax id is not printed", !bareText.includes("Tax ID"));
  check("an unset phone is not printed", !bareText.includes("0100"));
  check("a configured footer is printed", decode(buildReceiptEscPos(receipt, labels, { columns: 48, formatDate: () => "d" })).includes("Exchange within 14 days"));
  const mapped = storeInfoFromSettings({
    store_name_ar: "", store_name_en: "Green Market", address_ar: "", address_en: "1 Nile St",
    phone: " 0102 ", tax_registration_number: "555-111", receipt_footer_ar: "", receipt_footer_en: "",
  });
  check("settings map to receipt store info", mapped.nameEn === "Green Market" && mapped.taxId === "555-111" && mapped.phone === "0102");
  check("one language fills the other", mapped.nameAr === "Green Market" && mapped.addressAr === "1 Nile St");
  const blank = storeInfoFromSettings({
    store_name_ar: "", store_name_en: "", address_ar: "", address_en: "", phone: "",
    tax_registration_number: "", receipt_footer_ar: "", receipt_footer_en: "",
  });
  check("a blank store falls back to a neutral name, no tax id", blank.nameEn === "Supermarket" && blank.taxId === "" && !JSON.stringify(blank).includes("100-200-300"));
}

// ---- sale receipt ----
const job = buildReceiptEscPos(receipt, labels, { columns: 48, formatDate: () => "2026-10-05 12:30" });
const text = decode(job);
check("a job starts with ESC @ (initialise)", startsWith(job, [0x1b, 0x40]));
check("a job ends with a paper cut", endsWith(job, [0x1d, 0x56, 0x42, 0x00]));
check("no drawer kick unless asked", !text.includes("\x1bp"));
check("the store, receipt number and total are printed", text.includes("Cachier Supermarket") && text.includes("#42") && /TOTAL\s+110\.00/.test(text));
check("VAT and change are printed", /VAT 14%\s+13\.51/.test(text) && /Change\s+90\.00/.test(text));
check("a discount line is printed", /Discount\s+-4\.00/.test(text));
check("no line exceeds the printer width", textLines(job).every((l) => printable(l).length <= 48), String(Math.max(...textLines(job).map((l) => printable(l).length))));
check("long names wrap instead of overflowing", text.split("\n").filter((l) => l.includes("long product") || l.includes("name that")).length >= 1);
check("the cashier is not printed unless requested", !text.includes("Secret Cashier Name"));
check("the cashier can be included on request", decode(buildReceiptEscPos(receipt, labels, { includeCashier: true })).includes("Secret Cashier Name"));
check("a 58 mm job respects 32 columns", textLines(buildReceiptEscPos(receipt, labels, { columns: 32 })).every((l) => printable(l).length <= 32));
check("a reprint is marked with its copy number", decode(buildReceiptEscPos(receipt, labels, { copyNumber: 2 })).includes("COPY 2") && !text.includes("COPY"));
check("the drawer kick is appended after the cut when requested", endsWith(buildReceiptEscPos(receipt, labels, { openDrawer: true }), [0x1b, 0x70, 0, 25, 250]));
const provisional = decode(buildReceiptEscPos({ ...receipt, provisionalLabel: "P-3" }, labels));
check("a provisional (offline) receipt says so", provisional.includes("PROVISIONAL") && provisional.includes("P-3"));

// ---- gift receipt privacy ----
const gift = decode(buildReceiptEscPos(receipt, labels, { gift: true }));
check("a gift receipt says gift receipt", gift.includes("GIFT RECEIPT"));
check("a gift receipt lists items and quantities", gift.includes("Milk 1L") && gift.includes("x 2"));
check("a gift receipt shows no price, total, tax or payment", !/\d+\.\d{2}/.test(gift) && !/TOTAL|VAT|Payment|Received|Change|Discount/.test(gift));

// ---- raster path (Arabic) ----
const white = (w: number, h: number) => new Uint8ClampedArray(w * h * 4).fill(255);
const px = white(16, 2);
for (let x = 0; x < 16; x++) {
  px[x * 4] = 0;
  px[x * 4 + 1] = 0;
  px[x * 4 + 2] = 0; // first row black
}
const packed = packRaster(16, 2, px);
check("a raster header is GS v 0 with byte width and height", Array.from(packed.slice(0, 8)).join() === [0x1d, 0x76, 0x30, 0, 2, 0, 2, 0].join());
check("black pixels become 1 bits, white become 0", packed[8] === 0xff && packed[9] === 0xff && packed[10] === 0x00 && packed[11] === 0x00);
const odd = white(10, 1);
odd[9 * 4] = 0;
odd[9 * 4 + 1] = 0;
odd[9 * 4 + 2] = 0;
const oddPacked = packRaster(10, 1, odd);
check("rows are padded to whole bytes", oddPacked[4] === 2 && oddPacked[8] === 0x00 && oddPacked[9] === 0x40);
check("transparent pixels print as white", packRaster(8, 1, new Uint8ClampedArray(8 * 4))[8] === 0);
let threw = false;
try {
  packRaster(4, 4, new Uint8ClampedArray(4));
} catch {
  threw = true;
}
check("a bitmap with too few pixels is refused", threw);
const rasterJob = buildRasterJob(16, 2, px, { openDrawer: true });
check("a raster job is init + bitmap + feed + cut (+ drawer)", startsWith(rasterJob, [0x1b, 0x40, 0x1d, 0x76]) && endsWith(rasterJob, [0x1b, 0x70, 0, 25, 250]));

// ---- customer-facing text / delivery privacy ----
const body = buildTextReceipt(receipt);
check("a customer text receipt has items and totals", body.includes("Milk 1L") && body.includes("Total: EGP 110.00"));
check("a customer text receipt never names the cashier or internal ids", !body.includes("Secret Cashier Name") && !body.includes(receipt.saleId));
const giftBody = buildTextReceipt(receipt, { gift: true });
check("a gift text receipt has no prices", !/\d+\.\d{2}/.test(giftBody) && giftBody.includes("GIFT RECEIPT"));
check("emails are masked in logs", !maskEmail("mona.adel@example.com").includes("adel") && maskEmail("mona.adel@example.com").endsWith("@example.com"));
check("phone numbers are masked in logs", maskPhone("+20 100 123 4567").endsWith("4567") && !maskPhone("+20 100 123 4567").includes("100"));
check("junk recipients mask to nothing useful", maskEmail("nope") === "***" && maskPhone("12") === "***");
check("email/SMS delivery honestly reports unsupported", deliverReceipt("email", "mona@example.com").status === "unsupported");

if (failures > 0) process.exit(1);
console.log("ESC/POS and receipt privacy tests pass.");
