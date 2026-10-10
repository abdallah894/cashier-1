"use client";

import { useTranslations } from "next-intl";
import { Keyboard, UserRoundCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const SHORTCUTS = [
  { keys: "/", label: "focusSearch" },
  { keys: "F2", label: "openCheckout" },
  { keys: "F4", label: "lineDiscount" },
  { keys: "F5", label: "saleDiscount" },
  { keys: "F6", label: "customer" },
  { keys: "F7", label: "promoCode" },
  { keys: "3*", label: "multiplier" },
  { keys: "Ctrl+Del", label: "voidCart" },
  { keys: "F8", label: "cameraScan" },
  { keys: "F9", label: "switchCashier" },
  { keys: "↑↓", label: "selectLine" },
  { keys: "+/−", label: "changeQty" },
  { keys: "Del", label: "removeLine" },
  { keys: "Esc", label: "close" },
  { keys: "?", label: "showAll" },
] as const;

// the ones a cashier uses every sale; the rest live behind "?"
const PINNED = ["/", "F2", "F8", "3*"] as const;

/** A few key hints, the full list on "?" (Vue: a dialog toggled by a v-model prop). */
export function ShortcutsBar({
  open,
  onOpenChange,
  onSwitchCashier,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitchCashier?: () => void;
}) {
  const t = useTranslations("register.shortcuts");

  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs">
      {SHORTCUTS.filter((s) => (PINNED as readonly string[]).includes(s.keys)).map((s) => (
        <span key={s.keys} className="hidden items-center gap-1.5 md:flex">
          <Kbd>{s.keys}</Kbd>
          {t(s.label)}
        </span>
      ))}
      <Button variant="ghost" size="sm" className="hidden md:inline-flex" onClick={() => onOpenChange(true)}>
        <Keyboard className="size-4" />
        {t("showAll")}
        <Kbd>?</Kbd>
      </Button>
      {onSwitchCashier && (
        <Button variant="ghost" size="sm" className="ms-auto" onClick={onSwitchCashier}>
          <UserRoundCog className="size-4" />
          {t("switchCashier")}
        </Button>
      )}

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {SHORTCUTS.map((s) => (
              <div key={s.keys} className="flex items-center justify-between gap-3 border-b py-1.5">
                <dt className="first-letter:uppercase">{t(s.label)}</dt>
                <dd>
                  <Kbd>{s.keys}</Kbd>
                </dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </div>
  );
}
