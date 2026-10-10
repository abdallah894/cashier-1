import { getTranslations, setRequestLocale } from "next-intl/server";
import { Tag } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { PromotionForm } from "@/components/promotions/promotion-form";
import { PromotionToggle } from "@/components/promotions/promotion-toggle";
import { EmptyState } from "@/components/ui/empty-state";
import { formatEgp } from "@/lib/money";
import { getCategories } from "@/lib/supabase/queries/categories";
import { requireAdmin } from "@/lib/supabase/queries/profiles";
import { getPromotions } from "@/lib/supabase/queries/promotions";

export default async function PromotionsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdmin();
  const [t, promotions, categories] = await Promise.all([getTranslations("promotions"), getPromotions(), getCategories()]);
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  const rule = (p: (typeof promotions)[number]) =>
    p.discount_kind === "percent"
      ? `${(p.percent_bp ?? 0) / 100}%`
      : `${formatEgp(Number(p.fixed_amount ?? 0), locale)}${p.scope === "items" ? ` / ${t("unit")}` : ""}`;

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader
        className="mb-0"
        title={t("title")}
        description={t("description")}
        actions={<PromotionForm categories={categories} />}
      />
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-3 text-start">{t("name")}</th>
              <th className="p-3 text-start">{t("rule")}</th>
              <th className="p-3 text-start">{t("code")}</th>
              <th className="p-3 text-start">{t("window")}</th>
              <th className="p-3 text-start">{t("usage")}</th>
              <th className="p-3 text-start">{t("active")}</th>
            </tr>
          </thead>
          <tbody>
            {promotions.map((promotion) => {
              const name = locale === "ar" ? promotion.name_ar : promotion.name_en;
              return (
                <tr key={promotion.id} className="border-b align-top last:border-0">
                  <td className="p-3">
                    <div className="font-medium">{name}</div>
                    <div className="text-muted-foreground text-xs">
                      {promotion.scope === "order" ? t("scopeOrder") : t("scopeItems")}
                      {promotion.stackable ? ` · ${t("stackableShort")}` : ""}
                      {promotion.customer_required ? ` · ${t("customerRequiredShort")}` : ""}
                    </div>
                  </td>
                  <td className="p-3 tabular-nums" dir="ltr">{rule(promotion)}</td>
                  <td className="p-3" dir="ltr">{promotion.code ?? "—"}</td>
                  <td className="p-3 text-xs">
                    {promotion.starts_at ? when.format(new Date(promotion.starts_at)) : "—"} →{" "}
                    {promotion.ends_at ? when.format(new Date(promotion.ends_at)) : "—"}
                  </td>
                  <td className="p-3 tabular-nums" dir="ltr">
                    {promotion.redemptions}
                    {promotion.max_redemptions ? ` / ${promotion.max_redemptions}` : ""}
                    <div className="text-muted-foreground text-xs">{formatEgp(promotion.redeemed, locale)}</div>
                  </td>
                  <td className="p-3">
                    <PromotionToggle promotionId={promotion.id} active={promotion.active} name={name} />
                  </td>
                </tr>
              );
            })}
            {promotions.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <EmptyState icon={Tag} title={t("empty")} className="py-8" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
