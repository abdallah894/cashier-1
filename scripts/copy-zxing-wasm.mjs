// Serves the barcode decoder (ZXing C++ compiled to WebAssembly) from our own
// origin instead of a CDN: it keeps working offline and under a strict CSP,
// and always matches the installed zxing-wasm version. Runs before dev/build.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const source = require.resolve("zxing-wasm/reader/zxing_reader.wasm");
const targetDir = path.join(process.cwd(), "public", "zxing");
mkdirSync(targetDir, { recursive: true });
copyFileSync(source, path.join(targetDir, "zxing_reader.wasm"));
console.log("copied zxing_reader.wasm to public/zxing/");
