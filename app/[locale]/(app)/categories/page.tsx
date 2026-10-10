import { requireAdmin } from "@/lib/supabase/queries/profiles";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getCategories, getCategoryProductCounts } from "@/lib/supabase/queries/categories";
import { CategoriesManager } from "@/components/categories/categories-manager";
import { PageHeader } from "@/components/layout/page-header";

export default async function CategoriesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdmin();

  const [t, categories, counts] = await Promise.all([
    getTranslations("categories"),
    getCategories(),
    getCategoryProductCounts(),
  ]);

  const rows = categories.map((c) => ({ ...c, productCount: counts.get(c.id) ?? 0 }));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader className="mb-0" title={t("title")} description={t("subtitle")} />
      <CategoriesManager categories={rows} />
    </div>
  );
}
