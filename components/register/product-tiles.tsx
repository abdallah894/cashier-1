"use client";

import { memo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { PackageSearch } from "lucide-react";
import { useCatalogTiles } from "@/hooks/use-catalog-tiles";
import { formatEgp } from "@/lib/money";
import type { Tables } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

/**
 * Touch browsing: category chips and a grid of product tiles; a tap adds
 * the product. Read from the offline catalog, so it works without a network.
 */
// memo: typing in the search box must not re-render every tile (React.memo ≈ a Vue component that only updates when its props change)
export const ProductTiles = memo(function ProductTiles({ onAdd }: { onAdd: (product: Tables<"products">) => void }) {
  const t = useTranslations("register.tiles");
  const locale = useLocale() === "ar" ? "ar" : "en";
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const tiles = useCatalogTiles(categoryId, locale);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {tiles && tiles.categories.length > 0 && (
        <div role="group" aria-label={t("categories")} className="flex gap-2 overflow-x-auto border-b p-2">
          <CategoryChip active={categoryId === null} onClick={() => setCategoryId(null)}>
            {t("all")}
          </CategoryChip>
          {tiles.categories.map((category) => (
            <CategoryChip key={category.id} active={categoryId === category.id} onClick={() => setCategoryId(category.id)}>
              {locale === "ar" ? category.nameAr : category.nameEn}
            </CategoryChip>
          ))}
        </div>
      )}

      {/* phones: a capped window of tiles so the cart stays reachable */}
      <div className="max-h-[45svh] min-h-0 flex-1 overflow-y-auto p-2 lg:max-h-none">
        {tiles && tiles.products.length === 0 ? (
          <div className="text-muted-foreground flex h-full min-h-40 flex-col items-center justify-center gap-2 p-6 text-center text-sm">
            <PackageSearch className="size-8 opacity-40" />
            {t("empty")}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
            {tiles?.products.map((product) => {
              const out = Number(product.stock_qty) <= 0;
              return (
                <button
                  key={product.id}
                  type="button"
                  data-product-tile
                  // a tap must not move focus away from the search box (scanner + keyboard flow)
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => onAdd(product)}
                  className={cn(
                    "bg-background hover:border-primary hover:bg-accent active:bg-accent flex min-h-24 flex-col justify-between gap-2 rounded-lg border p-3 text-start transition-colors",
                    out && "opacity-60"
                  )}
                >
                  <span className="line-clamp-2 text-sm font-medium leading-snug">
                    {locale === "ar" ? product.name_ar : product.name_en}
                  </span>
                  <span className="flex items-end justify-between gap-1">
                    <span className="font-semibold tabular-nums" dir="ltr">
                      {formatEgp(product.price, locale)}
                    </span>
                    {product.unit === "kg" && <span className="text-muted-foreground text-xs">{t("perKg")}</span>}
                  </span>
                  {out && <span className="text-destructive text-xs">{t("outOfStock")}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});

function CategoryChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onPointerDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "h-10 shrink-0 rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-colors",
        active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent"
      )}
    >
      {children}
    </button>
  );
}
