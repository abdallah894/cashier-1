import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const LINKS = [
  { key: "overview", href: "/reports" },
  { key: "daily", href: "/reports/daily" },
  { key: "vat", href: "/reports/vat" },
  { key: "stock", href: "/reports/stock" },
  { key: "reorder", href: "/reports/reorder" },
] as const;

/** Section switcher shared by every operational report. */
export function ReportsNav({ active }: { active: (typeof LINKS)[number]["key"] }) {
  const t = useTranslations("opsReports.nav");
  return (
    <nav className="flex flex-wrap gap-2" aria-label={t("label")}>
      {LINKS.map((link) => (
        <Button key={link.key} asChild size="sm" variant={link.key === active ? "default" : "outline"}>
          <Link href={link.href}>{t(link.key)}</Link>
        </Button>
      ))}
    </nav>
  );
}

/** Business-day range picker; a plain GET form so the URL is the state. */
export function RangeForm({ from, to }: { from: string; to: string }) {
  const t = useTranslations("opsReports");
  return (
    <form method="get" className="flex flex-wrap items-end gap-2">
      <label className="text-muted-foreground flex items-center gap-1 text-sm">
        {t("from")}
        <Input type="date" name="from" dir="ltr" defaultValue={from} className="h-9 w-auto" />
      </label>
      <label className="text-muted-foreground flex items-center gap-1 text-sm">
        {t("to")}
        <Input type="date" name="to" dir="ltr" defaultValue={to} className="h-9 w-auto" />
      </label>
      <Button type="submit" size="sm">
        {t("apply")}
      </Button>
    </form>
  );
}
