"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Camera, Search, X } from "lucide-react";
import { searchProducts } from "@/lib/offline/register-data";
import { formatEgp } from "@/lib/money";
import type { Tables } from "@/lib/supabase/database.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { ProductTiles } from "./product-tiles";
import { parseMultiplier } from "@/lib/register/multiplier";
import { cn } from "@/lib/utils";

export type SearchPaneHandle = { focus: () => void; clear: () => void };

type Props = {
  onAdd: (product: Tables<"products">) => void;
  /** "3*" + Enter in the search box: the next item counts this many */
  onMultiplier: (qty: number) => void;
  onOpenCamera: () => void;
};

export const SearchPane = forwardRef<SearchPaneHandle, Props>(function SearchPane(
  { onAdd, onMultiplier, onOpenCamera },
  ref
) {
  const t = useTranslations("register");
  const locale = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [highlight, setHighlight] = useState(0);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    clear: () => {
      setQuery("");
      setDebounced("");
    },
  }));

  // a stable callback for the memoised tile grid; it always calls the latest onAdd
  const onAddRef = useRef(onAdd);
  useEffect(() => {
    onAddRef.current = onAdd;
  });
  const addTile = useCallback((product: Tables<"products">) => onAddRef.current(product), []);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);

  // TanStack Query owns caching/dedupe/staleness — the Vue equivalent
  // is @tanstack/vue-query's useQuery, near-identical API.
  const { data, isFetching } = useQuery({
    queryKey: ["product-search", debounced],
    queryFn: () => searchProducts(debounced),
    enabled: debounced.length >= 1,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const results = useMemo(() => data?.products ?? [], [data]);
  // results came from the saved catalog: stock figures are approximate
  const approximate = data?.fromCache === true;

  useEffect(() => setHighlight(0), [results]);

  function addAndReset(product: Tables<"products">) {
    onAdd(product);
    setQuery("");
    setDebounced("");
    inputRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter") {
      const multiplier = parseMultiplier(query);
      if (multiplier !== null) {
        event.preventDefault();
        onMultiplier(multiplier);
        setQuery("");
        setDebounced("");
        return;
      }
    }
    if (results.length === 0) {
      if (event.key === "Escape") {
        setQuery("");
        inputRef.current?.blur();
      }
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setHighlight((h) => Math.min(h + 1, results.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setHighlight((h) => Math.max(h - 1, 0));
        break;
      case "Enter":
        // scanner bursts are consumed by the global hook before this fires
        event.preventDefault();
        if (results[highlight]) addAndReset(results[highlight]);
        break;
      case "Escape":
        setQuery("");
        break;
    }
  }

  return (
    // phones and tablets: products come first, the cart below
    <div className="bg-card order-first flex min-h-0 flex-col rounded-xl border lg:order-none">
      <div className="flex items-center gap-2 border-b p-2 sm:p-3">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground absolute start-3 top-1/2 size-5 -translate-y-1/2" />
          <Input
            ref={inputRef}
            data-register-search
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("searchPlaceholder")}
            className="h-12 ps-10 pe-10 text-base"
            aria-label={t("searchPlaceholder")}
          />
          {query && (
            <button
              type="button"
              aria-label={t("clearSearch")}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                setQuery("");
                setDebounced("");
              }}
              className="text-muted-foreground hover:text-foreground absolute end-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <Button variant="outline" onClick={onOpenCamera} className="h-12 shrink-0 px-3" aria-label={t("cameraScan")}>
          <Camera className="size-5" />
          <span className="hidden xl:inline">{t("cameraScan")}</span>
          <Kbd className="hidden xl:inline-flex">F8</Kbd>
        </Button>
      </div>
      {approximate && debounced.length > 0 && (
        <p className="border-b bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400">
          {t("offlineCatalog")}
        </p>
      )}
      {debounced.length === 0 ? (
        // nothing typed: browse by category and tap to add
        <ProductTiles onAdd={addTile} />
      ) : (
        <div className="max-h-[45svh] min-h-0 flex-1 overflow-y-auto p-1 lg:max-h-none">
          {results.length === 0 && !isFetching ? (
            <p className="text-muted-foreground p-4 text-center text-sm">{t("noResults")}</p>
          ) : (
            results.map((product, index) => {
              const name = locale === "ar" ? product.name_ar : product.name_en;
              const out = Number(product.stock_qty) <= 0;
              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => addAndReset(product)}
                  onMouseEnter={() => setHighlight(index)}
                  className={cn(
                    "flex min-h-14 w-full items-center justify-between gap-2 rounded-md px-3 py-2.5 text-start",
                    index === highlight && "bg-accent"
                  )}
                >
                  <div className="min-w-0">
                    <div className={cn("truncate font-medium", out && "text-muted-foreground")}>
                      {name}
                    </div>
                    <div className="text-muted-foreground text-xs tabular-nums" dir="ltr">
                      {product.barcode}
                      {out && ` · ${t("outOfStock")}`}
                      {approximate && ` · ${t("approxStock")}`}
                    </div>
                  </div>
                  <span className="shrink-0 font-semibold tabular-nums" dir="ltr">
                    {formatEgp(product.price, locale)}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
});
