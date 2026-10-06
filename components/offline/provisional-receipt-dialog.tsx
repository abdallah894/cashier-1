"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Printer } from "lucide-react";
import { DEFAULT_STORE_INFO } from "@/lib/receipts/store-info";
import type { StoreInfo } from "@/lib/receipts/types";
import { loadStoreInfo } from "@/lib/offline/catalog";
import { getOfflineDb } from "@/lib/offline/db";
import type { OutboxEntry } from "@/lib/offline/types";
import { Receipt80mm } from "@/components/receipts/receipt-80mm";
import { toProvisionalReceipt } from "@/components/offline/provisional-receipt-view";
import { Button } from "@/components/ui/button";

/**
 * Shows the provisional receipt of a sale just rung offline, ON the register.
 * Navigating to /offline-sales/[id] is not an option here: that is a server
 * page the browser has never loaded, so with no network it would show the
 * browser's own error page at the exact moment the cashier needs a receipt.
 *
 * A plain fixed overlay (not a Radix dialog): the print stylesheet lifts
 * `.receipt-print-area` to the top-left of the page, which only works when no
 * ancestor is transformed.
 */
export function ProvisionalReceiptDialog({ entry, onClose }: { entry: OutboxEntry | null; onClose: () => void }) {
  const t = useTranslations("offline");
  const [store, setStore] = useState<StoreInfo>(DEFAULT_STORE_INFO);

  useEffect(() => {
    if (!entry) return;
    let active = true;
    void loadStoreInfo(getOfflineDb()).then((info) => active && info && setStore(info));
    return () => {
      active = false;
    };
  }, [entry]);

  useEffect(() => {
    if (!entry) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entry, onClose]);

  if (!entry) return null;
  return (
    <div role="dialog" aria-modal="true" data-testid="provisional-receipt" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 print:bg-transparent">
      <div className="bg-background flex max-h-full w-full max-w-sm flex-col gap-3 overflow-y-auto rounded-xl p-4 shadow-lg print:overflow-visible print:p-0 print:shadow-none">
        <h2 className="text-lg font-semibold">{t("provisionalTitle", { number: entry.localNumber })}</h2>
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">{t("provisionalHint.queued")}</p>
        <div className="receipt-print-area self-center overflow-hidden rounded-md border shadow-sm">
          <Receipt80mm receipt={toProvisionalReceipt(entry, store)} />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => window.print()}>
            <Printer className="size-4" />
            {t("print")}
          </Button>
          <Button autoFocus className="flex-1" data-testid="provisional-receipt-close" onClick={onClose}>
            {t("backToRegister")}
          </Button>
        </div>
      </div>
    </div>
  );
}
