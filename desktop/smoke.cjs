"use strict";
// Launches the REAL Electron app against a tiny local page and checks, from
// inside that page, what the desktop shell actually exposes:
//   - the preload ran in the sandbox (the cachierShell object exists, with the right version);
//   - the page has no Node/Electron globals;
//   - the print bridge answers and refuses bad input without throwing;
//   - updates report "disabled" in an unpackaged run and refuse to restart;
//   - a frame from another origin gets no bridge at all.
// It cannot print (CI has no printer and no Windows spooler). Run: npm run smoke
// (on Linux without a display: xvfb-run -a npm run smoke)
const http = require("node:http");
const { spawn } = require("node:child_process");
const path = require("node:path");
const electronPath = require("electron");
const pkg = require("./package.json");

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

const PAGE = `<!doctype html><meta charset="utf-8"><title>smoke</title><body><script>
(async () => {
  const report = (kind, data) => fetch("/report?kind=" + kind, { method: "POST", body: JSON.stringify(data) });
  const out = {};
  const s = window.cachierShell;
  out.hasShell = !!s;
  out.keys = s ? Object.keys(s).sort() : [];
  out.version = s && s.version;
  out.os = s && s.os;
  out.capabilities = s && s.capabilities;
  out.globals = { require: typeof require, process: typeof process, ipcRenderer: typeof window.ipcRenderer, electron: typeof window.electron, Buffer: typeof Buffer };
  try {
    const list = await s.printers.list();
    out.list = { ok: list.ok, isArray: Array.isArray(list.printers) };
    out.unknownPrinter = await s.printers.printRaw("Definitely Not A Printer", new Uint8Array([27, 64]));
    out.badArgs = await s.printers.printRaw(123, "not bytes");
    out.emptyBytes = await s.printers.printRaw("Definitely Not A Printer", new Uint8Array(0));
    out.updatesStatus = await s.updates.status();
    out.restart = await s.updates.restartToUpdate();
  } catch (e) { out.error = String(e && e.message || e); }
  // the iframe is served from another origin: it must not receive the bridge
  const frame = document.createElement("iframe");
  frame.src = "http://127.0.0.1:" + new URLSearchParams(location.search).get("other") + "/frame";
  document.body.appendChild(frame);
  await report("main", out);
})();
</script>`;

const FRAME = `<!doctype html><script>fetch("/report?kind=frame",{method:"POST",body:JSON.stringify({shell:typeof window.cachierShell})})</script>`;

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

(async () => {
  const reports = {};
  let resolveMain;
  const mainDone = new Promise((r) => (resolveMain = r));
  const collect = (req, res) => {
    const kind = new URL(req.url, "http://x").searchParams.get("kind");
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      reports[kind] = JSON.parse(body || "{}");
      res.end("ok");
      if (kind === "main") resolveMain();
    });
  };
  const other = await listen((req, res) => (req.method === "POST" ? collect(req, res) : (res.setHeader("content-type", "text/html"), res.end(FRAME))));
  const app = await listen((req, res) => (req.method === "POST" ? collect(req, res) : (res.setHeader("content-type", "text/html"), res.end(PAGE))));
  // the frame posts to ITS OWN origin, so give it the same collector
  const frameCollector = other.server;
  void frameCollector;

  const display = process.env.DISPLAY ? [] : ["xvfb-run", ["-a"]];
  // the app FOLDER (like `npm start`): Electron then reads package.json, so app.getVersion() is ours
  // SMOKE_BINARY=path/to/packaged/app tests an electron-builder output (auto-update enabled) instead of the source folder
  const packaged = process.env.SMOKE_BINARY;
  const args = [...(packaged ? [] : [__dirname]), "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"];
  const binary = packaged ? path.resolve(packaged) : electronPath;
  const [cmd, cmdArgs] = display.length ? [display[0], [...display[1], binary, ...args]] : [binary, args];
  const child = spawn(cmd, cmdArgs, {
    env: { ...process.env, POS_APP_URL: `http://127.0.0.1:${app.port}/?other=${other.port}` },
    // Chromium prints harmless dbus errors on a headless machine; SMOKE_VERBOSE=1 shows everything
    stdio: process.env.SMOKE_VERBOSE ? ["ignore", "inherit", "inherit"] : ["ignore", "ignore", "ignore"],
    detached: true,
  });
  child.on("exit", (code) => {
    if (!reports.main) console.error("Electron exited early with code", code);
  });

  const timeout = setTimeout(() => {
    console.error("FAIL  the app did not report within 60 s");
    kill();
    process.exit(1);
  }, 60_000);
  function kill() {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // already gone
    }
  }

  await mainDone;
  await new Promise((r) => setTimeout(r, 1500)); // let the iframe report
  clearTimeout(timeout);
  kill();

  const m = reports.main;
  check("the preload ran in the sandbox and exposed cachierShell", m.hasShell === true);
  check("the app version is passed through (sandboxed preloads cannot read package.json)", m.version === pkg.version, String(m.version));
  check("it reports the platform and capabilities", typeof m.os === "string" && Array.isArray(m.capabilities) && m.capabilities.includes("printers.spooler"));
  check("only the intended members are exposed", JSON.stringify(m.keys) === JSON.stringify(["capabilities", "os", "platform", "printers", "updates", "version"]), JSON.stringify(m.keys));
  check("the page has no Node or Electron globals", Object.values(m.globals).every((t) => t === "undefined"), JSON.stringify(m.globals));
  check("listing printers answers", m.list && m.list.ok === true && m.list.isArray === true, JSON.stringify(m.list));
  check("printing to an unknown printer fails cleanly", m.unknownPrinter && m.unknownPrinter.ok === false && m.unknownPrinter.error === "printer not installed", JSON.stringify(m.unknownPrinter));
  check("garbage arguments are refused, not thrown", m.badArgs && m.badArgs.ok === false, JSON.stringify(m.badArgs));
  check("empty data is refused (here: for an unknown printer)", m.emptyBytes && m.emptyBytes.ok === false, JSON.stringify(m.emptyBytes));
  if (packaged) {
    // auto-update is live in a packaged build: it must be active (not "disabled") and never crash the app
    check("a packaged run has auto-update active", m.updatesStatus && ["idle", "checking", "downloading", "error"].includes(m.updatesStatus.state), JSON.stringify(m.updatesStatus));
  } else {
    check("an unpackaged run reports updates as disabled", m.updatesStatus && m.updatesStatus.state === "disabled", JSON.stringify(m.updatesStatus));
  }
  check("restart is refused while no update is ready", m.restart && m.restart.ok === false, JSON.stringify(m.restart));
  check("no error was thrown inside the page", m.error === undefined, m.error);
  check("a frame from another origin gets no bridge", reports.frame && reports.frame.shell === "undefined", JSON.stringify(reports.frame));

  other.server.close();
  app.server.close();
  const failed = results.filter((ok) => !ok).length;
  if (failed > 0) {
    console.error(`\n${failed} check(s) failing`);
    process.exit(1);
  }
  console.log("\nDesktop smoke test passed.");
  process.exit(0);
})();
