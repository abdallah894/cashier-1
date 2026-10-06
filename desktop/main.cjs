// Electron shell for Cachier POS. It loads the deployed web app (so server
// actions, Supabase auth and releases keep working with no separate build)
// and adds what a browser tab cannot: a locked-down window, kiosk mode, a USB
// device chooser for receipt printers, and an offline fallback page.
const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require("electron");
const path = require("node:path");
const bridge = require("./print-bridge.cjs");
const { createRecoveryGuard } = require("./recovery.cjs");
const { createUpdater } = require("./updater.cjs");

const config = require("./app-config.json");
const APP_URL = process.env.POS_APP_URL || config.appUrl;
const DEV = process.argv.includes("--dev");
const KIOSK = process.argv.includes("--kiosk") || config.kiosk === true;
const AUTO_START = config.autoStart === true;
const AUTO_UPDATE = config.autoUpdate !== false;

let origin;
try {
  origin = new URL(APP_URL).origin;
} catch {
  dialog.showErrorBox("Cachier POS", `Invalid app URL: ${APP_URL}`);
  app.exit(1);
}

if (!app.requestSingleInstanceLock()) app.quit();

/** @type {BrowserWindow | null} */
let win = null;
const recovery = createRecoveryGuard(3, 60_000);
/** @type {ReturnType<typeof createUpdater> | null} */
let updater = null;

const isAppUrl = (url) => {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
};

function setupDevicePermissions(ses) {
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const allowed = ["media", "fullscreen", "clipboard-sanitized-write", "notifications"];
    callback(isAppUrl(details.requestingUrl || wc.getURL()) && allowed.includes(permission));
  });
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin) => {
    return requestingOrigin === origin && ["media", "fullscreen", "usb", "clipboard-sanitized-write"].includes(permission);
  });
  ses.setDevicePermissionHandler((details) => details.deviceType === "usb" && details.origin === origin);

  // Electron has no built-in WebUSB picker: choose the receipt printer here.
  ses.on("select-usb-device", (event, details, callback) => {
    event.preventDefault();
    const devices = details.deviceList;
    if (devices.length === 0) return callback();
    if (devices.length === 1) return callback(devices[0].deviceId);
    const labels = devices.map((d) => `${d.productName || "USB device"} (${d.vendorId.toString(16)}:${d.productId.toString(16)})`);
    dialog
      .showMessageBox(win, { type: "question", message: "Choose the receipt printer", buttons: [...labels, "Cancel"], cancelId: labels.length, defaultId: 0 })
      .then(({ response }) => callback(response < devices.length ? devices[response].deviceId : undefined));
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    fullscreen: KIOSK,
    kiosk: KIOSK,
    autoHideMenuBar: true,
    backgroundColor: "#18181b",
    title: "Cachier POS",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      // a sandboxed preload cannot read package.json, so it learns the version here
      additionalArguments: [`--cachier-version=${app.getVersion()}`],
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: DEV,
    },
  });
  win.once("ready-to-show", () => win.show());

  // Stay inside the app; anything else opens in the user's browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) return { action: "allow" };
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url) && !url.startsWith("file:")) {
      event.preventDefault();
      if (/^https?:/.test(url)) void shell.openExternal(url);
    }
  });

  // Never visited + offline: show the local page. Once the app has loaded, its
  // service worker serves the cached shell and the offline outbox keeps selling.
  win.webContents.on("did-fail-load", (_e, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = aborted navigation
    void win.loadFile(path.join(__dirname, "offline.html"), { query: { target: url } });
  });

  // A crashed or frozen page comes back by itself (a till must not stay blank),
  // but not in an endless loop: after 3 reloads a minute the offline page is shown.
  const recover = (reason) => {
    if (!win) return;
    if (recovery.shouldReload()) win.webContents.reload();
    else void win.loadFile(path.join(__dirname, "offline.html"), { query: { target: APP_URL, reason } });
  };
  win.webContents.on("render-process-gone", (_event, details) => {
    if (details.reason !== "clean-exit") recover(details.reason);
  });
  win.on("unresponsive", () => recover("unresponsive"));

  void win.loadURL(APP_URL);
  win.on("closed", () => (win = null));
}

// ---- bridge for the web app (only the app's own top-level page may call it) ----
function registerIpc() {
  const trusted = (event) => bridge.isTrustedSender(event, origin);
  const installedPrinters = async (sender) => (await sender.getPrintersAsync()).map((p) => ({ name: p.name, isDefault: p.isDefault === true, status: p.status }));

  ipcMain.handle("cachier:printers:list", async (event) => {
    if (!trusted(event)) return { ok: false, error: "not allowed" };
    try {
      return { ok: true, printers: await installedPrinters(event.sender) };
    } catch {
      return { ok: false, error: "the print service is not available on this computer" };
    }
  });

  ipcMain.handle("cachier:printers:print-raw", async (event, printer, bytes) => {
    if (!trusted(event)) return { ok: false, error: "not allowed" };
    return bridge.printRaw({ printer, bytes }, { listPrinters: async () => (await installedPrinters(event.sender)).map((p) => p.name) });
  });

  ipcMain.handle("cachier:updates:status", (event) => (trusted(event) && updater ? updater.status() : { state: "disabled" }));
  ipcMain.handle("cachier:updates:restart", (event) => (trusted(event) && updater ? updater.restartToUpdate() : { ok: false, error: "not allowed" }));
}

function startUpdater() {
  let autoUpdater = null;
  const enabled = AUTO_UPDATE && app.isPackaged && !DEV;
  if (enabled) {
    try {
      ({ autoUpdater } = require("electron-updater"));
    } catch (error) {
      console.error("auto-update unavailable:", error && error.message);
    }
  }
  updater = createUpdater({
    autoUpdater: autoUpdater || { on() {}, checkForUpdates: async () => {} },
    enabled: enabled && autoUpdater !== null,
    send: (status) => {
      if (win && !win.isDestroyed()) win.webContents.send("cachier:updates:status", status);
    },
    log: (event, error) => console.error(event, error && error.message),
  });
  updater.start();
}

app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  setupDevicePermissions(session.defaultSession);
  Menu.setApplicationMenu(
    DEV
      ? null
      : Menu.buildFromTemplate([
          { label: "View", submenu: [{ role: "reload" }, { role: "togglefullscreen" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }] },
          ...(process.platform === "darwin" ? [{ role: "editMenu" }] : []),
        ])
  );
  registerIpc();
  if (app.isPackaged && !DEV) app.setLoginItemSettings({ openAtLogin: AUTO_START });
  createWindow();
  startUpdater();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
