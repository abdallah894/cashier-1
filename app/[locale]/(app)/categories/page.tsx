import { requireAdmin } from "@/lib/supabase/queries/profiles";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getCategories, getCategoryProductCounts } from "@/lib/supabase/queries/categories";
import { CategoriesManager } from "@/components/categories/categories-manager";

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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground max-w-prose text-sm">{t("subtitle")}</p>
      </div>
      <CategoriesManager categories={rows} />
    </div>
  );
}
