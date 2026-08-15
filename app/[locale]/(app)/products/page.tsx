import { requireAdmin } from "@/lib/supabase/queries/profiles";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { Plus, Upload } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { getProducts } from "@/lib/supabase/queries/products";
import { getCategories } from "@/lib/supabase/queries/categories";
import { ProductsToolbar } from "@/components/products/products-toolbar";
import { ProductsTable } from "@/components/products/products-table";
import { TablePagination } from "@/components/products/table-pagination";

export default async function ProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; category?: string; active?: string; page?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdmin();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);

  // Two independent queries — start both, await together (Vue: like two
  // useAsyncData calls; here plain Promise.all in a Server Component).
  const [t, list, categories] = await Promise.all([
    getTranslations("products"),
    getProducts({ q: sp.q, categoryId: sp.category, active: sp.active, page }),
    getCategories(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">{t("count", { count: list.total })}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/products/import">
              <Upload className="size-4" />
              {t("importCsv")}
            </Link>
          </Button>
          <Button asChild>
            <Link href="/products/new">
              <Plus className="size-4" />
              {t("newProduct")}
            </Link>
          </Button>
        </div>
      </div>

      <ProductsToolbar categories={categories} />
      <ProductsTable rows={list.rows} />
      <TablePagination page={list.page} pageCount={list.pageCount} total={list.total} />
    </div>
  );
}
