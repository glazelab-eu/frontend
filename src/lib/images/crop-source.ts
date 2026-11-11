/**
 * What the crop dialogs (profile picture, photo focus) accept of a chosen picture beyond its bytes: the pixel count, read from
 * the file's header before the browser decodes it (a decoded picture takes 4 bytes per pixel: 100 megapixels are 400 MB and can
 * end a phone's tab), and a smallest side below which a crop would be only a few pixels. `openCropSource` decodes the file.
 */
import type { Size } from './crop';
import { convertHeic, looksHeic, targetSize, type HeicResult } from './heic';

/** The most pixels a source may have (50 MP: about 200 MB decoded); larger pictures are refused without being decoded. */
export const MAX_CROP_SOURCE_PIXELS = 50_000_000;
/** The shortest side a source may have; the crop window never gets smaller than this either (`MIN_WINDOW`). */
export const MIN_CROP_SOURCE_SIDE = 64;
/** How much of the file is read for its header: PNG, GIF and WebP state their size in the first bytes, a JPEG after its metadata segments. */
export const HEADER_BYTES = 1_048_576;

export type SourceProblem = 'tooManyPixels' | 'tooSmall';

/** Why a picture of this size cannot be used, or null. A size that is not usable (no pixels) is for the decoder to report. */
export function sourceProblem(size: Size): SourceProblem | null {
  if (!(size.width > 0 && size.height > 0)) return null;
  if (size.width * size.height > MAX_CROP_SOURCE_PIXELS) return 'tooManyPixels';
  if (Math.min(size.width, size.height) < MIN_CROP_SOURCE_SIDE) return 'tooSmall';
  return null;
}

/**
 * The file a crop dialog reads and decodes: a HEIC/HEIF photo is converted to a JPEG on the device first (`lib/images/heic.ts`, 24-17:
 * Safari decodes it, Chrome and Firefox cannot, and the API never gets it), anything else is the file itself. The converted JPEG is
 * at most `maxBytes` and at most 24 megapixels, and then goes through the same header and size checks as any other picture.
 * `heic` is the answer for a HEIC the browser cannot convert (the dialog names it; nothing is sent).
 */
export async function readableSource(
  file: File,
  maxBytes: number,
  convert: (file: File, maxBytes: number) => Promise<HeicResult> = convertHeic,
): Promise<{ file: File } | { problem: 'heic' }> {
  if (!looksHeic(file)) return { file };
  const converted = await convert(file, maxBytes);
  return converted.ok ? { file: converted.file } : { problem: 'heic' };
}

const ascii = (bytes: Uint8Array, at: number, text: string) => [...text].every((letter, index) => bytes[at + index] === letter.charCodeAt(0));
const be16 = (bytes: Uint8Array, at: number) => (bytes[at] << 8) | bytes[at + 1];
const le16 = (bytes: Uint8Array, at: number) => bytes[at] | (bytes[at + 1] << 8);
const be32 = (bytes: Uint8Array, at: number) => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
const le24 = (bytes: Uint8Array, at: number) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);

function pngSize(bytes: Uint8Array): Size | null {
  return bytes.length >= 24 && ascii(bytes, 12, 'IHDR') ? { width: be32(bytes, 16), height: be32(bytes, 20) } : null;
}

function gifSize(bytes: Uint8Array): Size | null {
  return bytes.length >= 10 ? { width: le16(bytes, 6), height: le16(bytes, 8) } : null;
}

/** The first start-of-frame segment of a JPEG (every marker C0 to CF except the table, JPG and arithmetic markers C4, C8 and CC). */
function jpegSize(bytes: Uint8Array): Size | null {
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return at + 9 <= bytes.length ? { width: be16(bytes, at + 7), height: be16(bytes, at + 5) } : null;
    }
    at += 2 + be16(bytes, at + 2);
  }
  return null;
}

function webpSize(bytes: Uint8Array): Size | null {
  if (bytes.length >= 30 && ascii(bytes, 12, 'VP8X')) return { width: le24(bytes, 24) + 1, height: le24(bytes, 27) + 1 };
  if (bytes.length >= 25 && ascii(bytes, 12, 'VP8L') && bytes[20] === 0x2f) {
    const bits = (bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)) >>> 0;
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (bytes.length >= 30 && ascii(bytes, 12, 'VP8 ') && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: le16(bytes, 26) & 0x3fff, height: le16(bytes, 28) & 0x3fff };
  }
  return null;
}

/**
 * The pixel size a PNG, JPEG, GIF or WebP states in the first bytes of its file, or null for any other format or a header that is
 * cut off (the dialog then checks the size after decoding). It trusts the header: a lying header can only make the dialog refuse
 * a picture that would decode, or let one through that the decoder then fails to open.
 */
export function readImageSize(bytes: Uint8Array): Size | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 'PNG')) return pngSize(bytes);
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpegSize(bytes);
  if (ascii(bytes, 0, 'GIF8')) return gifSize(bytes);
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return webpSize(bytes);
  return null;
}

/** Why a crop dialog cannot use a file. */
export type CropSourceProblem = 'unreadable' | 'heic' | SourceProblem;

/**
 * Decodes a chosen file for a crop dialog: HEIC converted first (`readableSource`), the header checked before anything is decoded,
 * then one `ImageBitmap`, upright by its EXIF orientation. A bitmap above `MAX_JPEG_PIXELS` (older iOS Safari's canvas area) is
 * drawn down to that size once and the large one released, so the dialog holds one bitmap of at most 4096 × 4096 px. The caller
 * owns the bitmap and closes it; `alive` false (the dialog went) closes it here and answers `null`.
 */
export async function openCropSource(
  file: File,
  maxBytes: number,
  alive: () => boolean,
): Promise<{ bitmap: ImageBitmap } | { problem: CropSourceProblem } | null> {
  try {
    const opened = await readableSource(file, maxBytes);
    if ('problem' in opened) return opened;
    const source = opened.file;
    const header = readImageSize(new Uint8Array(await source.slice(0, HEADER_BYTES).arrayBuffer()));
    const early = header && sourceProblem(header);
    if (early) return { problem: early };
    if (!alive()) return null;
    let bitmap = await createImageBitmap(source);
    const found = bitmap.width && bitmap.height ? sourceProblem(bitmap) : 'unreadable';
    if (!found) bitmap = await reduced(bitmap);
    if (!alive() || found) {
      bitmap.close();
      return found ? { problem: found } : null;
    }
    return { bitmap };
  } catch {
    return { problem: 'unreadable' };
  }
}

/** The bitmap itself when it fits `MAX_JPEG_PIXELS`, else a copy drawn down to that size (the large one is closed). */
async function reduced(bitmap: ImageBitmap): Promise<ImageBitmap> {
  const fit = targetSize(bitmap.width, bitmap.height);
  if (fit.width === bitmap.width && fit.height === bitmap.height) return bitmap;
  const canvas = document.createElement('canvas');
  canvas.width = fit.width;
  canvas.height = fit.height;
  try {
    const context = canvas.getContext('2d');
    if (!context) return bitmap;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, fit.width, fit.height);
    const smaller = await createImageBitmap(canvas);
    bitmap.close();
    return smaller;
  } finally {
    canvas.width = canvas.height = 0;
  }
}
