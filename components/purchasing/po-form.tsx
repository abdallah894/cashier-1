"use client";

import { useEffect, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { createPurchaseOrder } from "@/lib/actions/purchasing";
import { formatEgp, parseEgpToPiasters, parseQty, piastersToEgpInput } from "@/lib/money";
import { searchProductsClient } from "@/lib/supabase/queries/products-client";
import type { Tables } from "@/lib/supabase/database.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Line = { product: Tables<"products">; qty: string; cost: string };

/** New purchase order: pick a supplier, add products with quantity and ex-VAT unit cost. */
export function PurchaseOrderForm({ suppliers }: { suppliers: { id: string; name: string }[] }) {
  const t = useTranslations("purchaseOrders");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [supplierId, setSupplierId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);

  const { data: results = [] } = useQuery({
    queryKey: ["po-product-search", debounced],
    queryFn: () => searchProductsClient(debounced),
    enabled: debounced.length >= 1,
    staleTime: 30_000,
  });

  function addProduct(product: Tables<"products">) {
    setQuery("");
    setLines((current) =>
      current.some((line) => line.product.id === product.id)
        ? current
        : [...current, { product, qty: "1", cost: piastersToEgpInput(Number(product.cost)) }]
    );
  }

  const parsed = lines.map((line) => ({
    line,
    qty: parseQty(line.qty, line.product.unit),
    cost: parseEgpToPiasters(line.cost),
  }));
  const valid = supplierId !== "" && parsed.length > 0 && parsed.every((row) => row.qty !== null && row.qty > 0 && row.cost !== null);
  const total = parsed.reduce((sum, row) => sum + Math.round((row.qty ?? 0) * (row.cost ?? 0)), 0);

  function submit() {
    startTransition(async () => {
      const result = await createPurchaseOrder({
        supplierId,
        expectedDate: expectedDate || undefined,
        note: note || undefined,
        lines: parsed.map((row) => ({
          productId: row.line.product.id,
          orderedQty: row.qty,
          unitCost: row.cost,
        })),
      });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      toast.success(t("created"));
      router.push(`/purchase-orders/${result.data.poId}`);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label>{t("supplier")}</Label>
          <Select value={supplierId} onValueChange={setSupplierId}>
            <SelectTrigger>
              <SelectValue placeholder={t("pickSupplier")} />
            </SelectTrigger>
            <SelectContent>
              {suppliers.map((supplier) => (
                <SelectItem key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="expected">{t("expectedDate")}</Label>
          <Input id="expected" type="date" dir="ltr" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="po-note">{t("note")}</Label>
          <Textarea id="po-note" rows={1} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>

      <div className="relative max-w-md">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("addProduct")}
          aria-label={t("addProduct")}
        />
        {results.length > 0 && query.trim() !== "" && (
          <div className="bg-popover absolute z-10 mt-1 w-full rounded-md border p-1 shadow-md">
            {results.map((product) => (
              <button
                key={product.id}
                type="button"
                className="hover:bg-accent flex w-full items-center justify-between gap-3 rounded px-3 py-2 text-start text-sm"
                onClick={() => addProduct(product)}
              >
                <span className="min-w-0 truncate">{locale === "ar" ? product.name_ar : product.name_en}</span>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums" dir="ltr">
                  {product.barcode}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-3 text-start">{t("colProduct")}</th>
              <th className="p-3 text-start">{t("colQty")}</th>
              <th className="p-3 text-start">{t("colUnitCost")}</th>
              <th className="p-3 text-start">{t("colLineTotal")}</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {parsed.map(({ line, qty, cost }) => (
              <tr key={line.product.id} className="border-b last:border-0">
                <td className="p-3">{locale === "ar" ? line.product.name_ar : line.product.name_en}</td>
                <td className="p-3">
                  <Input
                    dir="ltr"
                    inputMode="decimal"
                    className="w-24 tabular-nums"
                    value={line.qty}
                    aria-invalid={qty === null}
                    onChange={(e) =>
                      setLines((current) =>
                        current.map((row) => (row.product.id === line.product.id ? { ...row, qty: e.target.value } : row))
                      )
                    }
                  />
                </td>
                <td className="p-3">
                  <Input
                    dir="ltr"
                    inputMode="decimal"
                    className="w-28 tabular-nums"
                    value={line.cost}
                    aria-invalid={cost === null}
                    onChange={(e) =>
                      setLines((current) =>
                        current.map((row) => (row.product.id === line.product.id ? { ...row, cost: e.target.value } : row))
                      )
                    }
                  />
                </td>
                <td className="p-3 tabular-nums" dir="ltr">
                  {formatEgp(Math.round((qty ?? 0) * (cost ?? 0)), locale)}
                </td>
                <td className="p-3">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("removeLine")}
                    onClick={() => setLines((current) => current.filter((row) => row.product.id !== line.product.id))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <td className="text-muted-foreground p-6 text-center" colSpan={5}>
                  {t("noLines")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-muted-foreground text-sm">
          {t("totalExVat")}: <span className="text-foreground font-semibold tabular-nums" dir="ltr">{formatEgp(total, locale)}</span>
        </span>
        <Button onClick={submit} disabled={pending || !valid}>
          {t("createDraft")}
        </Button>
      </div>
    </div>
  );
}
