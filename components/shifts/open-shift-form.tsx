"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Play } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { openShift } from "@/lib/actions/shifts";
import { formatEgp, parseEgpToPiasters } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Numpad, type NumpadKey } from "@/components/ui/numpad";

/** Opening-float entry. Used by the register gate and the shifts page. */
export function OpenShiftForm() {
  const t = useTranslations("shifts");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();

  const [floatInput, setFloatInput] = useState("0");
  const [submitting, setSubmitting] = useState(false);

  const piasters = parseEgpToPiasters(floatInput);

  function pressKey(key: NumpadKey) {
    if (key === "backspace") setFloatInput((v) => v.slice(0, -1));
    else if (key === "." && floatInput.includes(".")) return;
    else setFloatInput((v) => (v === "0" && key !== "." ? key : v + key));
  }

  async function submit() {
    if (submitting || piasters === null) return;
    setSubmitting(true);
    try {
      const result = await openShift({ openingFloat: piasters });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      toast.success(t("opened", { float: formatEgp(piasters, locale) }));
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex w-full max-w-xs flex-col gap-3">
      <Input
        dir="ltr"
        inputMode="decimal"
        autoFocus
        value={floatInput}
        onChange={(e) => setFloatInput(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => e.key === "Enter" && void submit()}
        className="h-12 text-center text-xl tabular-nums"
        aria-label={t("openingFloat")}
      />
      <Numpad onKey={pressKey} />
      <Button onClick={() => void submit()} disabled={submitting || piasters === null} className="h-12">
        {submitting ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
        {t("open")}
      </Button>
    </div>
  );
}
