# POS hardware: supported devices, setup and verification

This document is the **declared hardware support** for Cachier (roadmap item
10). It is deliberately honest about what has been tested, because a
cashier system at a busy counter must not depend on guesses.

> **Verification status.** Everything below is verified at the software level
> (unit and database tests run with `npm run test:all`). **No physical device
> model has been tested by the developers.** The "Verified on site" column is
> the owner's to fill in after running the checklist in section 5.

## 1. Compatibility matrix

Profiles are rows in `device_profiles` (the Devices screen only lets staff add
profiles marked *supported*).

### Barcode scanners

| Profile | Interface | Status | Verified on site |
| --- | --- | --- | --- |
| `usb_hid_keyboard` | USB, **keyboard-wedge (HID)** mode, suffix = Enter | Supported | _model: ____ date: ____ |
| `camera_browser` | device camera (EAN-13, EAN-8, Code 128, QR via html5-qrcode) | Supported | _model: ____ date: ____ |
| `bluetooth_hid` | Bluetooth scanner in HID mode | Not supported (expected to behave as a wedge; unverified) | n/a |

Requirements for a wedge scanner: programmed to send **Enter** after the code
(most default to this), no prefix, fast key rate (< 50 ms between characters,
which is what the burst detector in `lib/barcode/scan-detector.ts` assumes).
Serial/COM scanners and scanners that need a vendor driver are not supported.

### Receipt printers

| Profile | Interface | Status | Verified on site |
| --- | --- | --- | --- |
| `browser_print_80mm` | any printer via the browser print dialog / PDF | Supported (fallback, always available) | _printer: ____ |
| `escpos_spooler_80mm` | ESC/POS thermal (USB or any installed driver), 80 mm, through the **Windows print queue** in the **desktop app** | Supported (**recommended on Windows**) | _model: ____ date: ____ |
| `escpos_usb_80mm` | ESC/POS thermal, **USB**, 80 mm, driven from the browser with **WebUSB** (needs the driver swapped to WinUSB) | Supported | _model: ____ date: ____ |
| `escpos_network_80mm` | ESC/POS over TCP/IP | Not supported (the desktop app's bridge could carry it; not built) | n/a |

**On Windows, prefer the desktop app and the print-queue profile** ([desktop-printing.md](desktop-printing.md)): it uses the printer's normal driver, so the Zadig/WinUSB driver swap described below is not needed. The WebUSB path remains for Chrome/Edge without the desktop app.

Requirements for the USB path: a printer that speaks **ESC/POS** and exposes a
USB **printer class (0x07)** interface with a bulk OUT endpoint; a
Chromium-based browser (Chrome/Edge) on **HTTPS or localhost** (WebUSB is not
available in Firefox/Safari); the printer must not be claimed by an OS driver
that blocks WebUSB (on Windows, replace the driver with WinUSB via Zadig if
the browser cannot open the device). 58 mm paper works by setting the profile
column count to 32.

Languages: English receipts print in ESC/POS **text mode**. **Arabic** receipts
print as a **bitmap** (the browser draws the text, so shaping and RTL are
correct, and the printer needs no Arabic code page). Bitmap printing is slower
and uses more paper length than text.

### Cash drawers

| Profile | Interface | Status | Verified on site |
| --- | --- | --- | --- |
| `printer_kick` | drawer cable (RJ11/RJ12) plugged into the receipt printer's drawer port; ESC p pulse | Supported | _model: ____ date: ____ |
| `usb_direct` | drawer driven over its own USB link | Not supported | n/a |

Drawer pulse: `ESC p 0 25 250` (pin 2, 50 ms on, 500 ms off). Most 12 V / 24 V
drawers work; match the voltage to the printer's drawer port.

## 2. How printing works

1. Every print is a **print job** recorded server-side (`request_print`) with
   the document, who asked, the till and a copy number. The server decides
   whether a job is an original, a reprint (reason required, audited) or a
   gift receipt.
2. The browser builds the bytes (`lib/receipts/escpos.ts`) and sends them to
   the paired printer, or opens the browser print dialog if no printer is
   paired. The result is reported back (`complete_print_job`).
3. A **failed print is a failed job**: it stays visible (receipt page banner
   and Devices > Recent print jobs) and **Retry** creates a new job for the same
   copy. Printing never creates, edits or duplicates a sale.
4. After the first successful print, further prints are **Reprints**: they need
   a reason, are marked `COPY n` on paper and emit an audit event.
5. **Gift receipts** list items and quantities only (no prices, tax, total or
   payment) and never count as an original or a reprint.
6. Customer-facing text never includes the cashier's name or internal ids.

## 3. How the cash drawer works

The drawer only opens through `authorize_drawer_open`, which requires an
**approved event** and records the till, shift, actor and result:

| Reason | Allowed when |
| --- | --- |
| `cash_sale` | the sale is yours, was paid (partly) in cash, and is less than 10 minutes old; once per sale |
| `cash_refund` | the return is yours, refunds cash, and is less than 10 minutes old |
| `cash_drawer_event` | your paid-in / paid-out / safe-drop was just recorded |
| `no_sale` | you give a reason **and** hold the *cash drawer* permission **or** a manager PIN approves this exact opening |

Card sales never open the drawer. A failed pulse is recorded as failed and may
be authorised again. **Limit:** the pulse is sent from the browser, so this is
an audit and UI gate, not a physical interlock; a person with the printer
cable and browser dev tools could still send a pulse. Pair it with a keyed
drawer lock and shift-close counts (already in place).

## 4. Receipt delivery (email / SMS)

Not built. It needs an email/SMS provider and a consent decision from the
owner. `lib/receipts/delivery.ts` defines the privacy rules (masked recipients
in logs, no staff or internal data in the body) and answers "unsupported"
rather than pretending to send. Use **PDF download** or **print** meanwhile.

## 5. On-site verification checklist

Run once per till after installing hardware and record the result in the
matrix above.

1. **Scanner**: open Register, scan 10 different products; each must add one
   unit with no stray characters and no search box residue. Type slowly in the
   search box and confirm nothing is added by typing alone.
2. **Printer pairing**: Devices > add *ESC/POS thermal over USB* > **Pair USB
   printer** > choose the printer > **Check** shows *OK*.
3. **Receipt print**: complete a cash sale. The receipt prints once. Repeat in
   Arabic and confirm text direction and digits.
4. **Failure path**: unplug the printer and print. A *failed* banner and job
   appear; plug it back and **Retry**; confirm only one receipt prints and no
   second sale exists.
5. **Reprint**: press **Reprint**, give a reason; the copy is marked `COPY 2`
   and appears in Devices > Recent print jobs and in the Audit log.
6. **Gift receipt**: confirm no prices appear.
7. **Drawer**: a cash sale opens the drawer; a card sale does not; a manual
   opening without permission asks for a manager PIN.
8. **Offline**: disconnect the network and confirm the provisional receipt
   prints with `PROVISIONAL`.

## 6. Tests

`npm run test:all` includes: `test-devices.ts` (tills, device profiles, print
job and drawer authorisation rules, RLS, immutability),
`test-barcode-input.ts` (burst detection, shortcuts, slow typing),
`test-escpos.ts` (byte output, width, drawer pulse, raster packing, gift
receipt and customer-text privacy), and `test-print-service.ts` (printer and
drawer failure, retry without duplication, fallback).
