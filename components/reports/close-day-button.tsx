"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { closeBusinessDay } from "@/lib/actions/ops";
import { Button } from "@/components/ui/button";

/** Closes one finished business day: stores an immutable snapshot of its totals. */
export function CloseDayButton({ day }: { day: string }) {
  const t = useTranslations("opsReports");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await closeBusinessDay({ day });
          if (!result.ok) {
            toast.error(tErrors(result.error));
            return;
          }
          toast.success(t("dayClosed", { day }));
          router.refresh();
        })
      }
    >
      {t("closeDay")}
    </Button>
  );
}
