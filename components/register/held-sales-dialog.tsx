"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Clock, PlayCircle, Trash2, UserRound } from "lucide-react";
import { formatEgp } from "@/lib/money";
import type { HeldSale } from "@/lib/register/held-sales";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Carts put aside on this till; any cashier can bring one back. */
export function HeldSalesDialog({
  open,
  onOpenChange,
  held,
  onRecall,
  onDiscard,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  held: HeldSale[];
  onRecall: (id: string) => void;
  onDiscard: (id: string) => void;
}) {
  const t = useTranslations("register.held");
  const locale = useLocale();
  const format = useFormatter();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        {held.length === 0 ? (
          <EmptyState icon={Clock} title={t("empty")} className="py-8" />
        ) : (
          <ul className="flex flex-col gap-2">
            {held.map((sale, index) => {
              const count = sale.items.reduce((sum, item) => sum + (item.unit === "kg" ? 1 : item.qty), 0);
              return (
                <li key={sale.id} data-held-sale className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold tabular-nums" dir="ltr">
                        {formatEgp(sale.total, locale)}
                      </span>
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {format.dateTime(new Date(sale.heldAt), { timeStyle: "short" })}
                      </span>
                    </div>
                    <div className="text-muted-foreground flex flex-wrap gap-x-3 text-sm">
                      <span>{t("items", { count })}</span>
                      {sale.customer && (
                        <span className="flex items-center gap-1">
                          <UserRound className="size-3.5" />
                          {sale.customer.name}
                        </span>
                      )}
                      {sale.heldBy && <span>{t("heldBy", { name: sale.heldBy })}</span>}
                    </div>
                    <div className="text-muted-foreground truncate text-xs">
                      {sale.items.map((item) => (locale === "ar" ? item.nameAr : item.nameEn)).join(" · ")}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <ConfirmButton
                      variant="ghost"
                      title={t("discardTitle")}
                      description={t("discardBody")}
                      confirmLabel={t("discard")}
                      onConfirm={() => onDiscard(sale.id)}
                    >
                      <Trash2 className="size-4" />
                      <span className="sr-only">{t("discard")}</span>
                    </ConfirmButton>
                    <Button onClick={() => onRecall(sale.id)} autoFocus={index === 0}>
                      <PlayCircle className="size-4" />
                      {t("recall")}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
