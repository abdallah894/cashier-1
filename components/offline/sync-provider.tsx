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

    async function sync() {
      if (!navigator.onLine) return;
      const result = await drainOutbox(db, userId, submitQueuedSale);
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
    const catalogTimer = setInterval(() => void refreshCatalog(), CATALOG_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      clearInterval(syncTimer);
      clearInterval(catalogTimer);
    };
  }, [userId, router, t]);

  return null;
}
