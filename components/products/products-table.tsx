"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useReactTable, getCoreRowModel, flexRender, type ColumnDef } from "@tanstack/react-table";
import { ImageOff, TriangleAlert } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { formatEgp } from "@/lib/money";
import type { ProductWithCategory } from "@/lib/supabase/queries/products";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Plain <img>: Supabase Storage host isn't in next/image remotePatterns,
// and 36px thumbnails don't benefit from the optimizer.
function ProductThumb({ src }: { src: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className="size-9 shrink-0 rounded-md border object-cover" />;
}

export function ProductsTable({ rows }: { rows: ProductWithCategory[] }) {
  const t = useTranslations("products");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();

  // Column defs are plain data + render functions (JSX instead of
  // Vuetify's headers array + v-slot:item.x templates).
  const columns = useMemo<ColumnDef<ProductWithCategory>[]>(
    () => [
      {
        id: "name",
        header: t("colProduct"),
        cell: ({ row }) => {
          const p = row.original;
          const name = locale === "ar" ? p.name_ar : p.name_en;
          const secondary = locale === "ar" ? p.name_en : p.name_ar;
          return (
            <div className="flex items-center gap-3">
              {p.image_url ? (
                <ProductThumb src={p.image_url} />
              ) : (
                <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md border">
                  <ImageOff className="size-4" />
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{name}</span>
                  {!p.active && <Badge variant="outline">{t("inactive")}</Badge>}
                </div>
                <div className="text-muted-foreground truncate text-xs">{secondary}</div>
              </div>
            </div>
          );
        },
      },
      {
        id: "barcode",
        header: t("colBarcode"),
        cell: ({ row }) => (
          <span dir="ltr" className="font-mono text-xs">
            {row.original.barcode}
          </span>
        ),
      },
      {
        id: "category",
        header: t("colCategory"),
        cell: ({ row }) => {
          const c = row.original.categories;
          return c ? (locale === "ar" ? c.name_ar : c.name_en) : "—";
        },
      },
      {
        id: "price",
        header: t("colPrice"),
        cell: ({ row }) => (
          <span className="tabular-nums">{formatEgp(row.original.price, locale)}</span>
        ),
      },
      {
        id: "stock",
        header: t("colStock"),
        cell: ({ row }) => {
          const p = row.original;
          const low = p.stock_qty <= p.low_stock_threshold;
          return (
            <div className="flex items-center gap-2">
              <span className="tabular-nums">
                {Number(p.stock_qty)} {p.unit === "kg" ? tCommon("kg") : ""}
              </span>
              {low && (
                <Badge variant="destructive" className="gap-1">
                  <TriangleAlert className="size-3" />
                  {t("lowStock")}
                </Badge>
              )}
            </div>
          );
        },
      },
    ],
    [t, tCommon, locale]
  );

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="text-muted-foreground h-24 text-center"
              >
                {t("empty")}
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => {
              const p = row.original;
              const low = p.stock_qty <= p.low_stock_threshold;
              return (
                <TableRow
                  key={row.id}
                  onClick={() => router.push(`/products/${p.id}`)}
                  className={
                    "cursor-pointer " + (low ? "bg-destructive/5 hover:bg-destructive/10" : "")
                  }
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
