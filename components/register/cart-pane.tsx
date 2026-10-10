"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CreditCard, Minus, Plus, ShoppingCart, Tag, Trash2, TriangleAlert } from "lucide-react";
import { formatEgp, parseQty } from "@/lib/money";
import { qtyStep } from "@/lib/register/multiplier";
import { useCart, type CartTotals, type LineComputed } from "@/lib/store/cart";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Numpad, type NumpadKey } from "@/components/ui/numpad";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DiscountPopover } from "./discount-popover";
import { VoidCartDialog } from "./void-cart-dialog";
import { CustomerPromoBar } from "./customer-promo-bar";
import { cn } from "@/lib/utils";

type Props = {
  totals: CartTotals;
  selectedIndex: number;
  onSelect: (index: number) => void;
  onQtyChange: (productId: string, qty: number) => void;
  onRemove: (productId: string) => void;
  onOpenCheckout: () => void;
};

export function CartPane({ totals, selectedIndex, onSelect, onQtyChange, onRemove, onOpenCheckout }: Props) {
  const t = useTranslations("register");
  const locale = useLocale();
  const saleDiscount = useCart((s) => s.saleDiscount);
  const setSaleDiscount = useCart((s) => s.setSaleDiscount);
  const listRef = useRef<HTMLDivElement>(null);
  const hasItems = totals.lines.length > 0;

  // keep the keyboard-selected line visible
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-line="${selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  return (
    <div className="bg-card flex min-h-0 flex-col rounded-xl border">
      <div className="flex min-h-14 items-center justify-between gap-2 border-b px-3 py-2 sm:px-4">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <ShoppingCart className="size-5" />
          {t("cartTitle")}
          {totals.itemCount > 0 && <Badge variant="secondary">{totals.itemCount}</Badge>}
        </h2>
        {totals.itemCount > 0 && <VoidCartDialog totals={totals} />}
      </div>

      <div ref={listRef} className="min-h-40 flex-1 overflow-y-auto lg:min-h-0">
        {!hasItems ? (
          <div className="text-muted-foreground flex h-full min-h-40 flex-col items-center justify-center gap-2 p-8 text-center">
            <ShoppingCart className="size-10 opacity-30" />
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

      {/* one row for what applies to the whole sale */}
      <CustomerPromoBar>
        <DiscountPopover discount={saleDiscount} onApply={setSaleDiscount}>
          <Button variant="outline" data-shortcut="sale-discount" disabled={!hasItems}>
            <Tag className="size-4" />
            {saleDiscount ? t("editSaleDiscount") : t("addSaleDiscount")}
          </Button>
        </DiscountPopover>
      </CustomerPromoBar>

      {/* phones: the total and Pay stay on screen while the page scrolls */}
      <div className="bg-card sticky bottom-0 z-[1] flex flex-col gap-2 rounded-b-xl border-t px-3 py-3 sm:px-4 lg:static">
        <div className="text-muted-foreground flex flex-col gap-1 text-sm">
          <Row label={t("subtotalNet")} value={formatEgp(totals.subtotal, locale)} />
          {[...totals.vatByRate.entries()]
            .filter(([, v]) => v.tax > 0)
            .map(([rateBp, v]) => (
              <Row key={rateBp} label={t("vatAtRate", { rate: rateBp / 100 })} value={formatEgp(v.tax, locale)} />
            ))}
          {totals.discountTotal > 0 && (
            <Row
              label={t("discountTotal")}
              value={`- ${formatEgp(totals.discountTotal, locale)}`}
              className="text-destructive"
            />
          )}
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-lg font-semibold">{t("total")}</span>
          <span className="text-3xl font-bold tabular-nums" dir="ltr" data-testid="cart-total">
            {formatEgp(totals.total, locale)}
          </span>
        </div>
        <Button size="xl" className="w-full text-lg" disabled={!hasItems} onClick={onOpenCheckout}>
          <CreditCard className="size-6" />
          {t("checkout")}
          <Kbd className="ms-auto hidden sm:inline-flex">F2</Kbd>
        </Button>
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
        "relative flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-2 border-b px-3 py-3 sm:px-4",
        // selected line: tinted, with an accent bar at the start edge
        selected && "bg-accent before:bg-primary before:absolute before:inset-y-0 before:start-0 before:w-1"
      )}
    >
      <div className="min-w-0 basis-full">
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 font-medium leading-snug">{name}</span>
          <span className="shrink-0 text-base font-semibold whitespace-nowrap tabular-nums" dir="ltr">
            {formatEgp(line.gross, locale)}
          </span>
        </div>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-sm tabular-nums">
          <span dir="ltr">{formatEgp(item.unitPrice, locale)}</span>
          {item.unit === "kg" && <span>/ {t("perKg")}</span>}
          {line.lineDiscount > 0 && (
            <span className="text-destructive" dir="ltr">
              -{formatEgp(line.lineDiscount, locale)}
            </span>
          )}
          {line.promoDiscount > 0 && (
            <span className="text-green-700 dark:text-green-500" dir="ltr">
              -{formatEgp(line.promoDiscount, locale)} {t("promoShort")}
            </span>
          )}
          {overStock && (
            <Badge variant="destructive" className="gap-1 text-xs">
              <TriangleAlert className="size-3" />
              {t("overStock", { stock: item.stockQty })}
            </Badge>
          )}
        </div>
      </div>

      <QtyControl qty={item.qty} unit={item.unit} onChange={(qty) => onQtyChange(item.productId, qty)} />

      <div className="ms-auto flex items-center gap-1">
        <DiscountPopover discount={item.discount} onApply={(d) => setLineDiscount(item.productId, d)}>
          <Button
            variant="ghost"
            size="icon"
            className={cn(item.discount && "text-destructive")}
            aria-label={t("lineDiscount")}
            data-shortcut={selected ? "line-discount" : undefined}
            onClick={(e) => e.stopPropagation()}
          >
            <Tag className="size-5" />
          </Button>
        </DiscountPopover>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive"
          aria-label={t("removeLine")}
          onClick={(e) => {
            e.stopPropagation();
            onRemove(item.productId);
          }}
        >
          <Trash2 className="size-5" />
        </Button>
      </div>
    </div>
  );
}

