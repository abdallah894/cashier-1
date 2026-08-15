import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

// Serwist service worker. PHASE 6 SCOPE: precache the app shell + static
// assets so the installed app launches instantly and survives a brief
// network blip. It does NOT yet queue sales offline — that is the Phase 7
// (offline resilience) work described in docs/offline-plan.md, which will
// add an IndexedDB outbox and a BackgroundSync/queue plugin here.

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    // Injected at build time by @serwist/next with the precache manifest.
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
