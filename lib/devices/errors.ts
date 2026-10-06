/**
 * Maps the plain English errors thrown by the printer / drawer transports to
 * i18n keys under "deviceErrors", so an Arabic cashier never reads a raw
 * "USB transfer stall". The English text is still what gets logged and sent to
 * the device audit; only what is DISPLAYED is translated.
 */
const RULES: [RegExp, string][] = [
  [/^no printer available$/i, "noPrinter"],
  // reasons reported by the desktop app's print bridge (desktop/print-bridge.cjs)
  [/^printer not installed$/i, "printerNotInstalled"],
  [/print queue refused/i, "queueRefused"],
  [/^print timed out$/i, "printTimeout"],
  [/print service is not available/i, "printServiceMissing"],
  [/^not allowed$/i, "bridgeNotAllowed"],
  [/cannot list printers/i, "needDesktopApp"],
  [/exposes no interface/i, "noInterface"],
  [/no bulk OUT endpoint/i, "noEndpoint"],
  [/^USB transfer /i, "usbTransfer"],
  [/WebUSB is not available/i, "webUsbUnavailable"],
  [/No device selected/i, "noDeviceSelected"],
  [/disconnected|not connected|device was lost/i, "disconnected"],
  [/access denied|SecurityError|NotAllowedError/i, "accessDenied"],
  [/^print failed$/i, "printFailed"],
  [/^drawer did not open$/i, "drawerNotOpened"],
];

/** The i18n key (inside "deviceErrors") for a known device error, or null when unknown. */
export function deviceErrorKey(message: string): string | null {
  for (const [pattern, key] of RULES) if (pattern.test(message)) return key;
  return null;
}
