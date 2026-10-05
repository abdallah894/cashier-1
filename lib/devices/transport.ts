/**
 * Byte transport to a thermal printer. The print service only knows this
 * interface, so a WebUSB printer, a future network bridge or a test double
 * are interchangeable.
 */
export interface PrinterTransport {
  /** human-readable name for logs and the UI */
  readonly label: string;
  send(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

/** USB device class 0x07 = printer. */
const USB_PRINTER_CLASS = 0x07;

type UsbLike = {
  getDevices(): Promise<UsbDeviceLike[]>;
  requestDevice(options: { filters: { classCode?: number; vendorId?: number; productId?: number }[] }): Promise<UsbDeviceLike>;
};
type UsbDeviceLike = {
  vendorId: number;
  productId: number;
  productName?: string;
  opened: boolean;
  configuration: { interfaces: { interfaceNumber: number; alternates: { interfaceClass: number; endpoints: { endpointNumber: number; direction: string; type: string }[] }[] }[] } | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(value: number): Promise<void>;
  claimInterface(n: number): Promise<void>;
  releaseInterface(n: number): Promise<void>;
  transferOut(endpoint: number, data: BufferSource): Promise<{ status: string }>;
};

function usb(): UsbLike | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as unknown as { usb?: UsbLike }).usb ?? null;
}

export function webUsbSupported(): boolean {
  return usb() !== null;
}

/** ESC/POS printer over WebUSB (Chromium browsers; HTTPS or localhost; the user grants access once). */
export class WebUsbTransport implements PrinterTransport {
  readonly label: string;
  constructor(private readonly device: UsbDeviceLike) {
    this.label = device.productName ?? `USB ${device.vendorId.toString(16)}:${device.productId.toString(16)}`;
  }

  async send(bytes: Uint8Array): Promise<void> {
    const device = this.device;
    if (!device.opened) await device.open();
    if (!device.configuration) await device.selectConfiguration(1);
    const iface = device.configuration?.interfaces.find((i) => i.alternates.some((a) => a.interfaceClass === USB_PRINTER_CLASS)) ?? device.configuration?.interfaces[0];
    if (!iface) throw new Error("the USB device exposes no interface");
    const endpoint = iface.alternates.flatMap((a) => a.endpoints).find((e) => e.direction === "out" && e.type === "bulk");
    if (!endpoint) throw new Error("the USB device has no bulk OUT endpoint");
    await device.claimInterface(iface.interfaceNumber);
    try {
      // large bitmaps are sent in chunks the printer buffer can swallow
      const chunk = 4096;
      for (let offset = 0; offset < bytes.length; offset += chunk) {
        const result = await device.transferOut(endpoint.endpointNumber, bytes.slice(offset, offset + chunk));
        if (result.status !== "ok") throw new Error(`USB transfer ${result.status}`);
      }
    } finally {
      await device.releaseInterface(iface.interfaceNumber).catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    if (this.device.opened) await this.device.close();
  }
}

export type UsbPrinterMatch = { vendorId?: number; productId?: number };

/** A printer this browser was already granted access to (no prompt), optionally matching ids saved in the device settings. */
export async function findPairedUsbPrinter(match: UsbPrinterMatch = {}): Promise<WebUsbTransport | null> {
  const api = usb();
  if (!api) return null;
  const devices = await api.getDevices();
  const found = devices.find(
    (d) => (match.vendorId === undefined || d.vendorId === match.vendorId) && (match.productId === undefined || d.productId === match.productId)
  );
  return found ? new WebUsbTransport(found) : null;
}

/** Shows the browser's USB picker; must be called from a user gesture. Returns the ids to save in the device settings. */
export async function pairUsbPrinter(): Promise<{ transport: WebUsbTransport; vendorId: number; productId: number }> {
  const api = usb();
  if (!api) throw new Error("WebUSB is not available in this browser (use Chrome or Edge over HTTPS)");
  const device = await api.requestDevice({ filters: [{ classCode: USB_PRINTER_CLASS }] });
  return { transport: new WebUsbTransport(device), vendorId: device.vendorId, productId: device.productId };
}
