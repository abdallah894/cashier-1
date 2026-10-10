/**
 * Camera barcode reading. Run with: npx tsx scripts/test-camera-decode.ts
 *
 * The camera used to read nothing on laptops: the ZXing copy bundled inside
 * html5-qrcode could not decode a perfect EAN-13. These checks decode with the
 * same library and settings the camera uses (@zxing/library), so a broken
 * decoder fails here instead of at the till, and they cover the "two frames
 * must agree" guard against misreads.
 */
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from "@zxing/library";
import { createReadConfirmer } from "../lib/barcode/decode-frame";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failures++;
}

const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const R = L.map((c) => [...c].map((b) => (b === "0" ? "1" : "0")).join(""));
const G = R.map((c) => [...c].reverse().join(""));
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

function ean13Bits(code: string): string {
  const d = [...code].map(Number);
  let bits = "101";
  for (let i = 1; i <= 6; i++) bits += (PARITY[d[0]][i - 1] === "L" ? L : G)[d[i]];
  bits += "01010";
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  return bits + "101";
}

/** A grey image of the barcode with quiet zones, `module` pixels per bar unit. */
function barcodeImage(code: string, module: number, height = 60) {
  const bits = "0".repeat(10) + ean13Bits(code) + "0".repeat(10);
  const width = bits.length * module;
  const pixels = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) pixels[y * width + x] = bits[Math.floor(x / module)] === "1" ? 20 : 235;
  }
  return { pixels, width, height };
}

function decode(code: string, module: number): string | null {
  const { pixels, width, height } = barcodeImage(code, module);
  const reader = new MultiFormatReader();
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.CODE_128]);
  reader.setHints(hints);
  try {
    // RGBLuminanceSource takes 8-bit luminance directly
    const source = new RGBLuminanceSource(pixels, width, height);
    return reader.decodeWithState(new BinaryBitmap(new HybridBinarizer(source))).getText();
  } catch {
    return null;
  }
}

check("the camera's decoder reads an Egyptian EAN-13", decode("6223007653602", 3) === "6223007653602");
check("it reads it at 2 pixels per bar", decode("6223007653602", 2) === "6223007653602");
check("it reads another product code", decode("6221000000010", 3) === "6221000000010");
check("an invalid check digit is refused, not misread", decode("6221000000017", 3) === null);

// two agreeing frames before a read counts
{
  const confirm = createReadConfirmer();
  check("one frame is not enough", confirm("6223007653602", 0) === null);
  check("a second agreeing frame confirms", confirm("6223007653602", 200) === "6223007653602");
}
{
  const confirm = createReadConfirmer();
  confirm("274807653602", 0); // a blurred misread
  check("a different code restarts the count", confirm("6223007653602", 200) === null);
  check("…and needs its own second frame", confirm("6223007653602", 400) === "6223007653602");
}
{
  const confirm = createReadConfirmer();
  confirm("6223007653602", 0);
  check("empty frames do not reset a pending read", confirm(null, 200) === null && confirm("6223007653602", 400) === "6223007653602");
}
{
  const confirm = createReadConfirmer();
  confirm("6223007653602", 0);
  check("an old read does not combine with a new one", confirm("6223007653602", 5000) === null);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failing`);
  process.exit(1);
}
console.log("\nCamera decode tests passed.");
