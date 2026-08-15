"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, PackagePlus } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { adjustStock } from "@/lib/actions/products";
import { parseQty } from "@/lib/money";
import type { Tables } from "@/lib/supabase/database.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Reason = "received" | "damaged" | "correction";
type Direction = "add" | "remove";

export function StockAdjustDialog({ product }: { product: Tables<"products"> }) {
  const t = useTranslations("stock");
  const tErrors = useTranslations("errors");
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<Reason>("received");
  const [direction, setDirection] = useState<Direction>("add");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [qtyError, setQtyError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // received always adds; damaged always removes; correction is either.
  const effectiveDirection: Direction =
    reason === "received" ? "add" : reason === "damaged" ? "remove" : direction;

  async function submit() {
    const parsed = parseQty(qty, product.unit);
    if (parsed === null || parsed === 0) {
      setQtyError(true);
      return;
    }
    setQtyError(false);
    setSubmitting(true);
    try {
      const result = await adjustStock({
        product_id: product.id,
        qty_change: effectiveDirection === "add" ? parsed : -parsed,
        reason,
        note: note.trim() || undefined,
      });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      toast.success(t("adjusted", { qty: Number(result.data.newQty) }));
      setOpen(false);
      setQty("");
      setNote("");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <PackagePlus className="size-4" />
          {t("adjust")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("adjustTitle")}</DialogTitle>
          <DialogDescription>
            {t("currentStock", { qty: Number(product.stock_qty) })}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>{t("reason")}</FieldLabel>
            <Select value={reason} onValueChange={(v) => setReason(v as Reason)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="received">{t("reasons.received")}</SelectItem>
                <SelectItem value="damaged">{t("reasons.damaged")}</SelectItem>
                <SelectItem value="correction">{t("reasons.correction")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {reason === "correction" && (
            <Field>
              <FieldLabel>{t("direction")}</FieldLabel>
              <Select value={direction} onValueChange={(v) => setDirection(v as Direction)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="add">{t("directionAdd")}</SelectItem>
                  <SelectItem value="remove">{t("directionRemove")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor="adjust-qty">
              {effectiveDirection === "add" ? t("qtyToAdd") : t("qtyToRemove")}
            </FieldLabel>
            <Input
              id="adjust-qty"
              dir="ltr"
              inputMode="decimal"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder={product.unit === "kg" ? "1.250" : "10"}
            />
            {qtyError && <FieldError>{t("invalidQty")}</FieldError>}
          </Field>
          <Field>
            <FieldLabel htmlFor="adjust-note">{t("note")}</FieldLabel>
            <Textarea
              id="adjust-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder={t("notePlaceholder")}
            />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
