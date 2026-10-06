"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FileDown, Gift, Loader2, Printer, RotateCcw } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useDeviceErrorText } from "@/hooks/use-device-error";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import { authorizeDrawerOpen, completeDrawerOpening, completePrintJob, requestPrintJob } from "@/lib/actions/devices";
import { runDrawerOpen, runPrint, type PrintDeps } from "@/lib/devices/print-service";
import { buildRasterJob, buildReceiptEscPos, type EscPosLabels } from "@/lib/receipts/escpos";
import { buildReceiptRows, renderReceiptRgba } from "@/lib/receipts/canvas";
import type { ReceiptData } from "@/lib/receipts/types";
import { usePrinterTransport, type PrinterConfig } from "@/hooks/use-printer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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

type Kind = "original" | "reprint" | "gift";

export function ReceiptActions({
  receipt,
  justCompleted,
  printer,
  drawerDeviceId,
  printedCount,
  paidWithCash,
  gift,
}: {
  receipt: ReceiptData;
  justCompleted: boolean;
  /** thermal printer configured for this till (null = browser print only) */
  printer: PrinterConfig | null;
  /** id of the till's cash-drawer device, if one is configured */
  drawerDeviceId: string | null;
  /** how many times this receipt was already printed (gift copies excluded) */
  printedCount: number;
  paidWithCash: boolean;
  /** showing the gift view (no prices) */
  gift: boolean;
}) {
  const t = useTranslations("receipt");
  const tErrors = useTranslations("errors");
  const deviceError = useDeviceErrorText();
  const locale = useLocale() as "ar" | "en";
  const format = useFormatter();
  const router = useRouter();
  const autoPrint = useSyncExternalStore(subscribeAutoPrint, readAutoPrint, () => false);
  const transport = usePrinterTransport(printer);
  const [downloading, setDownloading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printed, setPrinted] = useState(printedCount > 0);
  const [failed, setFailed] = useState<{ kind: Kind; reason: string | null; error: string } | null>(null);
  const [reprintOpen, setReprintOpen] = useState(false);
  const [reason, setReason] = useState("");
  const autoFired = useRef(false);
  const drawerFired = useRef(false);

  const labels: EscPosLabels = {
    taxId: t("taxId", { id: receipt.store.taxId }),
    saleNo: t("saleNo"),
    date: t("date"),
    cashier: t("cashier"),
    subtotal: t("subtotal"),
    vatRate: (rate) => t("vatRate", { rate }),
    discount: t("discount"),
    total: t("total"),
    paymentMethod: t("paymentMethod"),
    payment: t(`payment.${receipt.paymentMethod}`),
    tendered: t("tendered"),
    change: t("change"),
    thankYou: t("thankYou"),
    gift: t("giftTitle"),
    giftNote: t("giftNote"),
    provisional: t("provisional"),
    copy: (n) => t("copyNumber", { n }),
  };

  const print = useCallback(
    async (kind: Kind, why: string | null = null) => {
      if (printing) return;
      setPrinting(true);
      setFailed(null);
      try {
        const deps: PrintDeps = {
          requestJob: async (jobKind, jobReason) => {
            const result = await requestPrintJob({
              documentType: "sale_receipt",
              documentId: receipt.saleId,
              kind: jobKind,
              reason: jobReason ?? undefined,
            });
            return result.ok
              ? { ok: true, jobId: result.data.jobId, copyNumber: result.data.copyNumber }
              : { ok: false, error: result.error };
          },
          completeJob: async (jobId, ok, error) => {
            await completePrintJob({ jobId, ok, error: error ?? undefined, deviceId: printer?.deviceId });
          },
          build: (copyNumber, jobKind) => {
            const options = {
              copyNumber,
              gift: jobKind === "gift",
              formatDate: (iso: string) => format.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "short" }),
            };
            if (locale === "ar") {
              // Arabic needs real shaping/RTL: draw it in the browser and print the bitmap
              const rows = buildReceiptRows(receipt, labels, { locale, ...options });
              const image = renderReceiptRgba(rows, locale);
              return buildRasterJob(image.width, image.height, image.data);
            }
            return buildReceiptEscPos(receipt, labels, { ...options, columns: printer?.columns ?? 48 });
          },
          transport,
          browserPrint: () => window.print(),
        };
        const outcome = await runPrint(deps, kind, why);
        if (outcome.status === "printed") {
          if (kind !== "gift") setPrinted(true);
          toast.success(t(outcome.via === "printer" ? "printedOnPrinter" : "printedInBrowser"));
        } else {
          // server refusals arrive as i18n keys; device errors as plain text
          const message = deviceError(outcome.error);
          setFailed({ kind, reason: why, error: message });
          toast.error(t("printFailed", { error: message }), { duration: 12_000 });
        }
      } finally {
        setPrinting(false);
      }
    },
    // labels/format are derived from stable inputs; the print inputs are what matter
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [printing, receipt, printer, transport, locale]
  );

  // fresh from checkout + toggle on → print exactly once (through the job log)
  useEffect(() => {
    if (!justCompleted || autoFired.current || printedCount > 0) return;
    if (localStorage.getItem(AUTO_PRINT_KEY) !== "1") return;
    autoFired.current = true;
    const id = setTimeout(() => void print("original"), 300);
    return () => clearTimeout(id);
  }, [justCompleted, printedCount, print]);

  // a cash sale just completed: open the drawer through an authorisation tied to this sale
  useEffect(() => {
    if (!justCompleted || !paidWithCash || !drawerDeviceId || drawerFired.current) return;
    if (printer && !transport) return; // wait until the paired printer has been found
    drawerFired.current = true;
    void runDrawerOpen({
      transport,
      authorize: async () => {
        const result = await authorizeDrawerOpen({ reason: "cash_sale", referenceId: receipt.saleId });
        return result.ok ? { ok: true, openingId: result.data.openingId } : { ok: false, error: result.error };
      },
      complete: async (openingId, ok, error) => {
        await completeDrawerOpening({ openingId, ok, error: error ?? undefined, deviceId: drawerDeviceId });
      },
    }).then((outcome) => {
      if (outcome.status === "failed") toast.error(t("drawerFailed", { error: deviceError(outcome.error) }));
      else if (outcome.status === "denied") toast.error(deviceError(outcome.error));
    });
  }, [justCompleted, paidWithCash, drawerDeviceId, printer, transport, receipt.saleId, t, deviceError]);

  async function downloadPdf() {
    if (downloading) return;
    setDownloading(true);
    try {
      // dynamic import ≈ defineAsyncComponent for plain modules: jsPDF
      // (~350KB) loads only when someone actually downloads a PDF
      const { downloadReceiptPdf } = await import("@/lib/receipts/pdf");
      await downloadReceiptPdf(receipt, locale, {
        taxId: labels.taxId,
        saleNo: labels.saleNo,
        date: labels.date,
        cashier: labels.cashier,
        discount: labels.discount,
        subtotal: labels.subtotal,
        vatRate: labels.vatRate,
        total: labels.total,
        paymentMethod: labels.paymentMethod,
        payment: labels.payment,
        tendered: labels.tendered,
        change: labels.change,
        thankYou: labels.thankYou,
      });
    } catch {
      toast.error(tErrors("pdfFailed"));
    } finally {
      setDownloading(false);
    }
  }

  const mainKind: Kind = gift ? "gift" : printed ? "reprint" : "original";

  return (
    <div className="flex w-full flex-col gap-3 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => (mainKind === "reprint" ? setReprintOpen(true) : void print(mainKind))}
          disabled={printing}
        >
          {printing ? <Loader2 className="size-4 animate-spin" /> : mainKind === "reprint" ? <RotateCcw className="size-4" /> : <Printer className="size-4" />}
          {mainKind === "reprint" ? t("reprint") : mainKind === "gift" ? t("printGift") : t("print")}
        </Button>
        <Button variant="outline" onClick={downloadPdf} disabled={downloading}>
          {downloading ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
          {t("downloadPdf")}
        </Button>
        <Button variant="outline" onClick={() => router.replace(gift ? "?" : "?gift=1")}>
          <Gift className="size-4" />
          {gift ? t("backToReceipt") : t("giftReceipt")}
        </Button>
        <Button variant="outline" asChild className="ms-auto">
          <Link href="/register">{t("newSale")}</Link>
        </Button>
      </div>

      {failed && (
        <div className="bg-destructive/10 text-destructive flex flex-wrap items-center gap-3 rounded-md px-3 py-2 text-sm" role="alert">
          <span>{t("printFailed", { error: failed.error })}</span>
          <Button size="sm" variant="outline" disabled={printing} onClick={() => void print(failed.kind, failed.reason)}>
            {t("retryPrint")}
          </Button>
        </div>
      )}

      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span>{transport ? t("usingPrinter", { name: transport.label }) : t("usingBrowser")}</span>
        {printed && <span>{t("printedAlready")}</span>}
      </div>

      <div className="flex items-center gap-2">
        <Switch id="auto-print" checked={autoPrint} onCheckedChange={writeAutoPrint} />
        <Label htmlFor="auto-print" className="text-muted-foreground font-normal">
          {t("autoPrint")}
        </Label>
      </div>

      <Dialog open={reprintOpen} onOpenChange={setReprintOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("reprintTitle")}</DialogTitle>
            <DialogDescription>{t("reprintDescription")}</DialogDescription>
          </DialogHeader>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("reprintReason")} aria-label={t("reprintReason")} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReprintOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              disabled={reason.trim() === "" || printing}
              onClick={() => {
                setReprintOpen(false);
                void print("reprint", reason.trim());
                setReason("");
              }}
            >
              {t("reprint")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
