"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { createManagerApproval } from "@/lib/actions/approvals";
import { voidCart } from "@/lib/actions/cart";
import { approvalRequestHash } from "@/lib/approvals/hash";
import { useCart, type CartTotals } from "@/lib/store/cart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** Clearing a non-empty cart is audited; without the cart.void capability it needs a manager PIN. */
export function VoidCartDialog({ totals }: { totals: CartTotals }) {
  const t = useTranslations("register.voidCart");
  const tErrors = useTranslations("errors");
  const clear = useCart((s) => s.clear);
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    try {
      const payload = { itemCount: totals.itemCount, value: totals.total };
      let result = await voidCart(payload);
      if (!result.ok && result.error === "managerApprovalRequired" && /^\d{4}$/.test(pin)) {
        const requestHash = await approvalRequestHash(`cart_void|${payload.itemCount}|${payload.value}`);
        const approval = await createManagerApproval({ action: "cart_void", requestHash, pin });
        if (!approval.ok) {
          toast.error(tErrors(approval.error));
          return;
        }
        result = await voidCart({ ...payload, approvalId: approval.data.approvalId });
      }
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      clear();
      setOpen(false);
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" data-shortcut="void-cart">
          {t("trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <Input
          dir="ltr"
          type="password"
          inputMode="numeric"
          maxLength={4}
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && confirm()}
          placeholder={t("pinPlaceholder")}
          aria-label={t("pinPlaceholder")}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
