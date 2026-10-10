import { setRequestLocale, getTranslations, getFormatter } from "next-intl/server";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getSales, getCashiers } from "@/lib/supabase/queries/sales";
import { formatEgp } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type SearchParams = { q?: string; from?: string; to?: string; cashier?: string; page?: string };

// Server component end to end: the filter bar is a plain GET form, so
// searching needs zero client JS (in Vue terms: no reactive state — the
// URL is the state, like classic SSR).
export default async function SalesHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);

  const [t, tReceipt, format, cashiers, result] = await Promise.all([
    getTranslations("sales"),
    getTranslations("receipt"),
    getFormatter(),
    getCashiers(),
    getSales({ q: sp.q, from: sp.from, to: sp.to, cashierId: sp.cashier, page }),
  ]);

  const pageHref = (p: number) => {
    const qs = new URLSearchParams();
    if (sp.q) qs.set("q", sp.q);
    if (sp.from) qs.set("from", sp.from);
    if (sp.to) qs.set("to", sp.to);
    if (sp.cashier) qs.set("cashier", sp.cashier);
    if (p > 1) qs.set("page", String(p));
    const s = qs.toString();
    return `/receipts${s ? `?${s}` : ""}`;
  };

  const inputClass = "h-9 w-auto";
  const selectClass =
    "border-input h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none";

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground max-w-prose text-sm">{t("pageDescription")}</p>
        </div>
        <span className="text-muted-foreground text-sm">{t("count", { count: result.total })}</span>
      </div>

      <form method="get" className="flex flex-wrap items-center gap-2">
        <Input
          name="q"
          defaultValue={sp.q ?? ""}
          inputMode="numeric"
          placeholder={t("searchNumber")}
          className={`${inputClass} w-36`}
          aria-label={t("searchNumber")}
        />
        <label className="text-muted-foreground flex items-center gap-1 text-sm">
          {t("from")}
          <Input type="date" name="from" defaultValue={sp.from ?? ""} className={inputClass} />
        </label>
        <label className="text-muted-foreground flex items-center gap-1 text-sm">
          {t("to")}
          <Input type="date" name="to" defaultValue={sp.to ?? ""} className={inputClass} />
        </label>
        <select
          name="cashier"
          defaultValue={sp.cashier ?? ""}
          className={selectClass}
          aria-label={t("cashier")}
        >
          <option value="">{t("allCashiers")}</option>
          {cashiers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.full_name}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm">
          <Search className="size-4" />
          {t("apply")}
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/receipts">{t("reset")}</Link>
        </Button>
      </form>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colNumber")}</TableHead>
              <TableHead>{t("colDate")}</TableHead>
              <TableHead>{t("colCashier")}</TableHead>
              <TableHead>{t("colItems")}</TableHead>
              <TableHead>{t("colPayment")}</TableHead>
              <TableHead className="text-end">{t("colTotal")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground h-24 text-center">
                  {t("empty")}
                </TableCell>
              </TableRow>
            )}
            {result.rows.map((sale) => (
              <TableRow key={sale.id}>
                <TableCell>
                  <Link
                    href={`/receipts/${sale.id}`}
                    className="font-medium tabular-nums underline-offset-4 hover:underline"
                    dir="ltr"
                  >
                    #{Number(sale.sale_number)}
                  </Link>
                </TableCell>
                <TableCell>
                  {format.dateTime(new Date(sale.created_at), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </TableCell>
                <TableCell>{sale.profiles?.full_name ?? "—"}</TableCell>
                <TableCell className="tabular-nums">{sale.sale_items[0]?.count ?? 0}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{tReceipt(`payment.${sale.payment_method}`)}</Badge>
                </TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">
                  {formatEgp(Number(sale.total), locale)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {result.pageCount > 1 && (
        <div className="flex items-center justify-end gap-2">
          <span className="text-muted-foreground text-sm">
            {t("pageOf", { page: result.page, pageCount: result.pageCount })}
          </span>
          {result.page <= 1 ? (
            <Button variant="outline" size="icon" disabled aria-label={t("previousPage")}>
              <ChevronLeft className="size-4 rtl:rotate-180" />
            </Button>
          ) : (
            <Button variant="outline" size="icon" asChild aria-label={t("previousPage")}>
              <Link href={pageHref(result.page - 1)}>
                <ChevronLeft className="size-4 rtl:rotate-180" />
              </Link>
            </Button>
          )}
          {result.page >= result.pageCount ? (
            <Button variant="outline" size="icon" disabled aria-label={t("nextPage")}>
              <ChevronRight className="size-4 rtl:rotate-180" />
            </Button>
          ) : (
            <Button variant="outline" size="icon" asChild aria-label={t("nextPage")}>
              <Link href={pageHref(result.page + 1)}>
                <ChevronRight className="size-4 rtl:rotate-180" />
              </Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
