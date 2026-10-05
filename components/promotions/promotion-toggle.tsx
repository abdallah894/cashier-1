"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { setPromotionActive } from "@/lib/actions/promotions";
import { Switch } from "@/components/ui/switch";

export function PromotionToggle({ promotionId, active, name }: { promotionId: string; active: boolean; name: string }) {
  const t = useTranslations("promotions");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Switch
      checked={active}
      disabled={pending}
      aria-label={t("toggle", { name })}
      onCheckedChange={(next) =>
        startTransition(async () => {
          const result = await setPromotionActive({ promotionId, active: next });
          if (!result.ok) {
            toast.error(tErrors(result.error));
            return;
          }
          router.refresh();
        })
      }
    />
  );
}
