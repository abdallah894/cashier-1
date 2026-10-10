/**
 * Client-only: the ZXing C++ engine compiled to WebAssembly (zxing-wasm).
 * It reads blurred, small, tilted and low-contrast retail barcodes far more
 * often than the JavaScript port, which stays as the fallback in
 * decode-frame.ts when WebAssembly cannot load.
 *
 * The .wasm file is served from our own origin (/zxing/zxing_reader.wasm,
 * copied from node_modules by scripts/copy-zxing-wasm.mjs before dev/build),
 * so scanning keeps working offline and under the Content-Security-Policy.
 */
import { prepareZXingModule, readBarcodes, type ReaderOptions } from "zxing-wasm/reader";

export const WASM_URL = "/zxing/zxing_reader.wasm";

export const READER_OPTIONS: ReaderOptions = {
  formats: ["EAN13", "EAN8", "UPCA", "UPCE", "Code128", "Code39", "QRCode"],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  maxNumberOfSymbols: 1,
};

let loading: Promise<boolean> | null = null;

/** Loads the engine once; false when WebAssembly is unavailable (old browser, blocked, offline before first load). */
export function loadWasmDecoder(): Promise<boolean> {
  loading ??= (async () => {
    try {
      await prepareZXingModule({
        overrides: {
          locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? WASM_URL : prefix + path),
        },
        fireImmediately: true,
      });
      return true;
    } catch {
      return false;
    }
  })();
  return loading;
}

/** First valid code in the image, or null. */
export async function decodeImageData(image: ImageData): Promise<string | null> {
  const results = await readBarcodes(image, READER_OPTIONS);
  const hit = results.find((result) => result.isValid && result.text.trim());
  return hit ? hit.text.trim() : null;
}