/** − qty + with 40px buttons; tapping the number opens a keypad (typing works too). */
function QtyControl({
  qty,
  unit,
  onChange,
}: {
  qty: number;
  unit: "piece" | "kg";
  onChange: (qty: number) => void;
}) {
  const t = useTranslations("register");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const step = qtyStep(unit);
  const parsed = parseQty(draft, unit);
  const valid = parsed !== null && parsed > 0;

  function commit() {
    if (!valid) return;
    onChange(parsed);
    setOpen(false);
  }

  function onKey(key: NumpadKey) {
    setDraft((current) => (key === "backspace" ? current.slice(0, -1) : key === "." && current.includes(".") ? current : current + key));
  }

  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <Button variant="outline" size="icon" tabIndex={-1} aria-label={t("qtyDecrease")} onClick={() => onChange(qty - step)}>
        <Minus className="size-4" />
      </Button>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setDraft("");
        }}
      >
        <PopoverTrigger asChild>
          <Button variant="outline" className="min-w-16 px-2 text-base font-semibold tabular-nums" aria-label={t("qtyEdit")} dir="ltr">
            {qty}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64" align="center">
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              commit();
            }}
          >
            <Input
              autoFocus
              dir="ltr"
              inputMode="decimal"
              value={draft}
              placeholder={String(qty)}
              onChange={(e) => setDraft(e.target.value)}
              className="h-12 text-center text-xl tabular-nums"
              aria-label={t("qtyEdit")}
            />
            <Numpad onKey={onKey} withDot={unit === "kg"} />
            <Button type="submit" size="lg" disabled={!valid}>
              {t("qtySet")}
            </Button>
          </form>
        </PopoverContent>
      </Popover>
      <Button variant="outline" size="icon" tabIndex={-1} aria-label={t("qtyIncrease")} onClick={() => onChange(qty + step)}>
        <Plus className="size-4" />
      </Button>
    </div>
  );
}
