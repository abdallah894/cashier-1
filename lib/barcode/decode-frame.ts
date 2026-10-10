/** Client-only: decode a barcode from a live camera frame or canvas. */
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  GlobalHistogramBinarizer,
  HTMLCanvasElementLuminanceSource,
  HybridBinarizer,
  InvertedLuminanceSource,
  MultiFormatReader,
} from "@zxing/library";
import { decodeImageData, loadWasmDecoder } from "./wasm-decoder";

const NATIVE_FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39",
  "qr_code",
] as const;

type BarcodeDetectorCtor = new (options: { formats: string[] }) => {
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue: string }>>;
};

type Strategy = {
  /** part of the frame, centred */
  widthRatio: number;
  heightRatio: number;
  /** resize before decoding: <1 shrinks blur along with the bars (soft-focus webcams) */
  scale: number;
  binarizer: "hybrid" | "global";
  inverted?: boolean;
  /** stretch contrast and sharpen bar edges first (out-of-focus laptop webcams) */
  sharpen?: boolean;
  /** ZXing's slow mode: more scan lines and a 90° turn, for tilted or sideways barcodes */
  thorough?: boolean;
};

/**
 * One cheap decode per camera frame, cycling through these. Trying them all on
 * every frame took seconds on a laptop and froze the scanner; at ~5 frames a
 * second the whole list is covered in about two seconds of holding still.
 * The centre band (matching the on-screen aiming guide) comes first and most
 * often: a barcode at a normal distance fills only a small part of the frame,
 * and background clutter competes with it.
 */
export const STRATEGIES: readonly Strategy[] = [
  { widthRatio: 0.85, heightRatio: 0.35, scale: 1, binarizer: "hybrid" },
  { widthRatio: 0.85, heightRatio: 0.35, scale: 0.5, binarizer: "global", sharpen: true },
  { widthRatio: 0.85, heightRatio: 0.35, scale: 1, binarizer: "global", sharpen: true },
  { widthRatio: 1, heightRatio: 0.7, scale: 0.5, binarizer: "hybrid", thorough: true },
  { widthRatio: 0.85, heightRatio: 0.35, scale: 0.5, binarizer: "hybrid" },
  { widthRatio: 0.85, heightRatio: 0.35, scale: 0.35, binarizer: "global", sharpen: true },
  { widthRatio: 1, heightRatio: 1, scale: 0.5, binarizer: "global", sharpen: true },
  { widthRatio: 0.85, heightRatio: 0.35, scale: 1, binarizer: "hybrid", inverted: true },
];

/** ZXing works line by line; past this width more pixels only cost time. */
const MAX_DECODE_WIDTH = 1280;

const readers = new Map<boolean, MultiFormatReader>();

function getReader(thorough: boolean): MultiFormatReader {
  const existing = readers.get(thorough);
  if (existing) return existing;
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.QR_CODE,
  ]);
  if (thorough) hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new MultiFormatReader();
  reader.setHints(hints);
  readers.set(thorough, reader);
  return reader;
}

/**
 * Grey, stretch the contrast to the full range, then sharpen with a 3x3
 * kernel: soft edges from a fixed-focus webcam get steep again, which is what
 * the binarizer needs to tell thin bars from thin gaps.
 */
function sharpen(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const grey = new Float32Array(width * height);
  let min = 255;
  let max = 0;
  for (let i = 0, p = 0; p < grey.length; i += 4, p++) {
    const value = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    grey[p] = value;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const range = Math.max(1, max - min);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const at = (dx: number, dy: number) =>
        grey[Math.min(height - 1, Math.max(0, y + dy)) * width + Math.min(width - 1, Math.max(0, x + dx))];
      const sharp = 5 * grey[p] - at(-1, 0) - at(1, 0) - at(0, -1) - at(0, 1);
      const value = Math.max(0, Math.min(255, ((sharp - min) * 255) / range));
      const i = p * 4;
      data[i] = data[i + 1] = data[i + 2] = value;
    }
  }
  ctx.putImageData(image, 0, 0);
}

