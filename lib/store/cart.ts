import { create } from "zustand";
import { lineBaseAmount, extractNet } from "@/lib/money";
import type { Tables } from "@/lib/supabase/database.types";

/** Minimal customer reference attached to a sale (never the full profile). */
export type CartCustomer = { id: string; name: string; phoneLast4: string };

/** Server-evaluated promotions for the cart, valid only for the `key` it was computed for. */
export type CartPromo = {
  key: string;
  perLine: number[];
  applied: { promotionId: string; nameAr: string; nameEn: string; code: string | null; discount: number }[];
};

// Zustand ≈ Pinia: `create()` is defineStore, the callback's `set/get`
// replace `this`, and components subscribe with selectors instead of
// storeToRefs. State is module-level, so the cart survives client-side
// navigation (but not a full reload — offline persistence is deferred).

export type Discount =
  | { kind: "percent"; bp: number } // basis points: 10% → 1000
  | { kind: "fixed"; piasters: number };

export type CartItem = {
  productId: string;
  barcode: string;
  nameAr: string;
  nameEn: string;
  unitPrice: number; // piasters, VAT-inclusive
  rateBp: number; // tax rate in basis points (0.14 → 1400)
  unit: "piece" | "kg";
  stockQty: number; // stock known at add time — soft client-side guard
  qty: number;
  discount: Discount | null;
};

export function toCartItem(p: Tables<"products">): Omit<CartItem, "qty" | "discount"> {
  return {
    productId: p.id,
    barcode: p.barcode,
    nameAr: p.name_ar,
    nameEn: p.name_en,
    unitPrice: p.price,
    rateBp: Math.round(p.tax_rate * 10000),
    unit: p.unit,
    stockQty: Number(p.stock_qty),
  };
}

type CartState = {
  items: CartItem[];
  saleDiscount: Discount | null;
  /** index of the keyboard-selected line, -1 = none */
  selectedIndex: number;
  customer: CartCustomer | null;
  promoCodes: string[];
  promo: CartPromo | null;
  setCustomer: (customer: CartCustomer | null) => void;
  addPromoCode: (code: string) => void;
  removePromoCode: (code: string) => void;
  clearPromoCodes: () => void;
  setPromo: (promo: CartPromo | null) => void;
  addProduct: (product: Tables<"products">, qty?: number) => void;
  setQty: (productId: string, qty: number) => void;
  setLineDiscount: (productId: string, discount: Discount | null) => void;
  setSaleDiscount: (discount: Discount | null) => void;
  removeItem: (productId: string) => void;
  clear: () => void;
  setSelectedIndex: (index: number) => void;
};

export const useCart = create<CartState>((set) => ({
  items: [],
  saleDiscount: null,
  selectedIndex: -1,
  customer: null,
  promoCodes: [],
  promo: null,

  setCustomer: (customer) => set({ customer, promo: null }),
  addPromoCode: (code) =>
    set((state) => {
      const normalized = code.trim().toUpperCase();
      if (!normalized || state.promoCodes.includes(normalized)) return state;
      return { promoCodes: [...state.promoCodes, normalized], promo: null };
    }),
  removePromoCode: (code) =>
    set((state) => ({ promoCodes: state.promoCodes.filter((c) => c !== code), promo: null })),
  clearPromoCodes: () => set({ promoCodes: [], promo: null }),
  setPromo: (promo) => set({ promo }),

  addProduct: (product, qty) =>
    set((state) => {
      const existing = state.items.find((i) => i.productId === product.id);
      if (existing) {
        // scanning an item already in the cart increments it
        const step = qty ?? 1;
        return {
          items: state.items.map((i) =>
            i.productId === product.id ? { ...i, qty: roundQty(i.qty + step) } : i
          ),
          selectedIndex: state.items.indexOf(existing),
        };
      }
      const item: CartItem = { ...toCartItem(product), qty: qty ?? 1, discount: null };
      return { items: [...state.items, item], selectedIndex: state.items.length };
    }),

  setQty: (productId, qty) =>
    set((state) => ({
      items:
        qty <= 0
          ? state.items.filter((i) => i.productId !== productId)
          : state.items.map((i) => (i.productId === productId ? { ...i, qty: roundQty(qty) } : i)),
    })),

  setLineDiscount: (productId, discount) =>
    set((state) => ({
      items: state.items.map((i) => (i.productId === productId ? { ...i, discount } : i)),
    })),

  setSaleDiscount: (discount) => set({ saleDiscount: discount }),

  removeItem: (productId) =>
    set((state) => {
      const items = state.items.filter((i) => i.productId !== productId);
      return { items, selectedIndex: Math.min(state.selectedIndex, items.length - 1) };
    }),

  clear: () =>
    set({ items: [], saleDiscount: null, selectedIndex: -1, customer: null, promoCodes: [], promo: null }),

  setSelectedIndex: (index) => set({ selectedIndex: index }),
}));

/** qty keeps ≤3 decimals (scale weights); guards float drift from += */
function roundQty(qty: number): number {
  return Math.round(qty * 1000) / 1000;
}

// ---------- derived totals (pure — unit-tested offline) ----------

