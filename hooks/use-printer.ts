"use client";

import { useEffect, useMemo, useState } from "react";
import { chooseTransportKind, getCachierShell, shellCanPrint, ShellTransport } from "@/lib/devices/shell";
import { findPairedUsbPrinter, type PrinterTransport } from "@/lib/devices/transport";

export type PrinterConfig = {
  deviceId: string;
  vendorId?: number;
  productId?: number;
  columns?: number;
  /** Name of a Windows print queue (desktop app only); takes the place of the USB ids. */
  shellPrinter?: string;
};

/**
 * The thermal printer configured for this till, if this browser has been
 * granted access to it (WebUSB permission is per browser, granted once on
 * the Devices page). null = fall back to the browser print dialog.
 */
export function usePrinterTransport(config: PrinterConfig | null): PrinterTransport | null {
  const [usbTransport, setTransport] = useState<PrinterTransport | null>(null);
  const vendorId = config?.vendorId;
  const productId = config?.productId;
  const shellPrinter = config?.shellPrinter;
  // Queue printers are reached through the desktop app's bridge: nothing to look up asynchronously.
  const kind = chooseTransportKind(config, getCachierShell());
  const shellTransport = useMemo(() => {
    const shell = getCachierShell();
    return kind === "shell" && shellPrinter !== undefined && shellCanPrint(shell) ? new ShellTransport(shell, shellPrinter) : null;
  }, [kind, shellPrinter]);
  const enabled = kind === "usb";

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void findPairedUsbPrinter({ vendorId, productId })
      .then((found) => !cancelled && setTransport(found))
      .catch(() => !cancelled && setTransport(null));
    return () => {
      cancelled = true;
    };
  }, [enabled, vendorId, productId]);

  if (kind === "shell") return shellTransport;
  return enabled ? usbTransport : null;
}
