"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Minus, Plus, ShoppingCart, Tag, Trash2, TriangleAlert } from "lucide-react";
import { formatEgp, parseQty } from "@/lib/money";
import { useCart, type CartTotals, type LineComputed } from "@/lib/store/cart";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { DiscountPopover } from "./discount-popover";
import { cn } from "@/lib/utils";

type Props = {
  totals: CartTotals;
  selectedIndex: number;
  onSelect: (index: number) => void;
  onQtyChange: (productId: string, qty: number) => void;
  onRemove: (productId: string) => void;
};

export function CartPane({ totals, selectedIndex, onSelect, onQtyChange, onRemove }: Props) {
  const t = useTranslations("register");
  const locale = useLocale();
  const clear = useCart((s) => s.clear);
  const saleDiscount = useCart((s) => s.saleDiscount);
  const setSaleDiscount = useCart((s) => s.setSaleDiscount);
  const listRef = useRef<HTMLDivElement>(null);

  // keep the keyboard-selected line visible
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-line="${selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  return (
    <div className="bg-card flex min-h-0 flex-col rounded-xl border">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <ShoppingCart className="size-4" />
          {t("cartTitle")}
          {totals.itemCount > 0 && <Badge variant="secondary">{totals.itemCount}</Badge>}
        </h2>
        {totals.itemCount > 0 && (
          <Button variant="ghost" size="sm" onClick={clear}>
            {t("clearCart")}
          </Button>
        )}
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
        {totals.lines.length === 0 ? (
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
            <ShoppingCart className="size-8 opacity-40" />
            <p className="text-sm">{t("emptyCart")}</p>
          </div>
        ) : (
          totals.lines.map((line, index) => (
            <CartLine
              key={line.item.productId}
              line={line}
              index={index}
              selected={index === selectedIndex}
              onSelect={onSelect}
              onQtyChange={onQtyChange}
              onRemove={onRemove}
            />
          ))
        )}
      </div>

      <div className="border-t px-4 py-3">
        <div className="text-muted-foreground flex flex-col gap-1 text-sm">
          <Row label={t("subtotalNet")} value={formatEgp(totals.subtotal, locale)} />
          {[...totals.vatByRate.entries()]
            .filter(([, v]) => v.tax > 0)
            .map(([rateBp, v]) => (
              <Row
                key={rateBp}
                label={t("vatAtRate", { rate: rateBp / 100 })}
                value={formatEgp(v.tax, locale)}
              />
            ))}
          {totals.discountTotal > 0 && (
            <Row
              label={t("discountTotal")}
              value={`- ${formatEgp(totals.discountTotal, locale)}`}
              className="text-destructive"
            />
          )}
          <div className="flex items-center justify-between">
            <DiscountPopover discount={saleDiscount} onApply={setSaleDiscount}>
              <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs">
                <Tag className="size-3" />
                {saleDiscount ? t("editSaleDiscount") : t("addSaleDiscount")}
              </Button>
            </DiscountPopover>
          </div>
        </div>
        <Separator className="my-2" />
        <div className="flex items-baseline justify-between">
          <span className="text-lg font-semibold">{t("total")}</span>
          <span className="text-2xl font-bold tabular-nums" dir="ltr">
            {formatEgp(totals.total, locale)}
          </span>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between", className)}>
      <span>{label}</span>
      <span className="tabular-nums" dir="ltr">
        {value}
      </span>
    </div>
  );
}

function CartLine({
  line,
  index,
  selected,
  onSelect,
  onQtyChange,
  onRemove,
}: {
  line: LineComputed;
  index: number;
  selected: boolean;
  onSelect: (index: number) => void;
  onQtyChange: (productId: string, qty: number) => void;
  onRemove: (productId: string) => void;
}) {
  const t = useTranslations("register");
  const locale = useLocale();
  const setLineDiscount = useCart((s) => s.setLineDiscount);
  const { item } = line;
  const name = locale === "ar" ? item.nameAr : item.nameEn;
  const overStock = item.qty > item.stockQty;

  return (
    <div
      data-line={index}
      onClick={() => onSelect(index)}
      className={cn(
        "flex cursor-pointer items-center gap-3 border-b px-4 py-2.5",
        selected && "bg-accent"
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{name}</span>
          {overStock && (
            <Badge variant="destructive" className="gap-1 text-xs">
              <TriangleAlert className="size-3" />
              {t("overStock", { stock: item.stockQty })}
            </Badge>
          )}
        </div>
        <div className="text-muted-foreground text-xs tabular-nums">
          <span dir="ltr">{formatEgp(item.unitPrice, locale)}</span>
          {item.unit === "kg" && ` / ${t("perKg")}`}
          {line.lineDiscount > 0 && (
            <span className="text-destructive ms-2" dir="ltr">
              -{formatEgp(line.lineDiscount, locale)}
            </span>
          )}
        </div>
      </div>

      <QtyControl
        qty={item.qty}
        unit={item.unit}
        onChange={(qty) => onQtyChange(item.productId, qty)}
      />

      <DiscountPopover discount={item.discount} onApply={(d) => setLineDiscount(item.productId, d)}>
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-7", item.discount && "text-destructive")}
          aria-label={t("lineDiscount")}
          onClick={(e) => e.stopPropagation()}
        >
          <Tag className="size-3.5" />
        </Button>
      </DiscountPopover>

      <span className="w-20 text-end font-semibold tabular-nums" dir="ltr">
        {formatEgp(line.gross, locale)}
      </span>

      <Button
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-destructive size-7"
        aria-label={t("removeLine")}
        onClick={(e) => {
          e.stopPropagation();
          onRemove(item.productId);
        }}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}

function QtyControl({
  qty,
  unit,
  onChange,
}: {
  qty: number;
  unit: "piece" | "kg";
  onChange: (qty: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  function commit() {
    if (draft === null) return;
    const parsed = parseQty(draft, unit);
    if (parsed !== null && parsed > 0) onChange(parsed);
    setDraft(null);
  }

  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <Button
        variant="outline"
        size="icon"
        className="size-7"
        tabIndex={-1}
        onClick={() => onChange(qty - 1)}
      >
        <Minus className="size-3.5" />
      </Button>
      <Input
        dir="ltr"
        inputMode="decimal"
        className="h-7 w-16 px-1 text-center tabular-nums"
        value={draft ?? String(qty)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      <Button
        variant="outline"
        size="icon"
        className="size-7"
        tabIndex={-1}
        onClick={() => onChange(qty + 1)}
      >
        <Plus className="size-3.5" />
      </Button>
    </div>
  );
}
