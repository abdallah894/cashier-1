import { readFileSync } from "node:fs";
import { deviceErrorKey } from "../lib/devices/errors";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

const cases: [string, string][] = [
  ["no printer available", "noPrinter"],
  ["the USB device exposes no interface", "noInterface"],
  ["the USB device has no bulk OUT endpoint", "noEndpoint"],
  ["USB transfer stall", "usbTransfer"],
  ["USB transfer babble", "usbTransfer"],
  ["WebUSB is not available in this browser (use Chrome or Edge over HTTPS)", "webUsbUnavailable"],
  ["No device selected.", "noDeviceSelected"],
  ["Failed to execute 'transferOut' on 'USBDevice': The device was disconnected.", "disconnected"],
  ["SecurityError: Access denied.", "accessDenied"],
  ["print failed", "printFailed"],
  ["drawer did not open", "drawerNotOpened"],
];
for (const [message, key] of cases) check(`"${message.slice(0, 40)}" → ${key}`, deviceErrorKey(message) === key, String(deviceErrorKey(message)));
check("an unknown message has no key (shown after a translated generic line)", deviceErrorKey("something odd") === null);

// every key the mapper can return must exist in BOTH languages
const keys = new Set(cases.map(([, k]) => k).concat("generic"));
for (const lang of ["en", "ar"]) {
  const messages = JSON.parse(readFileSync(`messages/${lang}.json`, "utf8")).deviceErrors as Record<string, string>;
  const missing = [...keys].filter((k) => !messages?.[k]);
  check(`messages/${lang}.json defines every device error`, missing.length === 0, missing.join(","));
}

if (failures > 0) process.exit(1);
console.log("Device error tests passed.");
