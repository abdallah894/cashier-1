import { requireAdmin } from "@/lib/supabase/queries/profiles";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getProduct, getStockMovements } from "@/lib/supabase/queries/products";
import { getCategories } from "@/lib/supabase/queries/categories";
import { ProductForm } from "@/components/products/product-form";
import { StockAdjustDialog } from "@/components/products/stock-adjust-dialog";
import { DeleteProductButton } from "@/components/products/delete-product-button";
import { MovementsTable } from "@/components/products/movements-table";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireAdmin();

  const [t, product, categories, movements] = await Promise.all([
    getTranslations("products"),
    getProduct(id),
    getCategories(),
    getStockMovements(id),
  ]);
  if (!product) notFound();

  const name = locale === "ar" ? product.name_ar : product.name_en;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="min-w-0 text-2xl font-semibold tracking-tight break-words">{name}</h1>
        <div className="flex flex-wrap gap-2">
          <StockAdjustDialog product={product} />
          <DeleteProductButton productId={product.id} name={name} />
        </div>
      </div>

      <ProductForm categories={categories} product={product} />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("movementsTitle")}</h2>
        <MovementsTable movements={movements} />
      </section>
    </div>
  );
}
