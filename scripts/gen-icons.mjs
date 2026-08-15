// Generates placeholder PWA icons (public/icon-192.png, icon-512.png,
// apple-touch-icon.png, maskable-512.png) — a dark brand square with a
// white circular mark. Run: node scripts/gen-icons.mjs
// Swap for a designed logo before launch; these are groundwork placeholders.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const BG = [24, 24, 27]; // zinc-900, close to the app's --primary
const FG = [250, 250, 250]; // near-white

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function png(size, { mark = "circle" } = {}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.26;
  // RGBA raw with a filter byte (0) at the start of each scanline
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const inMark =
        mark === "circle" && (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
      const [rr, gg, bb] = inMark ? FG : BG;
      const p = rowStart + 1 + x * 4;
      raw[p] = rr;
      raw[p + 1] = gg;
      raw[p + 2] = bb;
      raw[p + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const out = join(process.cwd(), "public");
const files = [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["maskable-512.png", 512],
  ["apple-touch-icon.png", 180],
];
for (const [name, size] of files) {
  writeFileSync(join(out, name), png(size));
  console.log("wrote public/" + name);
}
