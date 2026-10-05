"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { handleReorderAlert } from "@/lib/actions/ops";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Mode = "dismiss" | "ordered" | null;

/** Acknowledge, link to an order, or dismiss (with a note) one low-stock alert. */
export function AlertActions({
  alertId,
  status,
  orders,
}: {
  alertId: string;
  status: string;
  orders: { id: string; po_number: number }[];
}) {
  const t = useTranslations("opsReports.alerts");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>(null);
  const [note, setNote] = useState("");
  const [poId, setPoId] = useState("");

  function run(action: "acknowledge" | "dismiss" | "ordered") {
    startTransition(async () => {
      const result = await handleReorderAlert({
        alertId,
        action,
        note: note || undefined,
        poId: poId || undefined,
      });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      toast.success(t("updated"));
      setMode(null);
      setNote("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap justify-end gap-2">
      {status === "open" && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run("acknowledge")}>
          {t("acknowledge")}
        </Button>
      )}
      {status !== "ordered" && (
        <Button size="sm" variant="outline" disabled={pending || orders.length === 0} onClick={() => setMode("ordered")}>
          {t("ordered")}
        </Button>
      )}
      {status !== "dismissed" && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setMode("dismiss")}>
          {t("dismiss")}
        </Button>
      )}

      <Dialog open={mode !== null} onOpenChange={(open) => !open && setMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mode === "dismiss" ? t("dismissTitle") : t("orderedTitle")}</DialogTitle>
            <DialogDescription>{mode === "dismiss" ? t("dismissDescription") : t("orderedDescription")}</DialogDescription>
          </DialogHeader>
          {mode === "ordered" && (
            <Select value={poId} onValueChange={setPoId}>
              <SelectTrigger>
                <SelectValue placeholder={t("pickOrder")} />
              </SelectTrigger>
              <SelectContent>
                {orders.map((order) => (
                  <SelectItem key={order.id} value={order.id}>
                    PO-{order.po_number}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("notePlaceholder")} aria-label={t("notePlaceholder")} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setMode(null)} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button
              disabled={pending || (mode === "dismiss" && note.trim() === "") || (mode === "ordered" && poId === "")}
              onClick={() => run(mode === "dismiss" ? "dismiss" : "ordered")}
            >
              {mode === "dismiss" ? t("dismiss") : t("ordered")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
