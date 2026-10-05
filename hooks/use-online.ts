"use client";

import { useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

/**
 * Live navigator.onLine. useSyncExternalStore is the right primitive for an
 * external browser signal (no useEffect/useState dance, consistent through
 * concurrent renders). The Vue equivalent is VueUse's useOnline().
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true // SSR/first paint: assume online
  );
}
