"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FileDown, Loader2, Printer } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ReceiptData } from "@/lib/receipts/types";

const AUTO_PRINT_KEY = "cachier.autoPrintReceipt";

// Tiny external store around localStorage for useSyncExternalStore —
// SSR sees `false`, the client snapshot reads the real value, and writes
// notify subscribers. (Vue equivalent: VueUse's useLocalStorage ref.)
const autoPrintListeners = new Set<() => void>();

function subscribeAutoPrint(onChange: () => void) {
  autoPrintListeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    autoPrintListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readAutoPrint() {
  return localStorage.getItem(AUTO_PRINT_KEY) === "1";
}

function writeAutoPrint(next: boolean) {
  localStorage.setItem(AUTO_PRINT_KEY, next ? "1" : "0");
  autoPrintListeners.forEach((notify) => notify());
}

export function ReceiptActions({
  receipt,
  justCompleted,
}: {
  receipt: ReceiptData;
  justCompleted: boolean;
}) {
  const t = useTranslations("receipt");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const autoPrint = useSyncExternalStore(subscribeAutoPrint, readAutoPrint, () => false);
  const [downloading, setDownloading] = useState(false);
  const firedRef = useRef(false);

  // fresh from checkout + toggle on → open the print dialog exactly once
  useEffect(() => {
    if (!justCompleted || firedRef.current) return;
    if (localStorage.getItem(AUTO_PRINT_KEY) !== "1") return;
    firedRef.current = true;
    const id = setTimeout(() => window.print(), 300);
    return () => clearTimeout(id);
  }, [justCompleted]);

  async function downloadPdf() {
    if (downloading) return;
    setDownloading(true);
    try {
      // dynamic import ≈ defineAsyncComponent for plain modules: jsPDF
      // (~350KB) loads only when someone actually downloads a PDF
      const { downloadReceiptPdf } = await import("@/lib/receipts/pdf");
      await downloadReceiptPdf(receipt, locale, {
        taxId: t("taxId", { id: receipt.store.taxId }),
        saleNo: t("saleNo"),
        date: t("date"),
        cashier: t("cashier"),
        discount: t("discount"),
        subtotal: t("subtotal"),
        vatRate: (rate) => t("vatRate", { rate }),
        total: t("total"),
        paymentMethod: t("paymentMethod"),
        payment: t(`payment.${receipt.paymentMethod}`),
        tendered: t("tendered"),
        change: t("change"),
        thankYou: t("thankYou"),
      });
    } catch {
      toast.error(tErrors("pdfFailed"));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-3 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => window.print()}>
          <Printer className="size-4" />
          {t("print")}
        </Button>
        <Button variant="outline" onClick={downloadPdf} disabled={downloading}>
          {downloading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <FileDown className="size-4" />
          )}
          {t("downloadPdf")}
        </Button>
        <Button variant="outline" asChild className="ms-auto">
          <Link href="/register">{t("newSale")}</Link>
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="auto-print" checked={autoPrint} onCheckedChange={writeAutoPrint} />
        <Label htmlFor="auto-print" className="text-muted-foreground font-normal">
          {t("autoPrint")}
        </Label>
      </div>
    </div>
  );
}
