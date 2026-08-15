"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { WifiOff } from "lucide-react";

// Live online/offline badge for the shell header. useSyncExternalStore is
// the right primitive for an external browser signal (same pattern this
// project uses for localStorage state) — no useEffect/useState dance, and
// it stays consistent through concurrent renders.
function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function useIsOnline() {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true // SSR/first paint: assume online
  );
}

export function NetworkIndicator() {
  const online = useIsOnline();
  const t = useTranslations("shell");
  if (online) return null;
  return (
    <span
      role="status"
      title={t("offlineHint")}
      className="flex items-center gap-1.5 rounded-md bg-amber-500/15 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-400"
    >
      <WifiOff className="size-3.5" />
      {t("offline")}
    </span>
  );
}
