/**
 * Desktop raw-print bridge (desktop/print-bridge.cjs): request validation,
 * how the print process is launched on Windows and CUPS, failure messages,
 * timeout, cleanup — plus one run with a REAL child process.
 * The actual Windows spooler call is not exercised here (needs Windows).
 */
import { EventEmitter } from "node:events";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const bridge = require("../desktop/print-bridge.cjs") as typeof import("../desktop/print-bridge.cjs");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

const INSTALLED = ["XP-80C", "Receipt Printer (Copy 1)", "-weird"];
const BYTES = Uint8Array.from([0x1b, 0x40, 0x68, 0x69, 0x0a]);

// ---- validation ----
const ok = bridge.validatePrintRequest("XP-80C", BYTES, INSTALLED);
check("an installed printer with bytes is accepted", ok.ok === true);
check("names with spaces and brackets are fine", bridge.validatePrintRequest("Receipt Printer (Copy 1)", BYTES, INSTALLED).ok === true);
check("an unknown printer is refused", !bridge.validatePrintRequest("Evil", BYTES, INSTALLED).ok && (bridge.validatePrintRequest("Evil", BYTES, INSTALLED) as { error: string }).error === "printer not installed");
check("the name must match exactly (no case or prefix tricks)", !bridge.validatePrintRequest("xp-80c", BYTES, INSTALLED).ok && !bridge.validatePrintRequest("XP-80", BYTES, INSTALLED).ok);
check("a non-string or empty name is refused", !bridge.validatePrintRequest(undefined as never, BYTES, INSTALLED).ok && !bridge.validatePrintRequest("", BYTES, INSTALLED).ok);
check("control characters in a name are refused", !bridge.validatePrintRequest("XP-80C\n", BYTES, ["XP-80C\n"]).ok);
check("a very long name is refused", !bridge.validatePrintRequest("x".repeat(201), BYTES, ["x".repeat(201)]).ok);
check("empty data is refused", !bridge.validatePrintRequest("XP-80C", new Uint8Array(0), INSTALLED).ok);
check("data that is not bytes is refused", !bridge.validatePrintRequest("XP-80C", "ESC@" as never, INSTALLED).ok && !bridge.validatePrintRequest("XP-80C", [1, 2, 3] as never, INSTALLED).ok);
check("2 MB is allowed, one byte more is not", bridge.validatePrintRequest("XP-80C", new Uint8Array(bridge.MAX_BYTES), INSTALLED).ok && !bridge.validatePrintRequest("XP-80C", new Uint8Array(bridge.MAX_BYTES + 1), INSTALLED).ok);
check("the bytes survive unchanged (even when the array is a view)", (() => {
  const big = new Uint8Array([9, 9, 1, 2, 3, 9]);
  const r = bridge.validatePrintRequest("XP-80C", big.subarray(2, 5), INSTALLED);
  return r.ok === true && Array.from(r.data ?? []).join() === "1,2,3";
})());

// ---- how the process is launched ----
const win = bridge.buildPrintCommand("win32", "My Printer; calc.exe", "C:\\tmp\\a.bin", { PATH: "x" });
check("Windows runs powershell directly, with no shell", win.command === "powershell.exe" && !win.args.includes("-Command") && win.args.includes("-EncodedCommand"));
check("the printer name and data file travel in environment variables", win.env.CACHIER_PRINTER === "My Printer; calc.exe" && win.env.CACHIER_DATA_FILE === "C:\\tmp\\a.bin" && win.env.PATH === "x");
check("a hostile printer name appears nowhere in the arguments", !win.args.join(" ").includes("calc.exe"));
const encoded = win.args[win.args.indexOf("-EncodedCommand") + 1];
const decoded = Buffer.from(encoded, "base64").toString("utf16le");
check("the encoded script is exactly the fixed script", decoded === bridge.WINDOWS_SCRIPT);
check("the script sends a RAW document through the spooler", /pDataType = "RAW"/.test(decoded) && decoded.includes("WritePrinter") && decoded.includes("StartDocPrinter") && decoded.includes("$env:CACHIER_PRINTER"));
check("the script never builds commands from the printer name", !/Invoke-Expression|\biex\b|Start-Process/i.test(decoded));
const cups = bridge.buildPrintCommand("linux", "XP-80C", "/tmp/a.bin", {});
check("CUPS prints a raw job with lp", cups.command === "lp" && cups.args.join(" ") === "-d XP-80C -o raw /tmp/a.bin");

