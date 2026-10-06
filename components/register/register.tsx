"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { useBarcodeScanner } from "@/hooks/use-barcode-scanner";
import { useOnline } from "@/hooks/use-online";
import { usePromotionPreview } from "@/hooks/use-promotion-preview";
import { lookupBarcode } from "@/lib/offline/register-data";
import { useCart, computeTotals } from "@/lib/store/cart";
import { CartPane } from "./cart-pane";
import { SearchPane, type SearchPaneHandle } from "./search-pane";
import { CheckoutDialog } from "./checkout-dialog";
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

  const unknownBarcodeOpen = unknownBarcode !== null;
  const dialogOpen = checkoutOpen || cameraOpen || switchOpen || unknownBarcodeOpen;

  async function handleScan(barcode: string) {
    // the burst may have landed in the search box — wipe it
    searchRef.current?.clear();
    try {
      // live lookup online, last synced catalog offline
      const { product } = await lookupBarcode(barcode);
      if (!product) {
        setUnknownBarcode(barcode);
        return;
      }
      addProduct(product); // increments qty if already in the cart
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
      if (event.key === "F9") {
        event.preventDefault();
        setSwitchOpen(true);
        return;
      }
      if (inField) return;

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
          if (selected) state.setQty(selected.productId, selected.qty + 1);
          break;
        case "-":
          if (selected) state.setQty(selected.productId, selected.qty - 1);
          break;
        case "Delete":
          if (selected) state.removeItem(selected.productId);
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialogOpen]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
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
          onAdd={addProduct}
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
      />
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
