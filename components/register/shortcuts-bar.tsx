"use client";

import { useTranslations } from "next-intl";
import { UserRoundCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";

const SHORTCUTS = [
  { keys: "/", label: "focusSearch" },
  { keys: "F2", label: "openCheckout" },
  { keys: "F8", label: "cameraScan" },
  { keys: "F9", label: "switchCashier" },
  { keys: "↑↓", label: "selectLine" },
  { keys: "+/−", label: "changeQty" },
  { keys: "Del", label: "removeLine" },
  { keys: "Esc", label: "close" },
] as const;

export function ShortcutsBar({ onSwitchCashier }: { onSwitchCashier?: () => void }) {
  const t = useTranslations("register.shortcuts");

  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs">
      {SHORTCUTS.map((s) => (
        <span key={s.keys} className="flex items-center gap-1.5">
          <Kbd>{s.keys}</Kbd>
          {t(s.label)}
        </span>
      ))}
      {onSwitchCashier && (
        <Button variant="ghost" size="sm" className="ms-auto h-7" onClick={onSwitchCashier}>
          <UserRoundCog className="size-4" />
          {t("switchCashier")}
        </Button>
      )}
    </div>
  );
}
