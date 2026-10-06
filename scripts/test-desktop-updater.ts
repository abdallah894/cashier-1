/** Desktop auto-update policy and crash-recovery guard (desktop/updater.cjs, desktop/recovery.cjs). */
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createUpdater, FIRST_CHECK_MS, CHECK_EVERY_MS } = require("../desktop/updater.cjs") as typeof import("../desktop/updater.cjs");
const { createRecoveryGuard } = require("../desktop/recovery.cjs") as typeof import("../desktop/recovery.cjs");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

function fakeAutoUpdater(options: { checkRejects?: boolean } = {}) {
  const emitter = new EventEmitter() as EventEmitter & {
    autoDownload?: boolean;
    autoInstallOnAppQuit?: boolean;
    checks: number;
    installed: unknown[];
    checkForUpdates: () => Promise<void>;
    quitAndInstall: (silent: boolean, forceRun: boolean) => void;
  };
  emitter.checks = 0;
  emitter.installed = [];
  emitter.checkForUpdates = async () => {
    emitter.checks++;
    if (options.checkRejects) throw new Error("GitHub is unreachable");
  };
  emitter.quitAndInstall = (silent, forceRun) => emitter.installed.push([silent, forceRun]);
  return emitter;
}

async function main() {
  // ---- disabled (development, unpackaged, or auto-update turned off) ----
  {
    const au = fakeAutoUpdater();
    const timers: unknown[] = [];
    const u = createUpdater({ autoUpdater: au, enabled: false, send: () => {}, setTimeoutFn: ((...a: unknown[]) => timers.push(a)) as never, setIntervalFn: ((...a: unknown[]) => timers.push(a)) as never });
    u.start();
    await u.check();
    check("a disabled updater never schedules or checks anything", timers.length === 0 && au.checks === 0 && u.status().state === "disabled");
    check("and refuses to restart", u.restartToUpdate().ok === false && au.installed.length === 0);
  }

  // ---- enabled ----
  const au = fakeAutoUpdater();
  const sent: Array<{ state: string; version?: string; percent?: number }> = [];
  const timers: Array<{ kind: string; ms: number; fn: () => void }> = [];
  const u = createUpdater({
    autoUpdater: au,
    enabled: true,
    send: (s: never) => sent.push(s),
    setTimeoutFn: ((fn: () => void, ms: number) => timers.push({ kind: "timeout", ms, fn })) as never,
    setIntervalFn: ((fn: () => void, ms: number) => timers.push({ kind: "interval", ms, fn })) as never,
  });
  const status = () => u.status() as { state: string; version?: string; percent?: number; message?: string };
  check("downloads in the background and installs when the app quits", au.autoDownload === true && au.autoInstallOnAppQuit === true);
  u.start();
  check("the first check is shortly after start, then every 6 hours", timers.some((t) => t.kind === "timeout" && t.ms === FIRST_CHECK_MS) && timers.some((t) => t.kind === "interval" && t.ms === CHECK_EVERY_MS) && CHECK_EVERY_MS === 21_600_000);

  timers.find((t) => t.kind === "timeout")!.fn();
  await new Promise((r) => setTimeout(r, 5));
  check("a scheduled check runs the update check", au.checks === 1 && sent[0].state === "checking");

  check("restart is refused while nothing is downloaded", u.restartToUpdate().ok === false && au.installed.length === 0);

  au.emit("update-available", { version: "1.2.0" });
  au.emit("download-progress", { percent: 41.6 });
  check("progress is reported with the new version", status().state === "downloading" && status().version === "1.2.0" && status().percent === 42);
  await u.check();
  check("no second check starts while downloading", au.checks === 1);
  check("restart is still refused mid-download", u.restartToUpdate().ok === false);

  au.emit("update-downloaded", { version: "1.2.0" });
  check("a finished download is 'ready'", status().state === "ready" && status().version === "1.2.0");
  await u.check();
  check("a ready update is not checked again", au.checks === 1);
  const restarted = u.restartToUpdate();
  check("only now can it restart, and it restarts into the new version", restarted.ok === true && JSON.stringify(au.installed) === "[[false,true]]");

  // ---- failures never crash the till ----
  {
    const bad = fakeAutoUpdater({ checkRejects: true });
    const states: string[] = [];
    const ub = createUpdater({ autoUpdater: bad, enabled: true, send: (s: never) => states.push((s as { state: string }).state), setTimeoutFn: (() => {}) as never, setIntervalFn: (() => {}) as never });
    await ub.check();
    check("an unreachable release server becomes an 'error' status, not an exception", ub.status().state === "error" && states.includes("error"));
    bad.emit("update-not-available");
    check("and the next successful check clears it", ub.status().state === "idle");
    bad.emit("error", new Error("x".repeat(500)));
    check("error text is clipped", (ub.status() as { message?: string }).message!.length <= 200);
  }

  // ---- crash recovery ----
  {
    let now = 1_000;
    const g = createRecoveryGuard(3, 60_000, () => now);
    check("the first three crashes in a minute reload the page", g.shouldReload() && g.shouldReload() && g.shouldReload());
    check("the fourth does not (no endless reload loop)", !g.shouldReload());
    now += 61_000;
    check("after a quiet minute it reloads again", g.shouldReload());
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failing`);
    process.exit(1);
  }
  console.log("\nDesktop updater tests passed.");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
