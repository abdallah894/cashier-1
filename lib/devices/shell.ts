import type { PrinterTransport } from "./transport";
import { ESC_POS, feed } from "@/lib/receipts/escpos";

/**
 * The bridge the Windows desktop app (Electron) exposes to the website as
 * `window.cachierShell` (see desktop/preload.cjs). In a normal browser it does
 * not exist and everything here returns "not available".
 */
export type ShellPrinter = { name: string; isDefault: boolean; status?: number };
type Ok<T> = ({ ok: true } & T) | { ok: false; error: string };

export type UpdateStatus = {
  state: "disabled" | "idle" | "checking" | "downloading" | "ready" | "error";
  version?: string;
  percent?: number;
  message?: string;
};

export type CachierShell = {
  platform: "desktop";
  os: string;
  version: string;
  capabilities: string[];
  printers?: {
    list(): Promise<Ok<{ printers: ShellPrinter[] }>>;
    printRaw(printer: string, bytes: Uint8Array): Promise<Ok<object>>;
  };
  updates?: {
    status(): Promise<UpdateStatus>;
    onStatus(callback: (status: UpdateStatus) => void): () => void;
    restartToUpdate(): Promise<{ ok: boolean; error?: string }>;
  };
};

declare global {
  interface Window {
    cachierShell?: CachierShell;
  }
}

export function getCachierShell(): CachierShell | null {
  if (typeof window === "undefined") return null;
  return window.cachierShell ?? null;
}

export function shellCanPrint(shell: CachierShell | null): shell is CachierShell & { printers: NonNullable<CachierShell["printers"]> } {
  return !!shell?.printers && shell.capabilities.includes("printers.spooler");
}

/** Prints through the Windows print queue via the desktop app. */
export class ShellTransport implements PrinterTransport {
  readonly label: string;
  constructor(
    private readonly shell: CachierShell & { printers: NonNullable<CachierShell["printers"]> },
    private readonly printerName: string
  ) {
    this.label = printerName;
  }

  async send(bytes: Uint8Array): Promise<void> {
    const result = await this.shell.printers.printRaw(this.printerName, bytes);
    // the message is English prose from the desktop app; lib/devices/errors.ts translates it for display
    if (!result.ok) throw new Error(result.error);
  }

  async close(): Promise<void> {
    // nothing to release: every print is its own spooler job
  }
}

/** The installed printers, or an Error carrying the desktop app's reason. */
export async function listShellPrinters(shell: CachierShell): Promise<ShellPrinter[]> {
  if (!shellCanPrint(shell)) throw new Error("this app cannot list printers");
  const result = await shell.printers.list();
  if (!result.ok) throw new Error(result.error);
  return result.printers;
}

/** Which way to reach the receipt printer configured for this till. */
export function chooseTransportKind(config: { shellPrinter?: string } | null, shell: CachierShell | null): "shell" | "usb" | "none" {
  if (!config) return "none";
  // A queue-based printer works only inside the desktop app; in a normal browser fall back to the print dialog.
  if (config.shellPrinter !== undefined) return shellCanPrint(shell) ? "shell" : "none";
  return "usb";
}

/** A short ESC/POS page for the Devices screen's "Test print". */
export function buildTestPage(): Uint8Array {
  const text = new TextEncoder().encode("Cachier POS\nPrinter test OK\n");
  return Uint8Array.from([...ESC_POS.init, ...ESC_POS.alignCenter, ...text, ...feed(4), ...ESC_POS.cut]);
}
