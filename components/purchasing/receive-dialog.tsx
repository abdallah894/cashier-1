"use client";

import { useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { PackageCheck } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { receivePurchaseOrder } from "@/lib/actions/purchasing";
import { parseEgpToPiasters, parseQty, piastersToEgpInput } from "@/lib/money";
import type { PurchaseOrderLine } from "@/lib/supabase/queries/purchasing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type Entry = { qty: string; cost: string };

/**
 * Receives goods against an open order. Partial receipts are normal; the
 * server enforces the over-receipt tolerance. One idempotency key per
 * dialog session means a double click can never receive twice.
 */
export function ReceiveDialog({
  poId,
  lines,
  tolerancePct,
}: {
  poId: string;
  lines: PurchaseOrderLine[];
  tolerancePct: number;
}) {
  const t = useTranslations("purchaseOrders");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const keyRef = useRef<string | null>(null);
  const [invoice, setInvoice] = useState("");
  const [note, setNote] = useState("");

  const remaining = (line: PurchaseOrderLine) => Math.max(0, Number(line.ordered_qty) - Number(line.received_qty));
  const [entries, setEntries] = useState<Record<string, Entry>>(() =>
    Object.fromEntries(lines.map((line) => [line.id, { qty: "", cost: piastersToEgpInput(Number(line.unit_cost)) }]))
  );

  const rows = lines.map((line) => ({
    line,
    qty: entries[line.id]?.qty.trim() === "" ? 0 : parseQty(entries[line.id]?.qty ?? "", line.unit),
    cost: parseEgpToPiasters(entries[line.id]?.cost ?? ""),
  }));
  const anyEntered = rows.some((row) => row.qty !== null && row.qty > 0);
  const allValid = rows.every((row) => row.qty !== null && row.cost !== null);

  function submit() {
    keyRef.current ??= crypto.randomUUID();
    startTransition(async () => {
      const result = await receivePurchaseOrder({
        poId,
        invoiceReference: invoice || undefined,
        note: note || undefined,
        idempotencyKey: keyRef.current,
        lines: rows
          .filter((row) => row.qty !== null && row.qty > 0)
          .map((row) => ({ poLineId: row.line.id, qty: row.qty, unitCost: row.cost })),
      });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      toast.success(t("receivedDone"));
      keyRef.current = null;
      setOpen(false);
      setInvoice("");
      setNote("");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PackageCheck className="size-4" />
          {t("receive")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("receiveTitle")}</DialogTitle>
          <DialogDescription>
            {t("receiveDescription", { pct: tolerancePct })}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="invoice">{t("invoiceReference")}</Label>
              <Input id="invoice" dir="ltr" value={invoice} onChange={(e) => setInvoice(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="receive-note">{t("note")}</Label>
              <Input id="receive-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-2 text-start">{t("colProduct")}</th>
                <th className="p-2 text-start">{t("colRemaining")}</th>
                <th className="p-2 text-start">{t("colReceiveNow")}</th>
                <th className="p-2 text-start">{t("colInvoicedCost")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ line, qty, cost }) => (
                <tr key={line.id} className="border-b last:border-0">
                  <td className="p-2">{locale === "ar" ? line.name_ar : line.name_en}</td>
                  <td className="p-2 tabular-nums" dir="ltr">{remaining(line)}</td>
                  <td className="p-2">
                    <Input
                      dir="ltr"
                      inputMode="decimal"
                      className="w-24 tabular-nums"
                      value={entries[line.id]?.qty ?? ""}
                      aria-invalid={qty === null}
                      disabled={remaining(line) <= 0 && tolerancePct === 0}
                      onChange={(e) => setEntries((current) => ({ ...current, [line.id]: { ...current[line.id], qty: e.target.value } }))}
                    />
                  </td>
                  <td className="p-2">
                    <Input
                      dir="ltr"
                      inputMode="decimal"
                      className="w-28 tabular-nums"
                      value={entries[line.id]?.cost ?? ""}
                      aria-invalid={cost === null}
                      onChange={(e) => setEntries((current) => ({ ...current, [line.id]: { ...current[line.id], cost: e.target.value } }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button onClick={submit} disabled={pending || !anyEntered || !allValid}>
            {t("confirmReceive")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
