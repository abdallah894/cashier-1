import { createScanDetector } from "../lib/barcode/scan-detector";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures++;
}

/** Feeds a string as keystrokes `gapMs` apart, then Enter; returns every scan emitted. */
function type(detector: ReturnType<typeof createScanDetector>, text: string, gapMs: number, start = 1000) {
  const scans: string[] = [];
  const consumed: boolean[] = [];
  let now = start;
  for (const key of text) {
    const r = detector.handleKey({ key, now });
    if (r.scan) scans.push(r.scan);
    consumed.push(r.consume);
    now += gapMs;
  }
  const enter = detector.handleKey({ key: "Enter", now });
  if (enter.scan) scans.push(enter.scan);
  return { scans, enterConsumed: enter.consume, consumed };
}

const EAN13 = "6221031234567";

{
  const d = createScanDetector();
  const r = type(d, EAN13, 5);
  check("a fast burst ending in Enter is a scan", r.scans.length === 1 && r.scans[0] === EAN13);
  check("the closing Enter is consumed so no form submits", r.enterConsumed);
  check("the digits themselves are not consumed", r.consumed.every((c) => !c));
}
{
  const d = createScanDetector();
  const r = type(d, EAN13, 200);
  check("human-speed typing is never a scan", r.scans.length === 0 && !r.enterConsumed);
}
{
  const d = createScanDetector();
  const r = type(d, "12", 5);
  check("a burst shorter than the minimum is not a scan", r.scans.length === 0);
  check("code 128 style short codes pass at the default minimum of 4", type(createScanDetector(), "AB12", 5).scans[0] === "AB12");
  check("the minimum length is configurable", type(createScanDetector({ minLength: 8 }), "1234567", 5).scans.length === 0 && type(createScanDetector({ minLength: 8 }), "12345678", 5).scans.length === 1);
}
{
  // a person types two characters, then the scanner fires: only the burst counts
  const d = createScanDetector();
  d.handleKey({ key: "a", now: 1000 });
  d.handleKey({ key: "b", now: 1400 });
  const r = type(d, EAN13, 5, 2000);
  check("typing before a scan does not pollute it", r.scans[0] === EAN13);
}
{
  const d = createScanDetector();
  type(d, EAN13, 5, 1000);
  const second = type(d, "5449000000996", 5, 3000);
  check("consecutive scans are independent", second.scans[0] === "5449000000996");
}
{
  const d = createScanDetector();
  const r = type(d, EAN13, 5);
  check("Enter alone after a scan does not repeat it", d.handleKey({ key: "Enter", now: 5000 }).scan === undefined && r.scans.length === 1);
}
{
  const d = createScanDetector();
  let now = 1000;
  for (const key of "1234") d.handleKey({ key, now: (now += 5) });
  check("shortcuts (Ctrl/Meta/Alt) never join a scan", d.handleKey({ key: "v", ctrlKey: true, now: (now += 5) }).consume === false);
  const r = d.handleKey({ key: "Enter", now: (now += 5) });
  check("a shortcut in the middle of a burst is ignored, not appended", r.scan === "1234");
}
{
  const d = createScanDetector();
  let now = 1000;
  for (const key of "12") d.handleKey({ key, now: (now += 5) });
  d.handleKey({ key: "ArrowDown", now: (now += 5) });
  d.handleKey({ key: "Shift", now: (now += 5) });
  for (const key of "34") d.handleKey({ key, now: (now += 5) });
  check("non-printing keys do not break a burst", d.handleKey({ key: "Enter", now: (now += 5) }).scan === "1234");
}
{
  const d = createScanDetector();
  let now = 1000;
  for (const key of EAN13) d.handleKey({ key, now: (now += 5) });
  // the operator pauses after a scan burst, then presses Enter manually
  check("a slow Enter after a burst is a manual Enter, not a scan", d.handleKey({ key: "Enter", now: now + 500 }).scan === undefined);
}
{
  const d = createScanDetector();
  let now = 1000;
  for (const key of "1234") d.handleKey({ key, now: (now += 5) });
  d.reset();
  check("reset discards a half-received burst", d.handleKey({ key: "Enter", now: now + 5 }).scan === undefined);
}

if (failures > 0) process.exit(1);
console.log("Barcode input detection passes.");
