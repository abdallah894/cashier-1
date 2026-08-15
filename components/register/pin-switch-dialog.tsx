"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ChevronLeft, Loader2, UserRound } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { switchCashier } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Numpad, type NumpadKey } from "@/components/ui/numpad";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type SwitchableCashier = { id: string; full_name: string };

export function PinSwitchDialog({
  cashiers,
  open,
  onOpenChange,
}: {
  cashiers: SwitchableCashier[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("pinSwitch");
  const tErrors = useTranslations("errors");
  const router = useRouter();

  const [selected, setSelected] = useState<SwitchableCashier | null>(null);
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setSelected(null);
    setPin("");
  }

  function handleOpenChange(next: boolean) {
    if (submitting) return;
    if (!next) reset();
    onOpenChange(next);
  }

  async function submit(target: SwitchableCashier, fullPin: string) {
    setSubmitting(true);
    try {
      const result = await switchCashier({ targetUserId: target.id, pin: fullPin });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        setPin("");
        return;
      }
      toast.success(t("switched", { name: result.data.name }));
      reset();
      onOpenChange(false);
      // new session cookie is set — re-render everything server-side
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  function pressKey(key: NumpadKey) {
    if (!selected || submitting) return;
    if (key === "backspace") {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (!/^\d$/.test(key)) return;
    const next = (pin + key).slice(0, 4);
    setPin(next);
    if (next.length === 4) void submit(selected, next); // auto-submit on 4th digit
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-sm"
        onKeyDown={(e) => {
          if (/^\d$/.test(e.key)) {
            e.preventDefault();
            pressKey(e.key as NumpadKey);
          } else if (e.key === "Backspace") {
            e.preventDefault();
            pressKey("backspace");
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {selected ? t("pinFor", { name: selected.full_name }) : t("title")}
          </DialogTitle>
        </DialogHeader>

        {!selected ? (
          <div className="flex flex-col gap-2">
            {cashiers.length === 0 && (
              <p className="text-muted-foreground py-2 text-sm">{t("noCashiers")}</p>
            )}
            {cashiers.map((cashier, i) => (
              <Button
                key={cashier.id}
                variant="outline"
                autoFocus={i === 0}
                className="h-12 justify-start text-base"
                onClick={() => setSelected(cashier)}
              >
                <UserRound className="size-4" />
                {cashier.full_name}
              </Button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <div className="flex gap-3 py-2" aria-label={t("enterPin")} dir="ltr">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={
                    "size-4 rounded-full border " +
                    (pin.length > i ? "bg-foreground border-foreground" : "border-input")
                  }
                />
              ))}
            </div>
            {submitting ? (
              <Loader2 className="text-muted-foreground size-6 animate-spin" />
            ) : (
              <Numpad onKey={pressKey} withDot={false} className="w-full" />
            )}
            <Button variant="ghost" size="sm" onClick={reset} disabled={submitting}>
              <ChevronLeft className="size-4 rtl:rotate-180" />
              {t("back")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
