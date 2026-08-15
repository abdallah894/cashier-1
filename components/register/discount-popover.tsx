"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { parseEgpToPiasters, normalizeDigits } from "@/lib/money";
import type { Discount } from "@/lib/store/cart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** Shared editor for line + whole-sale discounts: percent or fixed EGP. */
export function DiscountPopover({
  discount,
  onApply,
  children,
}: {
  discount: Discount | null;
  onApply: (discount: Discount | null) => void;
  children: React.ReactNode;
}) {
  const t = useTranslations("register.discount");
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"percent" | "fixed">(discount?.kind ?? "percent");
  const [value, setValue] = useState(() =>
    discount?.kind === "percent"
      ? String(discount.bp / 100)
      : discount?.kind === "fixed"
        ? String(discount.piasters / 100)
        : ""
  );
  const [invalid, setInvalid] = useState(false);

  function apply() {
    if (value.trim() === "" || Number(normalizeDigits(value)) === 0) {
      onApply(null); // empty/zero clears the discount
      setOpen(false);
      return;
    }
    if (kind === "percent") {
      const pct = Number(normalizeDigits(value));
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
        setInvalid(true);
        return;
      }
      onApply({ kind: "percent", bp: Math.round(pct * 100) });
    } else {
      const piasters = parseEgpToPiasters(value);
      if (piasters === null || piasters <= 0) {
        setInvalid(true);
        return;
      }
      onApply({ kind: "fixed", piasters });
    }
    setInvalid(false);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-64" align="end">
        <div className="flex flex-col gap-3">
          <Tabs value={kind} onValueChange={(v) => setKind(v as "percent" | "fixed")}>
            <TabsList className="w-full">
              <TabsTrigger value="percent" className="flex-1">
                {t("percent")}
              </TabsTrigger>
              <TabsTrigger value="fixed" className="flex-1">
                {t("fixed")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Input
            dir="ltr"
            inputMode="decimal"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && apply()}
            placeholder={kind === "percent" ? "10" : "5.00"}
            aria-invalid={invalid}
          />
          {invalid && <p className="text-destructive text-xs">{t("invalid")}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={apply} className="flex-1">
              {t("apply")}
            </Button>
            {discount && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  onApply(null);
                  setValue("");
                  setOpen(false);
                }}
              >
                {t("clear")}
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
