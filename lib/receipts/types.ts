import type { Tables } from "@/lib/supabase/database.types";

// The sale shape the builder consumes — the `sales + sale_items + profiles`
// join from lib/supabase/queries/sales.ts. Defined here, free of
// "server-only", so client components and the tsx test script can import it.
export type SaleForReceipt = Tables<"sales"> & {
  sale_items: Tables<"sale_items">[];
  profiles: Pick<Tables<"profiles">, "full_name"> | null;
};

export type StoreInfo = {
  nameAr: string;
  nameEn: string;
  addressAr: string;
  addressEn: string;
  phone: string;
  /** Egyptian tax registration number — printed on every receipt. */
  taxId: string;
};

export type ReceiptLine = {
  nameAr: string;
  nameEn: string;
  qty: number;
  unitPrice: number; // piasters
  lineDiscount: number; // piasters
  lineTotal: number; // piasters, after discount
};

export type VatBreakdownRow = {
  rateBp: number; // basis points: 1400 = 14%
  net: number; // piasters
  tax: number; // piasters
};

export type ReceiptData = {
  store: StoreInfo;
  saleId: string;
  saleNumber: number;
  createdAt: string; // ISO timestamp
  cashierName: string | null;
  paymentMethod: Tables<"sales">["payment_method"];
  lines: ReceiptLine[];
  /** per-line VAT summed by rate, rate ascending — matches create_sale math */
  vatBreakdown: VatBreakdownRow[];
  subtotal: number; // piasters, net of VAT
  taxTotal: number;
  discountTotal: number;
  total: number;
  amountTendered: number | null;
  changeDue: number | null;
  /** encoded in the receipt's QR code */
  qrValue: string;
  /** Set for a sale rung offline and not yet numbered by the server (e.g. "P-3"). */
  provisionalLabel?: string;
};