export type LineComputed = {
  item: CartItem;
  base: number; // piasters before discounts
  lineDiscount: number; // the cashier's per-line discount, piasters
  saleDiscountShare: number; // this line's slice of the sale discount
  promoDiscount: number; // server-evaluated promotions on this line, piasters
  gross: number; // base - lineDiscount - saleDiscountShare - promoDiscount
  net: number;
  tax: number;
};

export type CartTotals = {
  lines: LineComputed[];
  itemCount: number;
  baseTotal: number;
  discountTotal: number; // manual + promotion discounts (matches sales.discount_total)
  /** the cashier's own discounts only: what the manager-approval rule looks at */
  manualDiscountTotal: number;
  promoDiscountTotal: number;
  saleDiscountAmount: number;
  subtotal: number; // net of VAT
  taxTotal: number;
  /** rateBp → { net, tax } for the per-rate VAT breakdown */
  vatByRate: Map<number, { net: number; tax: number }>;
  total: number; // what the customer pays
};

function discountAmount(discount: Discount | null, base: number): number {
  if (!discount) return 0;
  const amount =
    discount.kind === "percent" ? Math.round((base * discount.bp) / 10000) : discount.piasters;
  return Math.max(0, Math.min(amount, base));
}

/**
 * The whole-sale discount is distributed across lines proportionally to
 * their gross (largest-remainder method, exact integer piasters), because
 * the create_sale RPC — and the receipt's VAT breakdown — work per line.
 */
export function computeTotals(
  items: CartItem[],
  saleDiscount: Discount | null,
  /** per-line promotion discounts from the server preview, aligned with `items` */
  promoDiscounts: readonly number[] = []
): CartTotals {
  const prelim = items.map((item) => {
    const base = lineBaseAmount(item.unitPrice, item.qty);
    const lineDiscount = discountAmount(item.discount, base);
    return { item, base, lineDiscount, grossBefore: base - lineDiscount };
  });

  const grossSum = prelim.reduce((acc, l) => acc + l.grossBefore, 0);
  const saleDiscountAmount = discountAmount(saleDiscount, grossSum);

  // largest-remainder split of saleDiscountAmount, proportional to gross
  const shares = prelim.map((l) =>
    grossSum === 0 ? 0 : Math.floor((saleDiscountAmount * l.grossBefore) / grossSum)
  );
  let remainder = saleDiscountAmount - shares.reduce((a, b) => a + b, 0);
  const byRemainder = prelim
    .map((l, i) => ({
      i,
      frac: grossSum === 0 ? 0 : (saleDiscountAmount * l.grossBefore) % grossSum,
    }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of byRemainder) {
    if (remainder <= 0) break;
    // never discount a line below zero
    if (shares[i] + 1 <= prelim[i].grossBefore) {
      shares[i] += 1;
      remainder -= 1;
    }
  }

  const lines: LineComputed[] = prelim.map((l, i) => {
    const promoDiscount = Math.max(0, Math.min(promoDiscounts[i] ?? 0, l.grossBefore - shares[i]));
    const gross = l.grossBefore - shares[i] - promoDiscount;
    const net = extractNet(gross, l.item.rateBp);
    return {
      item: l.item,
      base: l.base,
      lineDiscount: l.lineDiscount,
      saleDiscountShare: shares[i],
      promoDiscount,
      gross,
      net,
      tax: gross - net,
    };
  });

  const vatByRate = new Map<number, { net: number; tax: number }>();
  for (const line of lines) {
    const entry = vatByRate.get(line.item.rateBp) ?? { net: 0, tax: 0 };
    entry.net += line.net;
    entry.tax += line.tax;
    vatByRate.set(line.item.rateBp, entry);
  }

  return {
    lines,
    itemCount: items.length,
    baseTotal: prelim.reduce((acc, l) => acc + l.base, 0),
    discountTotal:
      prelim.reduce((acc, l) => acc + l.lineDiscount, 0) +
      saleDiscountAmount +
      lines.reduce((acc, l) => acc + l.promoDiscount, 0),
    manualDiscountTotal: prelim.reduce((acc, l) => acc + l.lineDiscount, 0) + saleDiscountAmount,
    promoDiscountTotal: lines.reduce((acc, l) => acc + l.promoDiscount, 0),
    saleDiscountAmount,
    subtotal: lines.reduce((acc, l) => acc + l.net, 0),
    taxTotal: lines.reduce((acc, l) => acc + l.tax, 0),
    vatByRate,
    total: lines.reduce((acc, l) => acc + l.gross, 0),
  };
}

/** Payload for the create_sale RPC: sale discount already folded into lines. */
export function toSaleItems(totals: CartTotals) {
  return totals.lines.map((l) => ({
    product_id: l.item.productId,
    qty: l.item.qty,
    line_discount: l.lineDiscount + l.saleDiscountShare,
  }));
}

/**
 * Payload for a sale queued offline. Promotions are normally applied by the
 * server, but a queued sale syncs with promotions switched off, so any
 * promotion discount the customer was already shown is folded into the line
 * discount to keep what they paid and what is recorded identical.
 */
export function toQueuedSaleItems(totals: CartTotals) {
  return totals.lines.map((l) => ({
    product_id: l.item.productId,
    qty: l.item.qty,
    line_discount: l.lineDiscount + l.saleDiscountShare + l.promoDiscount,
  }));
}
