"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { useBarcodeScanner } from "@/hooks/use-barcode-scanner";
import { useOnline } from "@/hooks/use-online";
import { usePromotionPreview } from "@/hooks/use-promotion-preview";
import { lookupBarcode, lookupWeighed } from "@/lib/offline/register-data";
import { qtyStep } from "@/lib/register/multiplier";
import { parseQty } from "@/lib/money";
import type { Tables } from "@/lib/supabase/database.types";
import { useCart, computeTotals } from "@/lib/store/cart";
import { CartPane } from "./cart-pane";
import { SearchPane, type SearchPaneHandle } from "./search-pane";
import { CheckoutDialog } from "./checkout-dialog";
import { ProvisionalReceiptDialog } from "@/components/offline/provisional-receipt-dialog";
import type { OutboxEntry } from "@/lib/offline/types";
import { CameraScanDialog } from "./camera-scan-dialog";
import { PinSwitchDialog, type SwitchableCashier } from "./pin-switch-dialog";
import { ShortcutsBar } from "./shortcuts-bar";
import { UnknownBarcodeDialog } from "./unknown-barcode-dialog";

export function Register({
  isAdmin,
  cashiers,
  userId,
  shiftId,
  cashierName,
}: {
  isAdmin: boolean;
  cashiers: SwitchableCashier[];
  userId: string;
  shiftId: string;
  cashierName: string | null;
}) {
  const t = useTranslations("register");
  const router = useRouter();

  const items = useCart((s) => s.items);
  const saleDiscount = useCart((s) => s.saleDiscount);
  const selectedIndex = useCart((s) => s.selectedIndex);
  const addProduct = useCart((s) => s.addProduct);
  const setQty = useCart((s) => s.setQty);
  const removeItem = useCart((s) => s.removeItem);
  const setSelectedIndex = useCart((s) => s.setSelectedIndex);

  // derived, not stored — recomputed on every cart change (Pinia getters
  // would live in the store; the Zustand idiom is useMemo over state)
  const online = useOnline();
  const promo = useCart((s) => s.promo);
  const baseTotals = useMemo(() => computeTotals(items, saleDiscount), [items, saleDiscount]);
  // the server evaluates promotions; the preview is only used while it matches the current cart
  const previewKey = usePromotionPreview(baseTotals, online);
  const totals = useMemo(
    () => computeTotals(items, saleDiscount, online && promo?.key === previewKey ? promo.perLine : []),
    [items, saleDiscount, online, promo, previewKey]
  );

  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [unknownBarcode, setUnknownBarcode] = useState<string | null>(null);
  const searchRef = useRef<SearchPaneHandle>(null);

  // receipt of a sale just rung offline, shown in place (no server page can load without a network)
  const [provisional, setProvisional] = useState<OutboxEntry | null>(null);

  // "3*" typed in the search box: the next item added counts this many
  const [pendingQty, setPendingQty] = useState<number | null>(null);

  /** Adds a product, applying (and clearing) a pending "3*" multiplier. */
  function addWithMultiplier(product: Tables<"products">) {
    if (pendingQty === null) {
      addProduct(product);
      return;
    }
    setPendingQty(null);
    if (parseQty(String(pendingQty), product.unit) === null) {
      toast.error(t("multiplierWholeOnly"));
      return;
    }
    addProduct(product, pendingQty);
  }

  const unknownBarcodeOpen = unknownBarcode !== null;
  const dialogOpen = checkoutOpen || cameraOpen || switchOpen || unknownBarcodeOpen || provisional !== null;

  async function handleScan(barcode: string) {
    // the burst may have landed in the search box — wipe it
    searchRef.current?.clear();
    try {
      // live lookup online, last synced catalog offline
      const { product } = await lookupBarcode(barcode);
      if (!product) {
        // not a product barcode: maybe a label printed by the deli/produce scale (weight or price inside)
        const weighed = await lookupWeighed(barcode);
        if (!weighed) {
          setUnknownBarcode(barcode);
        } else if (!weighed.ok) {
          toast.error(t(weighed.reason === "unknownPlu" ? "unknownPlu" : "notByWeight", { plu: weighed.plu }));
        } else {
          addProduct(weighed.product, weighed.qty); // adds the label's weight; a second pack of the same item adds up
        }
        return;
      }
      addWithMultiplier(product); // increments qty if already in the cart
    } catch {
      toast.error(t("scanFailed"));
    }
  }

  // while a window is open (payment, camera...) a scan must not reach its inputs
  useBarcodeScanner(handleScan, { enabled: !dialogOpen, onBlockedScan: () => toast.error(t("scanBlocked")) });

  function handleUnknownBarcodeOpenChange(next: boolean) {
    if (!next) setUnknownBarcode(null);
  }

  function createUnknownBarcodeProduct() {
    if (!unknownBarcode) return;
    const barcode = unknownBarcode;
    setUnknownBarcode(null);
    router.push(`/products/new?barcode=${encodeURIComponent(barcode)}`);
  }

  // keyboard flow: / search · F2 checkout · ↑↓ select · +/- qty · Del remove
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (dialogOpen) return;
      const inField =
        event.target instanceof HTMLElement && event.target.closest("input, textarea, select");
      // the empty search box is not "typing": arrows and +/- still drive the cart from it
      const inEmptySearch =
        event.target instanceof HTMLInputElement && event.target.hasAttribute("data-register-search") && event.target.value === "";
      const clickShortcut = (name: string) => document.querySelector<HTMLElement>(`[data-shortcut="${name}"]`)?.click();
      const focusShortcut = (name: string) => document.querySelector<HTMLElement>(`[data-shortcut="${name}"]`)?.focus();

      if (event.key === "/" && !inField) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key === "F2") {
        event.preventDefault();
        if (useCart.getState().items.length > 0) setCheckoutOpen(true);
        return;
      }
      if (event.key === "F8") {
        event.preventDefault();
        setCameraOpen(true);
        return;
      }
      if (event.key === "F4") {
        event.preventDefault();
        clickShortcut("line-discount");
        return;
      }
      if (event.key === "F5") {
        event.preventDefault(); // also stops the browser reloading the till mid-sale
        clickShortcut("sale-discount");
        return;
      }
      if (event.key === "F6") {
        event.preventDefault();
        clickShortcut("customer");
        return;
      }
      if (event.key === "F7") {
        event.preventDefault();
        focusShortcut("promo-code");
        return;
      }
      if (event.key === "Delete" && event.ctrlKey && (!inField || inEmptySearch)) {
        event.preventDefault();
        clickShortcut("void-cart");
        return;
      }
      if (event.key === "F9") {
        event.preventDefault();
        setSwitchOpen(true);
        return;
      }
      if (inField && !inEmptySearch) return;

      const state = useCart.getState();
      const { items: cartItems, selectedIndex: sel } = state;
      if (cartItems.length === 0) return;
      const selected = cartItems[sel];

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          state.setSelectedIndex(Math.min(sel + 1, cartItems.length - 1));
          break;
        case "ArrowUp":
          event.preventDefault();
          state.setSelectedIndex(Math.max(sel - 1, 0));
          break;
        case "+":
          if (selected) {
            event.preventDefault();
            state.setQty(selected.productId, selected.qty + qtyStep(selected.unit));
          }
          break;
        case "-":
          if (selected) {
            event.preventDefault();
            state.setQty(selected.productId, selected.qty - qtyStep(selected.unit));
          }
          break;
        case "Delete":
          if (selected && !inField) state.removeItem(selected.productId);
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialogOpen]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {pendingQty !== null && (
        <div role="status" className="bg-primary/10 text-primary flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium">
          {t("multiplierActive", { qty: pendingQty })}
          <button type="button" className="ms-auto text-xs underline" onClick={() => setPendingQty(null)}>
            {t("multiplierCancel")}
          </button>
        </div>
      )}
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <CartPane
          totals={totals}
          selectedIndex={selectedIndex}
          onSelect={setSelectedIndex}
          onQtyChange={setQty}
          onRemove={removeItem}
        />
        <SearchPane
          ref={searchRef}
          onAdd={addWithMultiplier}
          onMultiplier={setPendingQty}
          onOpenCamera={() => setCameraOpen(true)}
          onOpenCheckout={() => setCheckoutOpen(true)}
          hasItems={items.length > 0}
          total={totals.total}
        />
      </div>
      <ShortcutsBar onSwitchCashier={() => setSwitchOpen(true)} />

      <PinSwitchDialog cashiers={cashiers} open={switchOpen} onOpenChange={setSwitchOpen} />
      <CheckoutDialog
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        totals={totals}
        userId={userId}
        shiftId={shiftId}
        cashierName={cashierName}
        onQueued={setProvisional}
      />
      <ProvisionalReceiptDialog entry={provisional} onClose={() => setProvisional(null)} />
      <CameraScanDialog open={cameraOpen} onOpenChange={setCameraOpen} onScan={handleScan} />
      <UnknownBarcodeDialog
        barcode={unknownBarcode}
        canCreate={isAdmin}
        open={unknownBarcodeOpen}
        onOpenChange={handleUnknownBarcodeOpenChange}
        onCreate={createUnknownBarcodeProduct}
      />
    </div>
  );
}
