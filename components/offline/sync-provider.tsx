"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { getOfflineDb } from "@/lib/offline/db";
import { recoverStuck } from "@/lib/offline/outbox";
import { refreshOfflineData } from "@/lib/offline/register-data";
import { submitQueuedSale } from "@/lib/offline/submit";
import { drainOutboxExclusive } from "@/lib/offline/sync";
import { reportSyncBacklog } from "@/lib/actions/ops-health";
import { countByStatus } from "@/lib/offline/outbox";

const SYNC_INTERVAL_MS = 30_000;
const CATALOG_INTERVAL_MS = 10 * 60_000;
/** A `syncing` row older than this has no live submitter (crash/restart). */
const STUCK_AFTER_MS = 2 * 60_000;
const SIGN_IN_TOAST = "offline-needs-sign-in";

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
      // browsers without Web Locks: requeue sales whose submitter has been gone a while
      await recoverStuck(db, STUCK_AFTER_MS, userId);
      // null: another tab of this browser is draining right now
      const result = await drainOutboxExclusive(db, userId, submitQueuedSale);
      if (!result) return;
      await report();
      if (cancelled) return;
      if (result.needsSignIn) {
        // the queue is paused until the cashier signs in again; say so until it drains
        toast.error(t("needsSignIn", { count: result.remaining }), { id: SIGN_IN_TOAST, duration: Infinity });
      } else {
        toast.dismiss(SIGN_IN_TOAST);
      }
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

    // An IndexedDB or network error here must never become an unhandled rejection: the next tick retries.
    const safely = (job: () => Promise<void>) => () => void job().catch(() => undefined);
    const safeSync = safely(sync);
    const safeReport = safely(report);

    safeSync();
    void refreshCatalog();

    const onOnline = () => {
      safeSync();
      void refreshCatalog();
    };
    window.addEventListener("online", onOnline);
    const syncTimer = setInterval(safeSync, SYNC_INTERVAL_MS);
    const reportTimer = setInterval(safeReport, 60_000);
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
