"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { anonymizeCustomer, setCustomerConsent } from "@/lib/actions/customers";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Consent toggle and the erasure action for one customer. Every change is audited server-side. */
export function CustomerActions({
  customerId,
  consent,
  anonymized,
}: {
  customerId: string;
  consent: boolean;
  anonymized: boolean;
}) {
  const t = useTranslations("customers");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  function toggleConsent(next: boolean) {
    startTransition(async () => {
      const result = await setCustomerConsent({ customerId, consent: next, source: "admin" });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      toast.success(next ? t("consentGranted") : t("consentWithdrawn"));
      router.refresh();
    });
  }

  function erase() {
    startTransition(async () => {
      const result = await anonymizeCustomer({ customerId });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      toast.success(t("anonymized"));
      setConfirmOpen(false);
      router.refresh();
    });
  }

  if (anonymized) return <p className="text-muted-foreground text-sm">{t("anonymizedNotice")}</p>;

  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="flex items-center gap-2">
        <Switch id="marketing-consent" checked={consent} onCheckedChange={toggleConsent} disabled={pending} />
        <Label htmlFor="marketing-consent">{t("marketingConsent")}</Label>
      </div>
      <Button variant="destructive" onClick={() => setConfirmOpen(true)} disabled={pending}>
        {t("anonymize")}
      </Button>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("anonymizeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("anonymizeDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("keepIt")}</AlertDialogCancel>
            <AlertDialogAction onClick={erase}>{t("anonymizeConfirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
