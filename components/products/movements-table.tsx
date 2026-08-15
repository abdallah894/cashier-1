import { getTranslations, getLocale, getFormatter } from "next-intl/server";
import type { StockMovementWithActor } from "@/lib/supabase/queries/products";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const reasonVariant = {
  sale: "secondary",
  received: "default",
  damaged: "destructive",
  correction: "outline",
} as const;

// Server Component: pure display, dates formatted with next-intl's
// locale-aware formatter on the server.
export async function MovementsTable({ movements }: { movements: StockMovementWithActor[] }) {
  const t = await getTranslations("stock");
  const locale = await getLocale();
  const format = await getFormatter();

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("colWhen")}</TableHead>
            <TableHead>{t("colWho")}</TableHead>
            <TableHead>{t("colReason")}</TableHead>
            <TableHead>{t("colChange")}</TableHead>
            <TableHead>{t("colNote")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {movements.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-muted-foreground h-20 text-center">
                {t("noMovements")}
              </TableCell>
            </TableRow>
          ) : (
            movements.map((m) => {
              const change = Number(m.qty_change);
              return (
                <TableRow key={m.id}>
                  <TableCell className="whitespace-nowrap">
                    {format.dateTime(new Date(m.created_at), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </TableCell>
                  <TableCell>{m.profiles?.full_name ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={reasonVariant[m.reason]}>{t(`reasons.${m.reason}`)}</Badge>
                  </TableCell>
                  <TableCell>
                    <span
                      dir="ltr"
                      className={
                        "font-medium tabular-nums " +
                        (change > 0 ? "text-green-600 dark:text-green-500" : "text-destructive")
                      }
                    >
                      {change > 0
                        ? `+${new Intl.NumberFormat(locale).format(change)}`
                        : new Intl.NumberFormat(locale).format(change)}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-56 truncate">
                    {m.note ?? "—"}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
