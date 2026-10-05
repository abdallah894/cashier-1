"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Banknote, CreditCard, Loader2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { createManagerApproval } from "@/lib/actions/approvals";
import { createSale } from "@/lib/actions/sales";
import { approvalRequestHash } from "@/lib/approvals/hash";
import { formatEgp, parseEgpToPiasters, piastersToEgpInput } from "@/lib/money";
import { useCart, toSaleItems, type CartTotals } from "@/lib/store/cart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// EGP notes a cashier reaches for
const QUICK_NOTES = [5000, 10000, 20000] as const; // piasters: 50, 100, 200

export function CheckoutDialog({
  open,
  onOpenChange,
  totals,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  totals: CartTotals;
}) {
  const t = useTranslations("register.checkoutDialog");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const clearCart = useCart((s) => s.clear);

  const [method, setMethod] = useState<"cash" | "card">("cash");
  const [tenderedInput, setTenderedInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [managerPin, setManagerPin] = useState("");

  // reset on close so the next checkout starts fresh
  function handleOpenChange(next: boolean) {
    if (submitting) return;
    if (!next) {
      setMethod("cash");
      setTenderedInput("");
      setManagerPin("");
    }
    onOpenChange(next);
  }

  const tendered = parseEgpToPiasters(tenderedInput);
  const change = tendered !== null ? tendered - totals.total : null;
  const cashInvalid = method === "cash" && (tendered === null || tendered < totals.total);

  async function confirm() {
    if (submitting || totals.lines.length === 0) return;
    if (method === "cash" && cashInvalid) return;
    setSubmitting(true);
    try {
      const payload = {
        items: toSaleItems(totals),
        payment_method: method,
        amount_tendered: method === "cash" ? tendered : null,
      };
      let result = await createSale(payload);
      if (!result.ok && result.error === "managerApprovalRequired" && /^\d{4}$/.test(managerPin)) {
        // Large discounts need a one-time manager approval bound to these amounts.
        const requestHash = await approvalRequestHash(
          `sale_discount|${totals.baseTotal}|${totals.discountTotal}`
        );
        const approval = await createManagerApproval({ action: "sale_discount", requestHash, pin: managerPin });
        if (!approval.ok) {
          toast.error(tErrors(approval.error));
          return;
        }
        result = await createSale({ ...payload, approvalId: approval.data.approvalId });
      }
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return; // cart stays intact — fix and retry
      }
      clearCart();
      toast.success(t("saleDone", { number: result.data.saleNumber }));
      setMethod("cash");
      setTenderedInput("");
      setManagerPin("");
      onOpenChange(false);
      router.push(`/receipts/${result.data.saleId}?new=1`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>

        <div className="flex items-baseline justify-between">
          <span className="text-muted-foreground">{t("amountDue")}</span>
          <span className="text-3xl font-bold tabular-nums" dir="ltr">
            {formatEgp(totals.total, locale)}
          </span>
        </div>

        <Tabs value={method} onValueChange={(v) => setMethod(v as "cash" | "card")}>
          <TabsList className="w-full">
            <TabsTrigger value="cash" className="flex-1 gap-2">
              <Banknote className="size-4" />
              {t("cash")}
            </TabsTrigger>
            <TabsTrigger value="card" className="flex-1 gap-2">
              <CreditCard className="size-4" />
              {t("card")}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {method === "cash" ? (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => setTenderedInput(piastersToEgpInput(totals.total))}
              >
                {t("exact")}
              </Button>
              {QUICK_NOTES.map((note) => (
                <Button
                  key={note}
                  variant="outline"
                  size="sm"
                  className="flex-1 tabular-nums"
                  onClick={() => setTenderedInput(piastersToEgpInput(note))}
                >
                  {note / 100}
                </Button>
              ))}
            </div>
            <Input
              dir="ltr"
              inputMode="decimal"
              autoFocus
              value={tenderedInput}
              onChange={(e) => setTenderedInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirm()}
              placeholder={t("tenderedPlaceholder")}
              className="h-12 text-center text-xl tabular-nums"
              aria-label={t("tendered")}
            />
            <Separator />
            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground">{t("change")}</span>
              <span
                className={
                  "text-2xl font-semibold tabular-nums " +
                  (change !== null && change < 0
                    ? "text-destructive"
                    : "text-green-600 dark:text-green-500")
                }
                dir="ltr"
              >
                {change === null ? "—" : formatEgp(change, locale)}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground py-2 text-sm">{t("cardHint")}</p>
        )}

        {totals.discountTotal > 0 && (
          <Input
            dir="ltr"
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={managerPin}
            onChange={(e) => setManagerPin(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && confirm()}
            placeholder={t("managerPinOptional")}
            aria-label={t("managerPinOptional")}
          />
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t("cancel")}
          </Button>
          <Button onClick={confirm} disabled={submitting || cashInvalid} className="min-w-32">
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
