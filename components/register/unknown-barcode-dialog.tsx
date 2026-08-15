"use client";

import { useTranslations } from "next-intl";
import { PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function UnknownBarcodeDialog({
  barcode,
  canCreate,
  open,
  onOpenChange,
  onCreate,
}: {
  barcode: string | null;
  canCreate: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: () => void;
}) {
  const t = useTranslations("register.unknownBarcodeDialog");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t(canCreate ? "descriptionAdmin" : "descriptionCashier")}</DialogDescription>
        </DialogHeader>

        {barcode && (
          <div className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-lg tabular-nums" dir="ltr">
            {barcode}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          {canCreate && (
            <Button onClick={onCreate}>
              <PackagePlus className="size-4" />
              {t("create")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
