"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { previewPromotions } from "@/lib/actions/promotions";
import { toSaleItems, useCart, type CartTotals } from "@/lib/store/cart";

type SaleItems = ReturnType<typeof toSaleItems>;

/**
 * Keeps `cart.promo` in step with the server: whenever the lines, customer
 * or codes change (and we are online) the same SQL function that create_sale
 * uses is asked what applies. The stored result carries the key it was
 * computed for, so a stale answer is never mixed into newer totals.
 * Returns the key the current cart corresponds to.
 */
export function usePromotionPreview(base: CartTotals, online: boolean): string {
  const tErrors = useTranslations("errors");
  const customerId = useCart((s) => s.customer?.id ?? null);
  const promoCodes = useCart((s) => s.promoCodes);
  const storedKey = useCart((s) => s.promo?.key ?? null);
  const setPromo = useCart((s) => s.setPromo);
  const clearPromoCodes = useCart((s) => s.clearPromoCodes);

  const key = JSON.stringify([toSaleItems(base), customerId, promoCodes]);

  useEffect(() => {
    const [items, customer, codes] = JSON.parse(key) as [SaleItems, string | null, string[]];
    if (!online || items.length === 0) {
      if (storedKey !== null) setPromo(null);
      return;
    }
    if (storedKey === key) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await previewPromotions({
          items,
          customerId: customer ?? undefined,
          codes: codes.length ? codes : undefined,
        });
        if (cancelled) return;
        if (result.ok) {
          setPromo({ key, perLine: result.data.perLine, applied: result.data.applied });
          return;
        }
        // A rejected coupon is explained once and dropped, so the cart stays usable.
        if (codes.length > 0) {
          toast.error(tErrors(result.error));
          clearPromoCodes();
        }
      } catch {
        // offline blip: totals simply stay without promotions until the next change
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, online, storedKey, setPromo, clearPromoCodes, tErrors]);

  return key;
}