// ---- failure messages ----
check("an invalid printer name from Windows is 'not installed'", bridge.describeFailure("win32", { code: 2, stderr: "open:1801", timedOut: false, spawnError: undefined }) === "printer not installed");
check("a spooler refusal is a queue refusal", bridge.describeFailure("win32", { code: 2, stderr: "write:5", timedOut: false, spawnError: undefined }) === "the print queue refused the document");
check("CUPS 'does not exist' is 'not installed'", bridge.describeFailure("linux", { code: 1, stderr: "lp: The printer or class does not exist.", timedOut: false, spawnError: undefined }) === "printer not installed");
check("a timeout is reported as such", bridge.describeFailure("win32", { code: null, stderr: "", timedOut: true, spawnError: undefined }) === "print timed out");
check("a missing powershell/lp is reported as unavailable", bridge.describeFailure("win32", { code: null, stderr: "", timedOut: false, spawnError: new Error("ENOENT") }) === "the print service is not available on this computer");

// ---- printRaw with a fake process ----
type Scenario = { code?: number; stderr?: string; hang?: boolean; throws?: boolean; error?: boolean };
function fakeSpawn(scenario: Scenario, calls: { command: string; args: string[]; env: Record<string, string> }[] = []) {
  return (command: string, args: string[], options: { env: Record<string, string> }) => {
    calls.push({ command, args, env: options.env });
    if (scenario.throws) throw new Error("spawn exploded");
    const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter; kill: () => void; killed?: boolean };
    child.stderr = new EventEmitter();
    child.kill = () => {
      child.killed = true;
    };
    if (!scenario.hang) {
      setTimeout(() => {
        if (scenario.error) return child.emit("error", new Error("ENOENT"));
        if (scenario.stderr) child.stderr.emit("data", Buffer.from(scenario.stderr));
        child.emit("close", scenario.code ?? 0);
      }, 5);
    }
    return child;
  };
}
const sandbox = mkdtempSync(join(tmpdir(), "bridge-test-"));
const base = (scenario: Scenario, platform = "win32", calls: { command: string; args: string[]; env: Record<string, string> }[] = []) => ({
  platform,
  tmpdir: sandbox,
  baseEnv: {},
  timeoutMs: 80,
  listPrinters: async () => INSTALLED,
  spawn: fakeSpawn(scenario, calls) as never,
});

