import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { CountSheet } from "@/components/stocktakes/count-sheet";
import { ReviewPanel } from "@/components/stocktakes/review-panel";
import { getCurrentProfile } from "@/lib/supabase/queries/profiles";
import {
  canCountStock,
  getStocktake,
  getStocktakeConflicts,
  getStocktakeVarianceReport,
} from "@/lib/supabase/queries/stocktakes";

export default async function StocktakePage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  if (!(await canCountStock())) redirect({ href: "/register", locale });

  const [t, found, profile] = await Promise.all([getTranslations("stocktakes"), getStocktake(id), getCurrentProfile()]);
  if (!found) notFound();
  const { stocktake, items } = found;
  const isAdmin = profile?.role === "admin";

  const reviewing = stocktake.status !== "open";
  const [report, conflicts] = reviewing
    ? await Promise.all([
        getStocktakeVarianceReport(id),
        stocktake.status === "submitted" ? getStocktakeConflicts(id) : Promise.resolve([]),
      ])
    : [[], []];

  return (
    <div className="flex w-full flex-col gap-4">
      <div>
        <Link className="text-muted-foreground text-sm hover:underline" href="/stocktakes">
          {t("back")}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("countTitle", { number: stocktake.stocktake_number })}
          </h1>
          <Badge variant={stocktake.status === "approved" ? "outline" : "secondary"}>
            {t(`status.${stocktake.status}`)}
          </Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          {stocktake.scope === "full"
            ? t("scopeFull")
            : `${t("scopeCycle")}: ${locale === "ar" ? stocktake.category_name_ar : stocktake.category_name_en}`}
          {stocktake.note ? ` · ${stocktake.note}` : ""}
        </p>
      </div>

      {stocktake.status === "open" ? (
        <CountSheet stocktakeId={id} items={items} showExpected={isAdmin} />
      ) : (
        <>
          {stocktake.status === "submitted" && !isAdmin && (
            <p className="rounded-md bg-sky-500/10 px-3 py-2 text-sm text-sky-700 dark:text-sky-400">{t("awaitingApproval")}</p>
          )}
          {stocktake.status === "cancelled" ? (
            <p className="text-muted-foreground">{t("cancelledNotice")}</p>
          ) : (
            <ReviewPanel
              stocktakeId={id}
              number={Number(stocktake.stocktake_number)}
              status={stocktake.status}
              rows={report}
              conflictIds={conflicts.map((conflict) => conflict.product_id)}
              isAdmin={isAdmin}
            />
          )}
        </>
      )}
    </div>
  );
}
