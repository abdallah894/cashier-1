"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { confirmPayment, failPayment, resolvePayment } from "@/lib/actions/payments";
import { isValidPaymentReference } from "@/lib/payments/providers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Mode = "fail" | "resolve" | null;

/**
 * Recovery actions for one payment. Which buttons appear follows the
 * payment's state; the database enforces the same rules.
 */
export function PaymentActions({
  paymentId,
  reason,
  hasReference,
  isAdmin,
}: {
  paymentId: string;
  reason: "pending" | "orphan" | "refundPending" | "refundFailed";
  hasReference: boolean;
  isAdmin: boolean;
}) {
  const t = useTranslations("payments");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reference, setReference] = useState("");
  const [mode, setMode] = useState<Mode>(null);
  const [note, setNote] = useState("");
  const [failStatus, setFailStatus] = useState<"declined" | "failed" | "voided">("declined");

  function run(action: () => Promise<{ ok: boolean; error?: string }>, doneKey: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(tErrors(result.error ?? "unknown"));
        return;
      }
      toast.success(t(doneKey));
      setMode(null);
      setNote("");
      setReference("");
      router.refresh();
    });
  }

  const canConfirm = reason === "pending" || reason === "refundPending";
  const referenceOk = hasReference || isValidPaymentReference(reference.trim());

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {canConfirm && (
        <>
          {!hasReference && (
            <Input
              dir="ltr"
              className="h-8 w-36"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={t("referencePlaceholder")}
              aria-label={t("referencePlaceholder")}
            />
          )}
          <Button
            size="sm"
            disabled={pending || !referenceOk}
            onClick={() =>
              run(() => confirmPayment({ paymentId, reference: hasReference ? undefined : reference.trim() }), "confirmed")
            }
          >
            {reason === "refundPending" ? t("confirmRefund") : t("confirmPayment")}
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setMode("fail")}>
            {t("markFailed")}
          </Button>
        </>
      )}
      {isAdmin && (reason === "orphan" || reason === "refundFailed" || canConfirm) && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => setMode("resolve")}>
          {t("resolve")}
        </Button>
      )}

      <Dialog open={mode !== null} onOpenChange={(open) => !open && setMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mode === "fail" ? t("failTitle") : t("resolveTitle")}</DialogTitle>
            <DialogDescription>{mode === "fail" ? t("failDescription") : t("resolveDescription")}</DialogDescription>
          </DialogHeader>
          {mode === "fail" && (
            <Select value={failStatus} onValueChange={(value) => setFailStatus(value as typeof failStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="declined">{t("statusDeclined")}</SelectItem>
                <SelectItem value="failed">{t("statusFailed")}</SelectItem>
                <SelectItem value="voided">{t("statusVoided")}</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("notePlaceholder")} aria-label={t("notePlaceholder")} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setMode(null)} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button
              disabled={pending || note.trim() === ""}
              onClick={() =>
                mode === "fail"
                  ? run(() => failPayment({ paymentId, status: failStatus, note }), "failedDone")
                  : run(() => resolvePayment({ paymentId, note }), "resolved")
              }
            >
              {mode === "fail" ? t("markFailed") : t("resolve")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
