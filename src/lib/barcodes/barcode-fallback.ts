/**
 * The ZXing (WebAssembly) fallback for browsers without a native BarcodeDetector, such as Safari and
 * Firefox. Imported lazily by scanner.ts, so neither this chunk nor the wasm file is in the main
 * bundle or the PWA precache; the service worker caches them at runtime after the first use.
 */
import { BarcodeDetector, prepareZXingModule, type BarcodeFormat } from 'barcode-detector/ponyfill';
// Served from this app's own origin instead of the library's default CDN.
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import type { Detector } from './scanner';

/** Loads the wasm module (so a failed download fails here, not silently on every frame). */
export async function createDetector(formats: string[]): Promise<Detector> {
  await prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
    },
    fireImmediately: true,
  });
  return new BarcodeDetector({ formats: formats as BarcodeFormat[] });
}
