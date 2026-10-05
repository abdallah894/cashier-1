"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { getOfflineDb } from "@/lib/offline/db";
import { recoverStuck } from "@/lib/offline/outbox";
import { refreshOfflineData } from "@/lib/offline/register-data";
import { submitQueuedSale } from "@/lib/offline/submit";
import { drainOutbox } from "@/lib/offline/sync";
import { reportSyncBacklog } from "@/lib/actions/ops-health";
import { countByStatus } from "@/lib/offline/outbox";

const SYNC_INTERVAL_MS = 30_000;
const CATALOG_INTERVAL_MS = 10 * 60_000;
/** A `syncing` row older than this has no live submitter (crash/restart). */
const STUCK_AFTER_MS = 2 * 60_000;

/** Headless: drains the sale outbox and keeps the offline catalog fresh. Mounted once in the app shell. */
export function SyncProvider({ userId }: { userId: string }) {
  const t = useTranslations("offline");
  const router = useRouter();

  useEffect(() => {
    const db = getOfflineDb();
    let cancelled = false;
    let lastReport = "";

    // tell the server how big the offline queue is, so a stuck backlog alerts someone
    async function report() {
      if (!navigator.onLine) return;
      const counts = await countByStatus(db, userId);
      const queued = counts.queued + counts.syncing;
      const oldest = (await db.outbox.where("status").anyOf("queued", "syncing").toArray()).filter((row) => row.userId === userId).map((row) => Date.parse(row.createdAt));
      const oldestAgeSeconds = oldest.length ? Math.max(0, Math.round((Date.now() - Math.min(...oldest)) / 1000)) : 0;
      const signature = `${queued}:${counts.rejected}`;
      // nothing to say while the queue is empty and was already reported empty
      if (signature === "0:0" && lastReport === "0:0") return;
      lastReport = signature;
      await reportSyncBacklog({ queued, rejected: counts.rejected, oldestAgeSeconds }).catch(() => undefined);
    }

    async function sync() {
      if (!navigator.onLine) return;
      const result = await drainOutbox(db, userId, submitQueuedSale);
      await report();
      if (cancelled) return;
      if (result.synced > 0) {
        toast.success(t("syncedToast", { count: result.synced }));
        router.refresh(); // stock and receipts changed server-side
      }
      if (result.rejected > 0) {
        toast.error(t("rejectedToast", { count: result.rejected }), { duration: 10_000 });
      }
    }

    async function refreshCatalog() {
      if (!navigator.onLine) return;
      try {
        await refreshOfflineData();
      } catch {
        // keep the previous cache; the next tick retries
      }
    }

    void recoverStuck(db, STUCK_AFTER_MS).then(sync);
    void refreshCatalog();

    const onOnline = () => {
      void sync();
      void refreshCatalog();
    };
    window.addEventListener("online", onOnline);
    const syncTimer = setInterval(() => void sync(), SYNC_INTERVAL_MS);
    const reportTimer = setInterval(() => void report(), 60_000);
    const catalogTimer = setInterval(() => void refreshCatalog(), CATALOG_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      clearInterval(syncTimer);
      clearInterval(reportTimer);
      clearInterval(catalogTimer);
    };
  }, [userId, router, t]);

  return null;
}
