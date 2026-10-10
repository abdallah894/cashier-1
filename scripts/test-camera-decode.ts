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
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { deflateSync } from "node:zlib";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import { createReadConfirmer } from "../lib/barcode/decode-frame";
import { READER_OPTIONS } from "../lib/barcode/wasm-decoder";

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

/** Minimal greyscale PNG, so the C++ engine can be fed a real image file in Node. */
function png(pixels: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 0; // greyscale
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(pixels.subarray(y * width, (y + 1) * width)).copy(raw, y * (width + 1) + 1);
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

async function decodeWasm(code: string, module: number): Promise<string | null> {
  const { pixels, width, height } = barcodeImage(code, module);
  const results = await readBarcodes(png(pixels, width, height), READER_OPTIONS);
  return results.find((r) => r.isValid)?.text ?? null;
}

async function wasmChecks() {
  // the same engine and options the camera uses (the browser loads /zxing/zxing_reader.wasm)
  const require = createRequire(import.meta.url);
  await prepareZXingModule({ overrides: { wasmBinary: readFileSync(require.resolve("zxing-wasm/reader/zxing_reader.wasm")).buffer as ArrayBuffer }, fireImmediately: true });
  check("the C++ engine reads an Egyptian EAN-13", (await decodeWasm("6223007653602", 3)) === "6223007653602");
  check("the C++ engine reads it at 2 pixels per bar", (await decodeWasm("6223007653602", 2)) === "6223007653602");
  check("the C++ engine refuses a bad check digit", (await decodeWasm("6221000000017", 3)) === null);
}

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

wasmChecks()
  .catch((error) => check("the C++ engine loads", false, String(error)))
  .then(() => {
    if (failures > 0) {
      console.error(`\n${failures} check(s) failing`);
      process.exit(1);
    }
    console.log("\nCamera decode tests passed.");
  });
