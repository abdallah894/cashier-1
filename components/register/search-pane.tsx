"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Camera, CreditCard, Search } from "lucide-react";
import { searchProducts } from "@/lib/offline/register-data";
import { formatEgp } from "@/lib/money";
import type { Tables } from "@/lib/supabase/database.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

export type SearchPaneHandle = { focus: () => void; clear: () => void };

type Props = {
  onAdd: (product: Tables<"products">) => void;
  onOpenCamera: () => void;
  onOpenCheckout: () => void;
  hasItems: boolean;
  total: number;
};

export const SearchPane = forwardRef<SearchPaneHandle, Props>(function SearchPane(
  { onAdd, onOpenCamera, onOpenCheckout, hasItems, total },
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
    <div className="flex min-h-0 flex-col gap-3">
      <div className="bg-card flex min-h-0 flex-1 flex-col rounded-xl border">
        <div className="relative border-b p-3">
          <Search className="text-muted-foreground absolute start-6 top-1/2 size-4 -translate-y-1/2" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("searchPlaceholder")}
            className="ps-9"
            aria-label={t("searchPlaceholder")}
          />
        </div>
        {approximate && (
          <p className="border-b bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400">
            {t("offlineCatalog")}
          </p>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {debounced.length === 0 ? (
            <p className="text-muted-foreground p-4 text-center text-sm">{t("searchHint")}</p>
          ) : results.length === 0 && !isFetching ? (
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
                    "flex w-full items-center justify-between gap-2 rounded-md px-3 py-2.5 text-start",
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
      </div>

      <Button variant="outline" onClick={onOpenCamera} className="h-11">
        <Camera className="size-4" />
        {t("cameraScan")}
        <Kbd className="ms-auto">F8</Kbd>
      </Button>

      <Button size="lg" className="h-14 text-base" disabled={!hasItems} onClick={onOpenCheckout}>
        <CreditCard className="size-5" />
        {t("checkout")}
        <span className="ms-auto flex items-center gap-2">
          <span className="tabular-nums" dir="ltr">
            {formatEgp(total, locale)}
          </span>
          <Kbd>F2</Kbd>
        </span>
      </Button>
    </div>
  );
});
