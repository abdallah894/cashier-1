import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from "serwist";
import { ExpirationPlugin, NetworkFirst, Serwist } from "serwist";
import { OFFLINE_FALLBACK_URL, OFFLINE_PAGES_CACHE } from "../lib/offline/pages";

// Serwist service worker: precaches the app shell + static assets so the
// installed app launches instantly and survives a brief network blip. Offline
// SALES are not queued here: they live in the IndexedDB outbox (lib/offline/)
// and are drained by the page (components/offline/sync-provider.tsx).

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    // Injected at build time by @serwist/next with the precache manifest.
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * Page loads (typing a URL, reloading, or Next falling back to a full load
 * when an in-app navigation cannot reach the server): network first, then the
 * last copy of that page saved on this till. Login redirects are never saved,
 * so an expired session cannot replace the register with the login page.
 */
const pageNavigations: RuntimeCaching = {
  matcher: ({ request, sameOrigin, url }) => request.mode === "navigate" && sameOrigin && !url.pathname.startsWith("/api/"),
  handler: new NetworkFirst({
    cacheName: OFFLINE_PAGES_CACHE,
    networkTimeoutSeconds: 5,
    matchOptions: { ignoreVary: true },
    plugins: [
      { cacheWillUpdate: async ({ response }) => (response.ok && !response.redirected ? response : null) },
      new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 7 * 24 * 60 * 60 }),
    ],
  }),
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [pageNavigations, ...defaultCache],
  // a page never saved on this till: a friendly bilingual "you're offline" page instead of the browser's error
  fallbacks: {
    entries: [{ url: OFFLINE_FALLBACK_URL, matcher: ({ request }) => request.destination === "document" }],
  },
});

/**
 * The pages a till needs offline (register, pending sales) are saved ahead of
 * time: the app asks for them while online, so they open even if the cashier
 * never visited them before the connection dropped.
 */
self.addEventListener("message", (event) => {
  const data = event.data as { type?: string; urls?: unknown } | null;
  if (data?.type !== "WARM_PAGES" || !Array.isArray(data.urls)) return;
  const urls = data.urls.filter((url): url is string => typeof url === "string" && url.startsWith("/") && !url.startsWith("//"));
  event.waitUntil(
    (async () => {
      const cache = await caches.open(OFFLINE_PAGES_CACHE);
      await Promise.all(
        urls.map(async (url) => {
          try {
            const response = await fetch(url, { credentials: "same-origin" });
            if (response.ok && !response.redirected && response.headers.get("content-type")?.includes("text/html")) {
              await cache.put(url, response);
            }
          } catch {
            // offline or server error: keep the copy we have
          }
        })
      );
    })()
  );
});

serwist.addEventListeners();
