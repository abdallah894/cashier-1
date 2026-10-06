"use strict";
// Auto-update policy around electron-updater (injected, so it is unit-tested).
//
//  - checks shortly after start and every 6 hours, downloads in the background;
//  - NEVER restarts by itself: a till might be mid-sale. The new version installs
//    when the app is next quit/started, or when the cashier presses "Restart to
//    update" (the web app only enables that button when the cart is empty);
//  - only active in a packaged build, so development runs never touch the network.
const FIRST_CHECK_MS = 30_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

function createUpdater({ autoUpdater, enabled, send, log = () => {}, setTimeoutFn = setTimeout, setIntervalFn = setInterval }) {
  let status = { state: enabled ? "idle" : "disabled" };

  const set = (next) => {
    status = next;
    send(status);
  };

  async function check() {
    if (!enabled || status.state === "downloading" || status.state === "ready") return;
    set({ state: "checking" });
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      log("update_check_failed", error);
      set({ state: "error", message: String((error && error.message) || error).slice(0, 200) });
    }
  }

  if (enabled) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true; // installs when the app is closed or restarted
    autoUpdater.autoRunAppAfterInstall = true;
    autoUpdater.on("update-available", (info) => set({ state: "downloading", version: info && info.version, percent: 0 }));
    autoUpdater.on("download-progress", (progress) => set({ state: "downloading", version: status.version, percent: Math.round((progress && progress.percent) || 0) }));
    autoUpdater.on("update-downloaded", (info) => set({ state: "ready", version: (info && info.version) || status.version }));
    autoUpdater.on("update-not-available", () => set({ state: "idle" }));
    autoUpdater.on("error", (error) => {
      log("update_error", error);
      set({ state: "error", message: String((error && error.message) || error).slice(0, 200) });
    });
  }

  return {
    start() {
      if (!enabled) return;
      setTimeoutFn(() => void check(), FIRST_CHECK_MS);
      setIntervalFn(() => void check(), CHECK_EVERY_MS);
    },
    check,
    status: () => status,
    /** Restarts into the downloaded version. Refuses unless one is ready. */
    restartToUpdate() {
      if (!enabled || status.state !== "ready") return { ok: false, error: "no update is ready" };
      autoUpdater.quitAndInstall(false, true);
      return { ok: true };
    },
  };
}

module.exports = { createUpdater, FIRST_CHECK_MS, CHECK_EVERY_MS };
