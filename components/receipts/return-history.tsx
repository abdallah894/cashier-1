import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { formatEgp } from "@/lib/money";
import type { SaleReturn } from "@/lib/supabase/queries/sales";

export async function ReturnHistory({ returns }: { returns: SaleReturn[] }) {
  const t = await getTranslations("returns");
  const locale = await getLocale();
  const format = await getFormatter();
  if (returns.length === 0) return null;

  return (
    <section className="rounded-md border p-4">
      <h2 className="font-semibold">{t("history")}</h2>
      <div className="mt-3 grid gap-3">
        {returns.map((entry) => (
          <div key={entry.id} className="rounded-md bg-muted/50 p-3 text-sm">
            <div className="flex justify-between gap-3 font-medium">
              <span>{t("historyNumber", { number: entry.return_number })}</span>
              <span dir="ltr">{formatEgp(Number(entry.refund_total), locale)}</span>
            </div>
            <p className="mt-1 text-muted-foreground">
              {format.dateTime(new Date(entry.created_at), { dateStyle: "medium", timeStyle: "short" })}
              {entry.profiles?.full_name ? ` · ${entry.profiles.full_name}` : ""}
            </p>
            <p className="mt-1">{entry.reason}</p>
            <p className="mt-1 text-muted-foreground">
              {entry.restock ? t("historyRestocked") : t("historyNotRestocked")}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
