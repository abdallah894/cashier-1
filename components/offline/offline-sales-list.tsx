"use client";

import { useState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { useOnline } from "@/hooks/use-online";
import { useOutbox } from "@/hooks/use-outbox";
import { formatEgp } from "@/lib/money";
import { getOfflineDb } from "@/lib/offline/db";
import { resolveRejected, retryRejected } from "@/lib/offline/outbox";
import { submitQueuedSale } from "@/lib/offline/submit";
import { drainOutbox } from "@/lib/offline/sync";
import type { OutboxEntry, OutboxStatus } from "@/lib/offline/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const STATUS_VARIANT: Record<OutboxStatus, "default" | "secondary" | "destructive" | "outline"> = {
  queued: "secondary",
  syncing: "secondary",
  synced: "outline",
  rejected: "destructive",
  resolved: "outline",
};

/** Every sale rung on this device: queued, synced, rejected (needs a decision) or resolved. */
export function OfflineSalesList({ userId }: { userId: string }) {
  const t = useTranslations("offline");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const format = useFormatter();
  const router = useRouter();
  const online = useOnline();
  const rows = useOutbox();

  const [syncing, setSyncing] = useState(false);
  const [resolving, setResolving] = useState<OutboxEntry | null>(null);
  const [note, setNote] = useState("");

  async function syncNow() {
    if (syncing) return;
    setSyncing(true);
    try {
      const result = await drainOutbox(getOfflineDb(), userId, submitQueuedSale);
      toast.success(t("syncResult", { synced: result.synced, rejected: result.rejected }));
      if (result.synced > 0) router.refresh();
    } catch {
      toast.error(t("syncFailed"));
    } finally {
      setSyncing(false);
    }
  }

  async function retry(entry: OutboxEntry) {
    await retryRejected(getOfflineDb(), entry.id);
    await syncNow();
  }

  async function confirmResolve() {
    if (!resolving) return;
    try {
      await resolveRejected(getOfflineDb(), resolving.id, note);
      setResolving(null);
      setNote("");
      toast.success(t("resolvedToast"));
    } catch {
      toast.error(t("resolveNeedsNote"));
    }
  }

  const errorText = (code: string | null) => (code ? (tErrors.has(code) ? tErrors(code) : code) : "");
  const attention = (rows ?? []).filter((row) => row.status === "rejected");

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground max-w-prose text-sm">{t("description")}</p>
        </div>
        <Button onClick={syncNow} disabled={!online || syncing}>
          {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {t("syncNow")}
        </Button>
      </div>

      {!online && (
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          {t("offlineWaiting")}
        </p>
      )}
      {attention.length > 0 && (
        <p className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
          {t("attention", { count: attention.length })}
        </p>
      )}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-start">
              <th className="p-3 text-start">{t("colNumber")}</th>
              <th className="p-3 text-start">{t("colTime")}</th>
              <th className="p-3 text-start">{t("colTotal")}</th>
              <th className="p-3 text-start">{t("colStatus")}</th>
              <th className="p-3 text-start">{t("colDetails")}</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((row) => (
              <tr key={row.id} className="border-b align-top last:border-0">
                <td className="p-3 tabular-nums" dir="ltr">
                  P-{row.localNumber}
                  {row.saleNumber !== null && <span className="text-muted-foreground"> → #{row.saleNumber}</span>}
                </td>
                <td className="p-3">
                  {format.dateTime(new Date(row.createdAt), { dateStyle: "short", timeStyle: "short" })}
                </td>
                <td className="p-3 tabular-nums" dir="ltr">
                  {formatEgp(row.provisional.total, locale)}
                </td>
                <td className="p-3">
                  <Badge variant={STATUS_VARIANT[row.status]}>{t(`status.${row.status}`)}</Badge>
                  {row.userId !== userId && row.status === "queued" && (
                    <div className="text-muted-foreground mt-1 text-xs">{t("otherCashier")}</div>
                  )}
                </td>
                <td className="p-3">
                  {row.status === "rejected" && <div className="text-destructive">{errorText(row.error)}</div>}
                  {row.resolution && (
                    <div className="text-muted-foreground max-w-xs text-xs">{row.resolution.note}</div>
                  )}
                </td>
                <td className="p-3">
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/offline-sales/${row.id}`}>{t("viewReceipt")}</Link>
                    </Button>
                    {row.status === "synced" && row.saleId && (
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/receipts/${row.saleId}`}>{t("finalReceipt")}</Link>
                      </Button>
                    )}
                    {row.status === "rejected" && row.userId === userId && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => void retry(row)} disabled={!online}>
                          {t("retry")}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setResolving(row)}>
                          {t("resolve")}
                        </Button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {rows !== null && rows.length === 0 && (
              <tr>
                <td className="text-muted-foreground p-6 text-center" colSpan={6}>
                  {t("empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={resolving !== null} onOpenChange={(next) => !next && setResolving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("resolveTitle")}</DialogTitle>
            <DialogDescription>{t("resolveDescription")}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("resolveNote")}
            aria-label={t("resolveNote")}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolving(null)}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void confirmResolve()} disabled={note.trim().length === 0}>
              {t("resolveConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
