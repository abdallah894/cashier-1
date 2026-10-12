/** Cache of whole pages the till can open without a connection (see app/sw.ts). */
export const OFFLINE_PAGES_CACHE = "offline-pages";

/** Static page shown for a page that was never saved on this till (public/offline.html). */
export const OFFLINE_FALLBACK_URL = "/offline.html";

/** Pages that work offline: the register and pending sales read the device's own data. */
export const OFFLINE_CAPABLE = ["/register", "/offline-sales"] as const;

export function offlinePageUrls(locale: string): string[] {
  return OFFLINE_CAPABLE.map((path) => `/${locale}${path}`);
}

/** Asks the service worker to save the offline-capable pages for this locale. */
export function warmOfflinePages(locale: string): void {
  if (typeof navigator === "undefined" || !navigator.onLine || !navigator.serviceWorker) return;
  // `ready` also covers the very first visit, before the worker controls the page
  void navigator.serviceWorker.ready
    .then((registration) => registration.active?.postMessage({ type: "WARM_PAGES", urls: offlinePageUrls(locale) }))
    .catch(() => undefined);
}

/** On sign-out: the saved pages show the signed-in cashier's shift, so drop them. */
export async function clearOfflinePages(): Promise<void> {
  try {
    if (typeof caches !== "undefined") await caches.delete(OFFLINE_PAGES_CACHE);
  } catch {
    // nothing to clear
  }
}
