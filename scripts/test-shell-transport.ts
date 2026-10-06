/** Web side of the desktop bridge: ShellTransport, transport choice, versions, device settings. */
import { buildTestPage, chooseTransportKind, listShellPrinters, shellCanPrint, ShellTransport, type CachierShell } from "../lib/devices/shell";
import { compareVersions, shellIsTooOld } from "../lib/shell/version";
import { saveDeviceSchema } from "../lib/validation/devices";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

function fakeShell(overrides: { printRaw?: (printer: string, bytes: Uint8Array) => Promise<{ ok: boolean; error?: string }>; capabilities?: string[]; noPrinters?: boolean } = {}) {
  const calls: { printer: string; bytes: number[] }[] = [];
  const shell = {
    platform: "desktop",
    os: "win32",
    version: "1.0.0",
    capabilities: overrides.capabilities ?? ["printers.spooler", "updates"],
    printers: overrides.noPrinters
      ? undefined
      : {
          list: async () => ({ ok: true as const, printers: [{ name: "XP-80C", isDefault: true }, { name: "PDF", isDefault: false }] }),
          printRaw: async (printer: string, bytes: Uint8Array) => {
            calls.push({ printer, bytes: Array.from(bytes) });
            return (overrides.printRaw ? await overrides.printRaw(printer, bytes) : { ok: true }) as { ok: true } | { ok: false; error: string };
          },
        },
  } as unknown as CachierShell;
  return { shell, calls };
}

async function main() {
  // ---- capability check ----
  check("no shell means no printing through Windows", !shellCanPrint(null));
  check("a shell without the capability cannot print", !shellCanPrint(fakeShell({ capabilities: ["updates"] }).shell));
  check("a shell without the printers api cannot print", !shellCanPrint(fakeShell({ noPrinters: true }).shell));
  check("a normal desktop shell can", shellCanPrint(fakeShell().shell));

  // ---- transport ----
  const { shell, calls } = fakeShell();
  if (!shellCanPrint(shell)) throw new Error("fake shell should print");
  const transport = new ShellTransport(shell, "XP-80C");
  check("the transport is labelled with the printer", transport.label === "XP-80C");
  await transport.send(Uint8Array.from([0x1b, 0x40, 1, 2, 3]));
  check("send hands the exact bytes to the named printer", calls.length === 1 && calls[0].printer === "XP-80C" && calls[0].bytes.join() === "27,64,1,2,3");
  await transport.close();
  check("close is harmless", true);

  const failing = fakeShell({ printRaw: async () => ({ ok: false, error: "printer not installed" }) });
  if (!shellCanPrint(failing.shell)) throw new Error("fake shell should print");
  let message = "";
  try {
    await new ShellTransport(failing.shell, "Gone").send(Uint8Array.from([1]));
  } catch (error) {
    message = (error as Error).message;
  }
  check("a refusal becomes an Error carrying the desktop app's reason (translated later)", message === "printer not installed", message);

  const printers = await listShellPrinters(shell);
  check("the installed printers are listed", printers.map((p) => p.name).join() === "XP-80C,PDF" && printers[0].isDefault);
  let listError = "";
  try {
    await listShellPrinters(fakeShell({ noPrinters: true }).shell);
  } catch (error) {
    listError = (error as Error).message;
  }
  check("listing without the bridge fails with a translatable message", listError === "this app cannot list printers");

  // ---- which transport ----
  check("no printer configured means no transport", chooseTransportKind(null, shell) === "none");
  check("a Windows print queue inside the desktop app uses the bridge", chooseTransportKind({ shellPrinter: "XP-80C" }, shell) === "shell");
  check("a Windows print queue in an ordinary browser falls back to the print dialog (never WebUSB)", chooseTransportKind({ shellPrinter: "XP-80C" }, null) === "none");
  check("a USB printer keeps using WebUSB, in the app or a browser", chooseTransportKind({}, shell) === "usb" && chooseTransportKind({}, null) === "usb");

  // ---- test page ----
  const page = buildTestPage();
  check("the test page initialises, prints text, feeds and cuts", page[0] === 0x1b && page[1] === 0x40 && new TextDecoder().decode(page).includes("Printer test OK") && page.at(-1) === 0x00 && page.at(-4) === 0x1d);

  // ---- versions ----
  check("versions compare numerically, not as text", compareVersions("1.10.0", "1.2.0") === 1 && compareVersions("1.2.0", "1.10.0") === -1 && compareVersions("2.0.0", "2.0.0") === 0);
  check("missing parts count as zero and a suffix is ignored", compareVersions("1.2", "1.2.0") === 0 && compareVersions("1.2.0-beta.1", "1.2.0") === 0);
  check("an app older than the minimum is too old", shellIsTooOld("0.9.9", "1.0.0") && !shellIsTooOld("1.0.0", "1.0.0") && !shellIsTooOld("1.4.2", "1.0.0"));
  check("garbage versions are treated as very old, never as new", shellIsTooOld("banana", "1.0.0"));

  // ---- the server keeps the chosen printer ----
  const base = { tillId: "00000000-0000-4000-8000-000000000001", kind: "printer", name: "Counter", profile: "escpos_spooler_80mm", active: true };
  const parsed = saveDeviceSchema.safeParse({ ...base, settings: { printerName: "  XP-80C  " } });
  check("the chosen print queue survives validation (trimmed)", parsed.success && parsed.data.settings.printerName === "XP-80C");
  check("an empty or control-character name is refused", !saveDeviceSchema.safeParse({ ...base, settings: { printerName: "" } }).success && !saveDeviceSchema.safeParse({ ...base, settings: { printerName: "a\nb" } }).success);
  check("a very long name is refused", !saveDeviceSchema.safeParse({ ...base, settings: { printerName: "x".repeat(201) } }).success);

  if (failures > 0) {
    console.error(`\n${failures} check(s) failing`);
    process.exit(1);
  }
  console.log("\nShell transport tests passed.");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
