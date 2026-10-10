"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ALL = "all";

/** Pick one kind of event; the choice lives in the URL so it survives reloads and links. */
export function AuditFilter({ actions }: { actions: readonly string[] }) {
  const t = useTranslations("audit");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get("action") ?? ALL;

  function choose(value: string) {
    const params = new URLSearchParams(searchParams);
    params.delete("page");
    if (value === ALL) params.delete("action");
    else params.set("action", value);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <Select value={current} onValueChange={choose}>
      <SelectTrigger className="w-full sm:w-72" aria-label={t("filter")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{t("allActions")}</SelectItem>
        {actions.map((action) => (
          <SelectItem key={action} value={action}>
            {t(`actions.${action}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
