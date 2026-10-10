"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { cancelPurchaseOrder, closePurchaseOrder, placePurchaseOrder } from "@/lib/actions/purchasing";
import type { Database } from "@/lib/supabase/database.types";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";

/** Admin lifecycle buttons; the buttons shown follow the allowed status transitions. */
export function PurchaseOrderActions({
  poId,
  status,
}: {
  poId: string;
  status: Database["public"]["Enums"]["purchase_order_status"];
}) {
  const t = useTranslations("purchaseOrders");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run(action: (input: unknown) => Promise<{ ok: boolean; error?: string }>, doneKey: string) {
    setBusy(true);
    try {
      const result = await action({ poId });
      if (!result.ok) {
        toast.error(tErrors(result.error ?? "unknown"));
        return;
      }
      toast.success(t(doneKey));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {status === "draft" && (
        <Button disabled={busy} onClick={() => run(placePurchaseOrder, "placed")}>
          {t("place")}
        </Button>
      )}
      {(status === "draft" || status === "ordered") && (
        <ConfirmButton
          disabled={busy}
          title={t("cancelOrderTitle")}
          description={t("cancelOrderBody")}
          confirmLabel={t("cancelOrder")}
          onConfirm={() => run(cancelPurchaseOrder, "cancelledDone")}
        >
          {t("cancelOrder")}
        </ConfirmButton>
      )}
      {status === "partially_received" && (
        <ConfirmButton
          disabled={busy}
          title={t("closeShortTitle")}
          description={t("closeShortBody")}
          confirmLabel={t("closeShort")}
          onConfirm={() => run(closePurchaseOrder, "closedDone")}
        >
          {t("closeShort")}
        </ConfirmButton>
      )}
    </div>
  );
}