function renderRegion(source: CanvasImageSource, width: number, height: number, strategy: Strategy) {
  const cropWidth = Math.round(width * strategy.widthRatio);
  const cropHeight = Math.round(height * strategy.heightRatio);
  const scale = Math.min(strategy.scale, MAX_DECODE_WIDTH / cropWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(cropWidth * scale));
  canvas.height = Math.max(1, Math.round(cropHeight * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, Math.round((width - cropWidth) / 2), Math.round((height - cropHeight) / 2), cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
  if (strategy.sharpen) sharpen(ctx, canvas.width, canvas.height);
  return canvas;
}

/** One ZXing attempt; null when nothing (or nothing valid) was found. */
export function decodeWithStrategy(source: CanvasImageSource, width: number, height: number, strategy: Strategy): string | null {
  if (width <= 0 || height <= 0) return null;
  const canvas = renderRegion(source, width, height, strategy);
  if (!canvas) return null;
  try {
    const luminance = new HTMLCanvasElementLuminanceSource(canvas);
    const input = strategy.inverted ? new InvertedLuminanceSource(luminance) : luminance;
    const bitmap = new BinaryBitmap(strategy.binarizer === "hybrid" ? new HybridBinarizer(input) : new GlobalHistogramBinarizer(input));
    return getReader(Boolean(strategy.thorough)).decodeWithState(bitmap).getText().trim() || null;
  } catch {
    return null; // NotFound / checksum / format errors
  }
}

async function tryNativeDetector(source: ImageBitmapSource): Promise<string | null> {
  const ctor = (globalThis as typeof globalThis & { BarcodeDetector?: BarcodeDetectorCtor })
    .BarcodeDetector;
  if (!ctor) return null;

  try {
    const detector = new ctor({ formats: [...NATIVE_FORMATS] });
    const results = await detector.detect(source);
    return results[0]?.rawValue?.trim() || null;
  } catch {
    // BarcodeDetector can exist but support zero formats (desktop Chrome on
    // Windows/Linux) — detect() then rejects. Fall through to ZXing.
    return null;
  }
}

/**
 * What the C++ engine (zxing-wasm) looks at, alternating per frame: the whole
 * frame (it finds and straightens the barcode itself), then the centre band
 * enlarged 2x so a barcode that is small in the picture gets wider bars.
 */
const WASM_VIEWS: readonly Strategy[] = [
  { widthRatio: 1, heightRatio: 1, scale: 1, binarizer: "hybrid" },
  { widthRatio: 0.85, heightRatio: 0.35, scale: 2, binarizer: "hybrid" },
];

function imageDataFor(source: CanvasImageSource, width: number, height: number, view: Strategy): ImageData | null {
  const cropWidth = Math.round(width * view.widthRatio);
  const cropHeight = Math.round(height * view.heightRatio);
  // the engine is fast, but cap the work on 1080p cameras
  const scale = Math.min(view.scale, 1600 / cropWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(cropWidth * scale));
  canvas.height = Math.max(1, Math.round(cropHeight * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, Math.round((width - cropWidth) / 2), Math.round((height - cropHeight) / 2), cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

async function decodeWithWasm(source: CanvasImageSource, width: number, height: number, view: Strategy): Promise<string | null> {
  const image = imageDataFor(source, width, height, view);
  if (!image) return null;
  try {
    return await decodeImageData(image);
  } catch {
    return null;
  }
}

/**
 * One frame: the platform detector when there is one (Android, macOS,
 * ChromeOS — fast, whole frame), then the C++ engine on one view picked by
 * `attempt`. Browsers that cannot run WebAssembly use the JavaScript decoder
 * with one strategy per frame instead.
 */
export async function decodeBarcodeFromVideo(video: HTMLVideoElement, attempt = 0): Promise<string | null> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (width <= 0 || height <= 0) return null;
  const native = await tryNativeDetector(video);
  if (native) return native;
  if (await loadWasmDecoder()) return decodeWithWasm(video, width, height, WASM_VIEWS[attempt % WASM_VIEWS.length]);
  return decodeWithStrategy(video, width, height, STRATEGIES[attempt % STRATEGIES.length]);
}

/** A still image (no next frame to wait for): try everything. */
export async function decodeBarcodeFromCanvas(canvas: HTMLCanvasElement): Promise<string | null> {
  const native = await tryNativeDetector(canvas);
  if (native) return native;
  if (await loadWasmDecoder()) {
    for (const view of WASM_VIEWS) {
      const text = await decodeWithWasm(canvas, canvas.width, canvas.height, view);
      if (text) return text;
    }
  }
  for (const strategy of STRATEGIES) {
    const text = decodeWithStrategy(canvas, canvas.width, canvas.height, strategy);
    if (text) return text;
  }
  return null;
}

/**
 * Accept a camera read only when two frames agree: a blurred frame can
 * occasionally decode to a different code that still passes the check digit,
 * and adding the wrong product is worse than waiting one more frame.
 */
export function createReadConfirmer(needed = 2, windowMs = 2000) {
  let last: string | null = null;
  let count = 0;
  let firstAt = 0;
  return (value: string | null, now = Date.now()): string | null => {
    if (!value) return null;
    if (value === last && now - firstAt <= windowMs) count += 1;
    else {
      last = value;
      count = 1;
      firstAt = now;
    }
    return count >= needed ? value : null;
  };
}
