"use client";

import { useMemo, useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { submitReturn } from "@/app/[locale]/(app)/receipts/[id]/return-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatEgp } from "@/lib/money";

type ReturnableLine = {
  id: string;
  name_ar: string;
  name_en: string;
  qty: number;
  line_total: number;
};

export function ReturnDialog({
  saleId,
  paymentMethod,
  lines,
}: {
  saleId: string;
  paymentMethod: "cash" | "card";
  lines: ReturnableLine[];
}) {
  const t = useTranslations("returns");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [restock, setRestock] = useState(true);
  const [reason, setReason] = useState("");
  const [managerPin, setManagerPin] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const refundTotal = useMemo(
    () =>
      lines.reduce((total, line) => {
        const qty = Number(quantities[line.id] ?? 0);
        return total + (Number.isFinite(qty) && qty > 0 ? Math.round((line.line_total * qty) / line.qty) : 0);
      }, 0),
    [lines, quantities]
  );

  function reset() {
    setQuantities({});
    setReason("");
    setManagerPin("");
    setRestock(true);
  }

  function save() {
    const items = lines.flatMap((line) => {
      const qty = Number(quantities[line.id] ?? 0);
      return Number.isFinite(qty) && qty > 0 ? [{ saleItemId: line.id, qty }] : [];
    });
    startTransition(async () => {
      const result = await submitReturn({
        saleId,
        items,
        refundTender: paymentMethod,
        reason,
        restock,
        managerPin: managerPin || undefined,
      });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      toast.success(t("completed", { number: result.data.returnNumber }));
      setOpen(false);
      reset();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <RotateCcw className="size-4" />
          {t("start")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {lines.map((line) => (
            <div key={line.id} className="grid grid-cols-[1fr_7rem] items-center gap-3">
              <Label htmlFor={`return-${line.id}`}>
                {locale === "ar" ? line.name_ar : line.name_en}
                <span className="block text-xs font-normal text-muted-foreground">
                  {t("soldQty", { qty: line.qty })}
                </span>
              </Label>
              <Input
                id={`return-${line.id}`}
                type="number"
                min="0"
                max={line.qty}
                step="0.001"
                value={quantities[line.id] ?? ""}
                onChange={(event) =>
                  setQuantities((current) => ({ ...current, [line.id]: event.target.value }))
                }
              />
            </div>
          ))}
          <div className="flex items-center justify-between rounded-md bg-muted p-3 font-medium">
            <span>{t("refundTotal")}</span>
            <span dir="ltr">{formatEgp(refundTotal, locale)}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="return-restock">{t("restock")}</Label>
            <Switch id="return-restock" checked={restock} onCheckedChange={setRestock} />
          </div>
          {!restock && <p className="text-sm text-amber-700 dark:text-amber-400">{t("noRestockWarning")}</p>}
          <div className="grid gap-2">
            <Label htmlFor="return-reason">{t("reason")}</Label>
            <Textarea id="return-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="manager-pin">{t("managerPinOptional")}</Label>
            <Input
              id="manager-pin"
              inputMode="numeric"
              maxLength={4}
              value={managerPin}
              onChange={(event) => setManagerPin(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={pending || refundTotal <= 0 || !reason.trim()}>
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
