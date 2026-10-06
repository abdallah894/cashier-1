"use strict";
// Raw receipt printing for the desktop app.
//
// The website cannot talk to a printer that has its normal Windows driver
// installed (WebUSB needs the driver replaced). The desktop app can: it hands
// the ESC/POS bytes to the Windows print queue as a RAW document, which is
// exactly what the printer's own software does. This module is pure Node (no
// Electron import) with every side effect injected, so it is unit-tested from
// the repository's test suite and the only untested line is the real spooler.
const { spawn: nodeSpawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const MAX_BYTES = 2_000_000; // a long Arabic bitmap receipt is a few hundred KB
const MAX_NAME = 200;
const TIMEOUT_MS = 20_000;

// Fixed script: the only inputs are two environment variables, so a printer
// name can never become code. (No backticks or template placeholders inside:
// it lives in a JS template literal.)
const WINDOWS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class CachierRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DocInfo {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool StartDocPrinter(IntPtr handle, int level, [In] DocInfo info);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool WritePrinter(IntPtr handle, IntPtr bytes, int count, out int written);
  public static void Send(string printer, byte[] data) {
    IntPtr handle;
    if (!OpenPrinter(printer, out handle, IntPtr.Zero)) throw new Exception("open:" + Marshal.GetLastWin32Error());
    try {
      DocInfo info = new DocInfo();
      info.pDocName = "Cachier receipt";
      info.pDataType = "RAW";
      if (!StartDocPrinter(handle, 1, info)) throw new Exception("startdoc:" + Marshal.GetLastWin32Error());
      try {
        if (!StartPagePrinter(handle)) throw new Exception("startpage:" + Marshal.GetLastWin32Error());
        try {
          IntPtr buffer = Marshal.AllocCoTaskMem(data.Length);
          try {
            Marshal.Copy(data, 0, buffer, data.Length);
            int written;
            if (!WritePrinter(handle, buffer, data.Length, out written) || written != data.Length)
              throw new Exception("write:" + Marshal.GetLastWin32Error());
          } finally { Marshal.FreeCoTaskMem(buffer); }
        } finally { EndPagePrinter(handle); }
      } finally { EndDocPrinter(handle); }
    } finally { ClosePrinter(handle); }
  }
}
"@
try {
  [CachierRawPrinter]::Send($env:CACHIER_PRINTER, [System.IO.File]::ReadAllBytes($env:CACHIER_DATA_FILE))
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 2
}
`;

/**
 * Checks a request from the web page. The printer must be one Windows
 * reports as installed (exact name); the payload is bounded. Returns the bytes
 * as a Buffer on success.
 */
function validatePrintRequest(printer, bytes, installedPrinterNames) {
  if (typeof printer !== "string" || printer.length === 0 || printer.length > MAX_NAME || /[\u0000-\u001f]/.test(printer)) {
    return { ok: false, error: "printer name is not valid" };
  }
  if (!Array.isArray(installedPrinterNames) || !installedPrinterNames.includes(printer)) {
    return { ok: false, error: "printer not installed" };
  }
  if (!(bytes instanceof Uint8Array)) return { ok: false, error: "print data is not valid" };
  if (bytes.length === 0) return { ok: false, error: "print data is empty" };
  if (bytes.length > MAX_BYTES) return { ok: false, error: "print data is too large" };
  return { ok: true, data: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
}

/** How to run the raw print on this platform. Never goes through a shell. */
function buildPrintCommand(platform, printer, dataFile, baseEnv) {
  if (platform === "win32") {
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(WINDOWS_SCRIPT, "utf16le").toString("base64")],
      env: { ...baseEnv, CACHIER_PRINTER: printer, CACHIER_DATA_FILE: dataFile },
    };
  }
  // CUPS (Linux/macOS development machines and Linux tills): a raw job
  return { command: "lp", args: ["-d", printer, "-o", "raw", dataFile], env: baseEnv };
}

/** Turns what the print process did into one short message the web app can translate. */
function describeFailure(platform, { code, stderr, timedOut, spawnError }) {
  if (spawnError) return "the print service is not available on this computer";
  if (timedOut) return "print timed out";
  const text = String(stderr || "");
  if (platform === "win32") {
    // 1801 = invalid printer name, 2 = file not found
    if (/\bopen:(1801|2)\b/.test(text)) return "printer not installed";
  } else if (/does not exist|unknown destination|not found|no such printer/i.test(text)) {
    return "printer not installed";
  }
  return "the print queue refused the document";
}

function runProcess({ command, args, env }, { spawn, timeoutMs }) {
  return new Promise((resolve) => {
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let child;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stderr, timedOut, ...result });
    };
    try {
      child = spawn(command, args, { env, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    } catch (error) {
      resolve({ code: null, stderr: "", timedOut: false, spawnError: error });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // already gone
      }
      finish({ code: null });
    }, timeoutMs);
    child.stderr?.on("data", (chunk) => {
      if (stderr.length < 4000) stderr += String(chunk);
    });
    child.on("error", (error) => finish({ code: null, spawnError: error }));
    child.on("close", (code) => finish({ code }));
  });
}

/**
 * Sends one raw document to an installed printer. Always resolves:
 * { ok: true } or { ok: false, error }. The temp file is always removed.
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function printRaw({ printer, bytes }, deps) {
  const d = {
    platform: process.platform,
    spawn: nodeSpawn,
    fs,
    tmpdir: os.tmpdir(),
    randomId: () => crypto.randomBytes(8).toString("hex"),
    timeoutMs: TIMEOUT_MS,
    baseEnv: process.env,
    // an explicitly undefined override must not wipe a default
    ...Object.fromEntries(Object.entries(deps || {}).filter(([, value]) => value !== undefined)),
  };
  let installed;
  try {
    installed = await d.listPrinters();
  } catch {
    return { ok: false, error: "the print service is not available on this computer" };
  }
  const valid = validatePrintRequest(printer, bytes, installed);
  if (!valid.ok) return valid;
  if (d.platform !== "win32" && printer.startsWith("-")) return { ok: false, error: "printer name is not valid" };

  const file = path.join(d.tmpdir, `cachier-print-${d.randomId()}.bin`);
  try {
    d.fs.writeFileSync(file, valid.data, { mode: 0o600 });
  } catch {
    return { ok: false, error: "the print service is not available on this computer" };
  }
  try {
    const result = await runProcess(buildPrintCommand(d.platform, printer, file, d.baseEnv), d);
    if (!result.spawnError && !result.timedOut && result.code === 0) return { ok: true };
    return { ok: false, error: describeFailure(d.platform, result) };
  } finally {
    try {
      d.fs.unlinkSync(file);
    } catch {
      // already removed
    }
  }
}

/** Only the app's own top-level page may use the bridge (not an iframe, not another site). */
function isTrustedSender(event, appOrigin) {
  const frame = event && event.senderFrame;
  if (!frame || frame.parent) return false;
  try {
    return new URL(frame.url).origin === appOrigin;
  } catch {
    return false;
  }
}

module.exports = { MAX_BYTES, MAX_NAME, TIMEOUT_MS, WINDOWS_SCRIPT, validatePrintRequest, buildPrintCommand, describeFailure, printRaw, isTrustedSender };
