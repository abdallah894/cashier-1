"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Square } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { closeShift } from "@/lib/actions/shifts";
import { parseEgpToPiasters } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Numpad, type NumpadKey } from "@/components/ui/numpad";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** Counted-cash entry → close_shift RPC → navigate to the Z-report. */
export function CloseShiftDialog({ shiftId }: { shiftId: string }) {
  const t = useTranslations("shifts");
  const tErrors = useTranslations("errors");
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [countedInput, setCountedInput] = useState("");
  const [managerPin, setManagerPin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const counted = parseEgpToPiasters(countedInput);

  function pressKey(key: NumpadKey) {
    if (key === "backspace") setCountedInput((v) => v.slice(0, -1));
    else if (key === "." && countedInput.includes(".")) return;
    else setCountedInput((v) => v + key);
  }

  async function submit() {
    if (submitting || counted === null) return;
    setSubmitting(true);
    try {
      const result = await closeShift({ shiftId, counted, managerPin: managerPin || undefined });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      setOpen(false);
      router.push(`/shifts/${result.data.shiftId}`);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && setOpen(next)}>
      <DialogTrigger asChild>
        <Button variant="destructive">
          <Square className="size-4" />
          {t("close")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("countedCash")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            dir="ltr"
            inputMode="decimal"
            autoFocus
            value={countedInput}
            onChange={(e) => setCountedInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            className="h-12 text-center text-xl tabular-nums"
            aria-label={t("countedCash")}
          />
          <Numpad onKey={pressKey} />
          <Input
            dir="ltr"
            inputMode="numeric"
            type="password"
            value={managerPin}
            onChange={(e) => setManagerPin(e.target.value)}
            placeholder={t("managerPinOptional")}
            aria-label={t("managerPinOptional")}
          />
        </div>
        <DialogFooter>
          <Button onClick={() => void submit()} disabled={submitting || counted === null} className="w-full">
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {t("closeConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
