"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Banknote, CreditCard, Loader2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { createManagerApproval } from "@/lib/actions/approvals";
import { createSale } from "@/lib/actions/sales";
import { approvalRequestHash } from "@/lib/approvals/hash";
import { useOnline } from "@/hooks/use-online";
import { getOfflineDb } from "@/lib/offline/db";
import { loadDiscountThreshold } from "@/lib/offline/catalog";
import { enqueueSale } from "@/lib/offline/outbox";
import { buildProvisionalReceipt, discountNeedsApproval } from "@/lib/offline/provisional";
import { formatEgp, parseEgpToPiasters, piastersToEgpInput } from "@/lib/money";
import { isValidPaymentReference } from "@/lib/payments/providers";
import { useCart, toSaleItems, toQueuedSaleItems, type CartTotals } from "@/lib/store/cart";
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
  userId,
  shiftId,
  cashierName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  totals: CartTotals;
  userId: string;
  shiftId: string;
  cashierName: string | null;
}) {
  const t = useTranslations("register.checkoutDialog");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const clearCart = useCart((s) => s.clear);
  const online = useOnline();
  const customer = useCart((state) => state.customer);
  const promoCodes = useCart((state) => state.promoCodes);

  const [chosenMethod, setChosenMethod] = useState<"cash" | "card">("cash");
  const [tenderedInput, setTenderedInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [managerPin, setManagerPin] = useState("");
  const [cardReference, setCardReference] = useState("");
  // One idempotency key per checkout attempt: a retry (or the offline queue
  // taking over after a lost response) can never create a second sale.
  const saleKeyRef = useRef<string | null>(null);

  // Card payments cannot be confirmed without the network: offline is cash only.
  const method = online ? chosenMethod : "cash";

  function resetForm() {
    setChosenMethod("cash");
    setTenderedInput("");
    setManagerPin("");
    setCardReference("");
    saleKeyRef.current = null;
  }

  // reset on close so the next checkout starts fresh
  function handleOpenChange(next: boolean) {
    if (submitting) return;
    if (!next) resetForm();
    onOpenChange(next);
  }

  const tendered = parseEgpToPiasters(tenderedInput);
  const change = tendered !== null ? tendered - totals.total : null;
  const cashInvalid = method === "cash" && (tendered === null || tendered < totals.total);
  // a card sale is only recorded with the terminal's approval code
  const cardInvalid = method === "card" && !isValidPaymentReference(cardReference.trim());

  /** Records a cash sale in the local outbox and prints a provisional receipt. */
  async function queueOffline(key: string): Promise<void> {
    if (tendered === null) return;
    const db = getOfflineDb();
    // Large discounts need a live manager approval, which needs the server.
    if (discountNeedsApproval(totals, await loadDiscountThreshold(db))) {
      toast.error(t("offlineDiscountBlocked"));
      return;
    }
    const entry = await enqueueSale(db, {
      id: key,
      userId,
      shiftId,
      items: toQueuedSaleItems(totals),
      amountTendered: tendered,
      provisional: buildProvisionalReceipt(totals, tendered, cashierName),
    });
    clearCart();
    toast.success(t("queuedDone", { number: entry.localNumber }));
    resetForm();
    onOpenChange(false);
    router.push(`/offline-sales/${entry.id}?new=1`);
  }

  async function confirm() {
    if (submitting || totals.lines.length === 0) return;
    if ((method === "cash" && cashInvalid) || (method === "card" && cardInvalid)) return;
    setSubmitting(true);
    try {
      const key = (saleKeyRef.current ??= crypto.randomUUID());

      if (!online) {
        await queueOffline(key);
        return;
      }

      const payload = {
        items: toSaleItems(totals),
        payment_method: method,
        amount_tendered: method === "cash" ? tendered : null,
        idempotencyKey: key,
        shiftId,
        cardReference: method === "card" ? cardReference.trim() : undefined,
        customerId: customer?.id,
        promotionCodes: promoCodes.length ? promoCodes : undefined,
        // the total the customer was shown; the server refuses if rules moved meanwhile
        expectedTotal: totals.total,
      };
      let result;
      try {
        result = await createSale(payload);
        if (!result.ok && result.error === "managerApprovalRequired" && /^\d{4}$/.test(managerPin)) {
          // Large discounts need a one-time manager approval bound to these amounts.
          const requestHash = await approvalRequestHash(
            `sale_discount|${totals.baseTotal}|${totals.manualDiscountTotal}`
          );
          const approval = await createManagerApproval({ action: "sale_discount", requestHash, pin: managerPin });
          if (!approval.ok) {
            toast.error(tErrors(approval.error));
            return;
          }
          result = await createSale({ ...payload, approvalId: approval.data.approvalId });
        }
      } catch {
        // The connection dropped mid-request, so the sale may or may not be
        // recorded. Cash falls back to the queue under the SAME key (the
        // server replays instead of duplicating); a card sale cannot be
        // confirmed, so the cashier must verify it before retrying.
        if (method === "cash") await queueOffline(key);
        else toast.error(tErrors("cardUnconfirmed"));
        return;
      }
      if (!result.ok) {
        if (result.error === "totalChanged") useCart.getState().setPromo(null); // re-evaluate before retrying
        toast.error(tErrors(result.error));
        return; // cart stays intact — fix and retry
      }
      clearCart();
      toast.success(t("saleDone", { number: result.data.saleNumber }));
      resetForm();
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

        {!online && (
          <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
            {t("offlineNotice")}
          </p>
        )}

        <Tabs value={method} onValueChange={(v) => setChosenMethod(v as "cash" | "card")}>
          <TabsList className="w-full">
            <TabsTrigger value="cash" className="flex-1 gap-2">
              <Banknote className="size-4" />
              {t("cash")}
            </TabsTrigger>
            <TabsTrigger value="card" className="flex-1 gap-2" disabled={!online}>
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
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-sm">{t("cardHint")}</p>
            <Input
              dir="ltr"
              autoFocus
              value={cardReference}
              onChange={(e) => setCardReference(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirm()}
              placeholder={t("cardReference")}
              aria-label={t("cardReference")}
              aria-invalid={cardReference !== "" && cardInvalid}
              className="h-12 text-center text-lg tabular-nums"
            />
            <p className="text-muted-foreground text-xs">{t("cardReferenceHint")}</p>
          </div>
        )}

        {totals.manualDiscountTotal > 0 && (
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
          <Button onClick={confirm} disabled={submitting || cashInvalid || cardInvalid} className="min-w-32">
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
