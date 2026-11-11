/** Test helper: decodes a QR matrix back to text with ZXing, the scanner library the app ships. Not imported by the app. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { QUIET_ZONE, type QrMatrix } from './qr';

let ready: Promise<unknown> | null = null;
const wasm = () => readFileSync(createRequire(import.meta.url).resolve('zxing-wasm/reader/zxing_reader.wasm'));

/** The matrix as grey pixels: `scale` pixels per module, `quiet` modules of light margin. */
export function renderGray(matrix: QrMatrix, scale = 6, quiet = QUIET_ZONE): ImageData {
  const modules = matrix.size + 2 * quiet;
  const width = modules * scale;
  const data = new Uint8ClampedArray(width * width * 4);
  for (let py = 0; py < width; py++) {
    for (let px = 0; px < width; px++) {
      const x = Math.floor(px / scale) - quiet;
      const y = Math.floor(py / scale) - quiet;
      const inside = x >= 0 && y >= 0 && x < matrix.size && y < matrix.size;
      const dark = inside && matrix.modules[y * matrix.size + x] === 1;
      const value = dark ? 0 : 255;
      data.set([value, value, value, 255], (py * width + px) * 4);
    }
  }
  return { data, width, height: width, colorSpace: 'srgb' } as ImageData;
}

/** Texts ZXing reads from an image, QR codes only. */
export async function decodeImage(image: ImageData): Promise<string[]> {
  ready ??= prepareZXingModule({ overrides: { wasmBinary: wasm() as unknown as ArrayBuffer }, fireImmediately: true });
  await ready;
  const results = await readBarcodes(image, { formats: ['QRCode'], tryHarder: true });
  return results.filter((result) => result.isValid).map((result) => result.text);
}

export const decodeMatrix = (matrix: QrMatrix, scale?: number) => decodeImage(renderGray(matrix, scale));
