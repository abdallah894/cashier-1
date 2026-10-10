"use client";

import { useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Loader2, Coins } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { recordCashDrawerEvent } from "@/lib/actions/cash-drawer";
import { formatEgp, parseEgpToPiasters } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type EventType = "paid_in" | "paid_out" | "safe_drop";

const icons = {
  paid_in: ArrowDownToLine,
  paid_out: ArrowUpFromLine,
  safe_drop: Coins,
};

/** Records a non-sale cash movement through the immutable drawer ledger. */
export function CashDrawerEventDialog({ shiftId }: { shiftId: string }) {
  const t = useTranslations("shifts");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<EventType>("paid_in");
  const [amountInput, setAmountInput] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const amount = parseEgpToPiasters(amountInput);

  async function submit() {
    if (submitting || amount === null || amount <= 0 || !reason.trim()) return;
    setSubmitting(true);
    try {
      const result = await recordCashDrawerEvent({ shiftId, type, amount, reason });
      if (!result.ok) return toast.error(tErrors(result.error));
      toast.success(t("drawerEventRecorded", { amount: formatEgp(amount, locale) }));
      setAmountInput("");
      setReason("");
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  const Icon = icons[type];
  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && setOpen(next)}>
      <DialogTrigger asChild>
        <Button variant="outline"><Coins className="size-4" />{t("cashDrawer")}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{t("cashDrawer")}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
            {(["paid_in", "paid_out", "safe_drop"] as const).map((option) => {
              const OptionIcon = icons[option];
              return <Button key={option} type="button" variant={type === option ? "default" : "outline"} className="h-auto flex-col gap-1 py-3 text-xs" onClick={() => setType(option)}><OptionIcon className="size-4" />{t(option)}</Button>;
            })}
          </div>
          <Input dir="ltr" inputMode="decimal" value={amountInput} onChange={(e) => setAmountInput(e.target.value)} placeholder={t("amount")} aria-label={t("amount")} />
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("drawerReason")} aria-label={t("drawerReason")} maxLength={500} />
          <p className="text-muted-foreground flex items-center gap-2 text-xs"><Icon className="size-4" />{t(`${type}Hint`)}</p>
        </div>
        <DialogFooter><Button onClick={() => void submit()} disabled={submitting || amount === null || amount <= 0 || !reason.trim()} className="w-full">{submitting && <Loader2 className="size-4 animate-spin" />}{t("recordDrawerEvent")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
