/** Client-only: decode a barcode from a live camera frame or canvas. */

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

// Decoding the full frame hurts real-world accuracy: background clutter
// competes with the barcode, and a barcode held at a normal distance only
// occupies a small fraction of a 1920x1080 frame, so its bars end up too
// few pixels wide for the binarizer. Cropping to a center band (matching
// the on-screen aiming guide) both speeds up decode and raises the hit
// rate, since the barcode fills much more of the analyzed image.
const SCAN_REGION = { widthRatio: 0.85, heightRatio: 0.35 };

function captureVideoFrame(video: HTMLVideoElement): HTMLCanvasElement | null {
  if (video.videoWidth === 0 || video.videoHeight === 0) return null;

  const fullWidth = video.videoWidth;
  const fullHeight = video.videoHeight;
  const cropWidth = Math.round(fullWidth * SCAN_REGION.widthRatio);
  const cropHeight = Math.round(fullHeight * SCAN_REGION.heightRatio);
  const sx = Math.round((fullWidth - cropWidth) / 2);
  const sy = Math.round((fullHeight - cropHeight) / 2);

  const canvas = document.createElement("canvas");
  canvas.width = cropWidth;
  canvas.height = cropHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, sx, sy, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  return canvas;
}

function createInvertedCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  const inverted = document.createElement("canvas");
  inverted.width = canvas.width;
  inverted.height = canvas.height;

  const ctx = inverted.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(canvas, 0, 0);
  const imageData = ctx.getImageData(0, 0, inverted.width, inverted.height);
  const { data } = imageData;

  for (let index = 0; index < data.length; index += 4) {
    data[index] = 255 - data[index];
    data[index + 1] = 255 - data[index + 1];
    data[index + 2] = 255 - data[index + 2];
  }

  ctx.putImageData(imageData, 0, 0);
  return inverted;
}

async function tryNativeDetector(canvas: HTMLCanvasElement): Promise<string | null> {
  const ctor = (globalThis as typeof globalThis & { BarcodeDetector?: BarcodeDetectorCtor })
    .BarcodeDetector;
  if (!ctor) return null;

  try {
    const detector = new ctor({ formats: [...NATIVE_FORMATS] });
    const results = await detector.detect(canvas);
    return results[0]?.rawValue?.trim() ?? null;
  } catch {
    // BarcodeDetector can exist but support zero formats (desktop Chrome on
    // Windows/Linux) — detect() then rejects. Fall through to ZXing.
    return null;
  }
}

async function tryZxing(canvas: HTMLCanvasElement): Promise<string | null> {
  // Reuse the ZXing build shipped with html5-qrcode — no extra dependency.
  const ZXing = await import("html5-qrcode/third_party/zxing-js.umd.js");

  const hints = new Map<unknown, unknown>();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
    ZXing.BarcodeFormat.EAN_13,
    ZXing.BarcodeFormat.EAN_8,
    ZXing.BarcodeFormat.UPC_A,
    ZXing.BarcodeFormat.UPC_E,
    ZXing.BarcodeFormat.CODE_128,
    ZXing.BarcodeFormat.CODE_39,
    ZXing.BarcodeFormat.QR_CODE,
  ]);
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);

  const reader = new ZXing.MultiFormatReader(false, hints);
  try {
    const source = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
    const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(source));
    const result = reader.decode(bitmap);
    return result.text?.trim() ?? null;
  } catch {
    try {
      const invertedCanvas = createInvertedCanvas(canvas);
      if (!invertedCanvas) return null;

      const source = new ZXing.HTMLCanvasElementLuminanceSource(invertedCanvas);
      const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(source));
      const result = reader.decode(bitmap);
      return result.text?.trim() ?? null;
    } catch {
      return null;
    }
  }
}

export async function decodeBarcodeFromCanvas(
  canvas: HTMLCanvasElement
): Promise<string | null> {
  const native = await tryNativeDetector(canvas);
  if (native) return native;
  return tryZxing(canvas);
}

export async function decodeBarcodeFromVideo(
  video: HTMLVideoElement
): Promise<string | null> {
  const canvas = captureVideoFrame(video);
  if (!canvas) return null;
  return decodeBarcodeFromCanvas(canvas);
}
