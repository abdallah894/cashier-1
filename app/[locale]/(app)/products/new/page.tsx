import { requireAdmin } from "@/lib/supabase/queries/profiles";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getCategories } from "@/lib/supabase/queries/categories";
import { ProductForm } from "@/components/products/product-form";

export default async function NewProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ barcode?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdmin();
  const [t, categories, { barcode }] = await Promise.all([
    getTranslations("products"),
    getCategories(),
    searchParams,
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t("newProduct")}</h1>
      {/* barcode arrives prefilled from the register's unknown-barcode toast */}
      <ProductForm categories={categories} defaultBarcode={barcode} />
    </div>
  );
}