async function main() {
  const calls: { command: string; args: string[]; env: Record<string, string> }[] = [];
  const fine = await bridge.printRaw({ printer: "XP-80C", bytes: BYTES }, base({}, "win32", calls));
  check("a good print succeeds", fine.ok === true);
  check("exactly one process was started with the right printer", calls.length === 1 && calls[0].env.CACHIER_PRINTER === "XP-80C");
  check("the temp file is gone afterwards", readdirSync(sandbox).length === 0, readdirSync(sandbox).join(","));

  const refused = await bridge.printRaw({ printer: "XP-80C", bytes: BYTES }, base({ code: 2, stderr: "write:5" }));
  check("a refusal is reported and the temp file is still removed", !refused.ok && refused.error === "the print queue refused the document" && readdirSync(sandbox).length === 0);

  const gone = await bridge.printRaw({ printer: "XP-80C", bytes: BYTES }, base({ code: 2, stderr: "open:1801" }));
  check("a printer removed since listing is 'not installed'", !gone.ok && gone.error === "printer not installed");

  const hung = await bridge.printRaw({ printer: "XP-80C", bytes: BYTES }, base({ hang: true }));
  check("a hung print times out and cleans up", !hung.ok && hung.error === "print timed out" && readdirSync(sandbox).length === 0);

  const missing = await bridge.printRaw({ printer: "XP-80C", bytes: BYTES }, base({ error: true }));
  check("a missing executable is reported", !missing.ok && missing.error === "the print service is not available on this computer");
  const thrown = await bridge.printRaw({ printer: "XP-80C", bytes: BYTES }, base({ throws: true }));
  check("a spawn that throws is reported, not crashed", !thrown.ok && readdirSync(sandbox).length === 0);

  const unknown = await bridge.printRaw({ printer: "Evil", bytes: BYTES }, base({}, "win32", calls));
  check("an unknown printer never starts a process", !unknown.ok && calls.length === 1);
  const list = await bridge.printRaw({ printer: "XP-80C", bytes: BYTES }, { ...base({}), listPrinters: async () => { throw new Error("no spooler"); } });
  check("a failing printer list is reported", !list.ok && list.error === "the print service is not available on this computer");
  const dash = await bridge.printRaw({ printer: "-weird", bytes: BYTES }, base({}, "linux"));
  check("on CUPS a printer name that looks like an option is refused", !dash.ok);

  // ---- a REAL child process: a stub `lp` that copies the job file ----
  const bin = join(sandbox, "bin");
  mkdirSync(bin);
  const out = join(sandbox, "received.bin");
  writeFileSync(join(bin, "lp"), `#!/usr/bin/env bash\nset -e\nlast="\${@: -1}"\ncp "$last" "${out}"\n`);
  chmodSync(join(bin, "lp"), 0o755);
  const real = await bridge.printRaw(
    { printer: "XP-80C", bytes: BYTES },
    { platform: "linux", tmpdir: sandbox, baseEnv: { PATH: `${bin}:${process.env.PATH}` }, listPrinters: async () => INSTALLED }
  );
  check("a real child process receives the exact bytes", real.ok === true && existsSync(out) && Array.from(readFileSync(out)).join() === Array.from(BYTES).join(), JSON.stringify(real));
  check("and the temp job file is removed", readdirSync(sandbox).filter((f) => f.startsWith("cachier-print-")).length === 0);

  const noLp = await bridge.printRaw({ printer: "XP-80C", bytes: BYTES }, { platform: "linux", tmpdir: sandbox, baseEnv: { PATH: "/nonexistent" }, listPrinters: async () => INSTALLED });
  check("with no lp installed the real spawn error is reported cleanly", !noLp.ok && noLp.error === "the print service is not available on this computer", JSON.stringify(noLp));

  // ---- sender trust ----
  const origin = "https://pos.example.com";
  const ev = (url: string, parent: unknown = null) => ({ senderFrame: { url, parent } });
  check("the app's own top-level page is trusted", bridge.isTrustedSender(ev("https://pos.example.com/ar/register"), origin));
  check("another origin is not", !bridge.isTrustedSender(ev("https://evil.example/x"), origin));
  check("a look-alike host is not", !bridge.isTrustedSender(ev("https://pos.example.com.evil.io/"), origin) && !bridge.isTrustedSender(ev("http://pos.example.com/"), origin));
  check("an iframe of the app is not (only the top frame)", !bridge.isTrustedSender(ev("https://pos.example.com/", { url: "x" }), origin));
  check("a missing frame or garbage url is not", !bridge.isTrustedSender({}, origin) && !bridge.isTrustedSender(ev("not a url"), origin) && !bridge.isTrustedSender(null, origin));
  check("file:// pages are not trusted", !bridge.isTrustedSender(ev("file:///C:/offline.html"), origin));

  rmSync(sandbox, { recursive: true, force: true });
  if (failures > 0) {
    console.error(`\n${failures} check(s) failing`);
    process.exit(1);
  }
  console.log("\nDesktop print bridge tests passed.");
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
