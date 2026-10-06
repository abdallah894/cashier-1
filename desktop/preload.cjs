// Runs in a sandboxed renderer: it may only require "electron" (no local
// files, no Node). The page sees ONLY the small `cachierShell` object below;
// there is no generic ipcRenderer, so a page cannot invent new channels.
const { contextBridge, ipcRenderer } = require("electron");

// The main process passes the app version as a launch argument
// (webPreferences.additionalArguments), because a sandboxed preload cannot
// read package.json.
const versionArg = process.argv.find((arg) => arg.startsWith("--cachier-version="));

contextBridge.exposeInMainWorld("cachierShell", {
  platform: "desktop",
  os: process.platform,
  version: versionArg ? versionArg.slice("--cachier-version=".length) : "0.0.0",
  capabilities: ["printers.spooler", "updates"],
  printers: {
    /** Installed printers: { ok: true, printers: [{ name, isDefault }] } or { ok: false, error } */
    list: () => ipcRenderer.invoke("cachier:printers:list"),
    /** Sends raw ESC/POS bytes to an installed printer's print queue: { ok: true } or { ok: false, error } */
    printRaw: (printer, bytes) => ipcRenderer.invoke("cachier:printers:print-raw", printer, bytes),
  },
  updates: {
    status: () => ipcRenderer.invoke("cachier:updates:status"),
    /** Subscribes to status changes; returns an unsubscribe function. */
    onStatus: (callback) => {
      const listener = (_event, status) => callback(status);
      ipcRenderer.on("cachier:updates:status", listener);
      return () => ipcRenderer.removeListener("cachier:updates:status", listener);
    },
    restartToUpdate: () => ipcRenderer.invoke("cachier:updates:restart"),
  },
});
