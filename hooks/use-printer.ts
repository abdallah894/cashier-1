"use client";

import { useEffect, useState } from "react";
import { findPairedUsbPrinter, type PrinterTransport } from "@/lib/devices/transport";

export type PrinterConfig = { deviceId: string; vendorId?: number; productId?: number; columns?: number };

/**
 * The thermal printer configured for this till, if this browser has been
 * granted access to it (WebUSB permission is per browser, granted once on
 * the Devices page). null = fall back to the browser print dialog.
 */
export function usePrinterTransport(config: PrinterConfig | null): PrinterTransport | null {
  const [transport, setTransport] = useState<PrinterTransport | null>(null);
  const vendorId = config?.vendorId;
  const productId = config?.productId;
  const enabled = config !== null;

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

  return enabled ? transport : null;
}
