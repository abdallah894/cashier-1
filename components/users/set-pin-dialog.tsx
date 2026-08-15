"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { setStaffPin } from "@/lib/actions/users";
import { Numpad, type NumpadKey } from "@/components/ui/numpad";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function SetPinDialog({
  userId,
  name,
  open,
  onOpenChange,
}: {
  userId: string | null;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("users");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function handleOpenChange(next: boolean) {
    if (submitting) return;
    if (!next) setPin("");
    onOpenChange(next);
  }

  async function submit(fullPin: string) {
    if (!userId) return;
    setSubmitting(true);
    try {
      const result = await setStaffPin({ userId, pin: fullPin });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        setPin("");
        return;
      }
      toast.success(t("pinSaved", { name }));
      setPin("");
      onOpenChange(false);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  function pressKey(key: NumpadKey) {
    if (submitting) return;
    if (key === "backspace") {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (!/^\d$/.test(key)) return;
    const next = (pin + key).slice(0, 4);
    setPin(next);
    if (next.length === 4) void submit(next);
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
          <DialogTitle>{t("setPinFor", { name })}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4">
          <div className="flex gap-3 py-2" dir="ltr">
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
