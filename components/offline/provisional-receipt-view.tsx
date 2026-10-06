"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Printer } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { DEFAULT_STORE_INFO } from "@/lib/receipts/store-info";
import type { ReceiptData, StoreInfo } from "@/lib/receipts/types";
import { loadStoreInfo } from "@/lib/offline/catalog";
import { getOfflineDb } from "@/lib/offline/db";
import { getOutboxEntry } from "@/lib/offline/outbox";
import type { OutboxEntry } from "@/lib/offline/types";
import { Receipt80mm } from "@/components/receipts/receipt-80mm";
import { Button } from "@/components/ui/button";

export function toProvisionalReceipt(entry: OutboxEntry, store: StoreInfo): ReceiptData {
  const p = entry.provisional;
  return {
    store,
    saleId: entry.id,
    saleNumber: entry.saleNumber ?? 0,
    createdAt: entry.createdAt,
    cashierName: p.cashierName,
    paymentMethod: "cash",
    lines: p.lines,
    vatBreakdown: p.vatBreakdown,
    subtotal: p.subtotal,
    taxTotal: p.taxTotal,
    discountTotal: p.discountTotal,
    total: p.total,
    amountTendered: p.amountTendered,
    changeDue: p.changeDue,
    qrValue: `P-${entry.localNumber}`,
    provisionalLabel: `P-${entry.localNumber}`,
  };
}

/** Provisional receipt for a sale rung offline; the final numbered one lives at /receipts/[id] after sync. */
export function ProvisionalReceiptView({ id }: { id: string }) {
  const t = useTranslations("offline");
  const [entry, setEntry] = useState<OutboxEntry | null | undefined>(undefined);
  const [store, setStore] = useState<StoreInfo>(DEFAULT_STORE_INFO);

  useEffect(() => {
    let active = true;
    void getOutboxEntry(getOfflineDb(), id).then((row) => active && setEntry(row ?? null));
    void loadStoreInfo(getOfflineDb()).then((info) => active && info && setStore(info));
    return () => {
      active = false;
    };
  }, [id]);

  if (entry === undefined) return null;
  if (entry === null) return <p className="text-muted-foreground p-6 text-center">{t("notFound")}</p>;

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t("provisionalTitle", { number: entry.localNumber })}</h1>
      <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
        {t(`provisionalHint.${entry.status}`)}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="size-4" />
          {t("print")}
        </Button>
        {entry.status === "synced" && entry.saleId && (
          <Button asChild>
            <Link href={`/receipts/${entry.saleId}`}>{t("finalReceipt")}</Link>
          </Button>
        )}
        <Button asChild variant="ghost">
          <Link href="/register">{t("backToRegister")}</Link>
        </Button>
      </div>
      <div className="receipt-print-area self-center overflow-hidden rounded-md border shadow-sm">
        <Receipt80mm receipt={toProvisionalReceipt(entry, store)} />
      </div>
    </div>
  );
}
