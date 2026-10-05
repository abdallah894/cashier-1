"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { setStaffCapabilities } from "@/lib/actions/users";
import type { Database } from "@/lib/supabase/database.types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Capability = Database["public"]["Enums"]["capability"];
type Target = { id: string; fullName: string; capabilities: Capability[] };

const CAPABILITIES: Capability[] = [
  "return.approve",
  "cart.void",
  "discount.override",
  "stock.correct",
  "cash.drawer.adjust",
  "shift.close.override",
  "customer.manage",
];

/** Grants a cashier extra authority without making them an admin. The server RPC is the authority; this is the editor. */
export function CapabilitiesDialog({
  target,
  onOpenChange,
}: {
  target: Target | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* keyed by user: the editor state starts from that user's grants */}
        {target && <CapabilitiesBody key={target.id} target={target} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function CapabilitiesBody({ target, onClose }: { target: Target; onClose: () => void }) {
  const t = useTranslations("users.capabilities");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<Capability>>(() => new Set(target.capabilities));

  function toggle(capability: Capability, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(capability);
      else next.delete(capability);
      return next;
    });
  }

  function save() {
    startTransition(async () => {
      const result = await setStaffCapabilities({ userId: target.id, capabilities: [...selected] });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      toast.success(t("saved", { name: target.fullName }));
      onClose();
      router.refresh();
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("title", { name: target.fullName })}</DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        {CAPABILITIES.map((capability) => (
          <div key={capability} className="flex items-center justify-between gap-3 rounded-md border p-3">
            <Label htmlFor={`cap-${capability}`} className="grid gap-0.5">
              <span>{t(`names.${capability}`)}</span>
              <span className="text-muted-foreground text-xs font-normal">{t(`hints.${capability}`)}</span>
            </Label>
            <Switch
              id={`cap-${capability}`}
              checked={selected.has(capability)}
              onCheckedChange={(on) => toggle(capability, on)}
            />
          </div>
        ))}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={pending}>
          {t("cancel")}
        </Button>
        <Button onClick={save} disabled={pending}>
          {t("save")}
        </Button>
      </DialogFooter>
    </>
  );
}
