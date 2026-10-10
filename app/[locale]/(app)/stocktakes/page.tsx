import { getTranslations, setRequestLocale } from "next-intl/server";
import { ClipboardList } from "lucide-react";
import { Link, redirect } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { CreateStocktakeDialog } from "@/components/stocktakes/create-stocktake-dialog";
import { getCategories } from "@/lib/supabase/queries/categories";
import { canCountStock, getStocktakes } from "@/lib/supabase/queries/stocktakes";

export default async function StocktakesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!(await canCountStock())) redirect({ href: "/register", locale });

  const [t, stocktakes, categories] = await Promise.all([
    getTranslations("stocktakes"),
    getStocktakes(),
    getCategories(),
  ]);
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader
        className="mb-0"
        title={t("title")}
        description={t("description")}
        actions={<CreateStocktakeDialog categories={categories} />}
      />
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-3 text-start">{t("colNumber")}</th>
              <th className="p-3 text-start">{t("colScope")}</th>
              <th className="p-3 text-start">{t("colStatus")}</th>
              <th className="p-3 text-start">{t("colCreated")}</th>
            </tr>
          </thead>
          <tbody>
            {stocktakes.map((stocktake) => (
              <tr key={stocktake.id} className="border-b last:border-0">
                <td className="p-3 tabular-nums">
                  <Link className="text-primary underline-offset-4 hover:underline" href={`/stocktakes/${stocktake.id}`}>
                    #{stocktake.stocktake_number}
                  </Link>
                </td>
                <td className="p-3">
                  {stocktake.scope === "full"
                    ? t("scopeFull")
                    : `${t("scopeCycle")}: ${locale === "ar" ? stocktake.category_name_ar : stocktake.category_name_en}`}
                </td>
                <td className="p-3">
                  <Badge variant={stocktake.status === "approved" ? "outline" : "secondary"}>
                    {t(`status.${stocktake.status}`)}
                  </Badge>
                </td>
                <td className="p-3">{when.format(new Date(stocktake.created_at))}</td>
              </tr>
            ))}
            {stocktakes.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <EmptyState icon={ClipboardList} title={t("empty")} className="py-8" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
