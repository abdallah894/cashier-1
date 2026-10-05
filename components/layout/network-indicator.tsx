"use client";

import { useTranslations } from "next-intl";
import { CloudUpload, TriangleAlert, WifiOff } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { useOnline } from "@/hooks/use-online";
import { useOutboxCounts } from "@/hooks/use-outbox-counts";

/** Shell-header status: offline badge plus queued / needs-attention sale counts. */
export function NetworkIndicator({ userId }: { userId: string }) {
  const online = useOnline();
  const counts = useOutboxCounts(userId);
  const t = useTranslations("shell");
  const tOffline = useTranslations("offline");

  const pending = (counts?.queued ?? 0) + (counts?.syncing ?? 0);
  const rejected = counts?.rejected ?? 0;

  return (
    <>
      {!online && (
        <span
          role="status"
          title={t("offlineHint")}
          className="flex items-center gap-1.5 rounded-md bg-amber-500/15 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-400"
        >
          <WifiOff className="size-3.5" />
          {t("offline")}
        </span>
      )}
      {pending > 0 && (
        <Link
          href="/offline-sales"
          className="flex items-center gap-1.5 rounded-md bg-sky-500/15 px-2 py-1 text-xs font-medium text-sky-700 dark:text-sky-400"
        >
          <CloudUpload className="size-3.5" />
          {tOffline("pendingBadge", { count: pending })}
        </Link>
      )}
      {rejected > 0 && (
        <Link
          href="/offline-sales"
          className="bg-destructive/15 text-destructive flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium"
        >
          <TriangleAlert className="size-3.5" />
          {tOffline("rejectedBadge", { count: rejected })}
        </Link>
      )}
    </>
  );
}
