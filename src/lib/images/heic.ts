/**
 * HEIC/HEIF photos (iPhones) are converted to JPEG on the device before upload: the API has no HEIC decoder
 * and gets none (no native HEVC decoder in Java, patent and licence questions). Safari decodes HEIC through
 * `createImageBitmap`, Chrome and Firefox cannot; a photo the browser cannot decode is refused by name and
 * never sent as it is. Standalone: the upload dialog uses it today, the avatar dialog can too.
 */

/**
 * A larger photo is scaled down to fit before it is encoded: the canvas area iOS Safari before 18 (the one browser that
 * decodes HEIC here) allows, 4096 × 4096 (WebKit bugs 230855, 271002), below the API's 24 MP (`ImageEncoder.MAX_PIXELS`). Nothing is
 * lost: the API stores at most 1600 px on the long side (`ImageEncoder.MAX_SIDE`).
 */
export const MAX_JPEG_PIXELS = 4096 * 4096;
/** What may be chosen before conversion: HEIC is compact, but a 48 MP photo can pass the 12 MB the JPEG may have. */
export const MAX_HEIC_BYTES = 36_000_000;
/** JPEG qualities tried in turn until the result fits the byte limit. */
export const JPEG_QUALITIES = [0.9, 0.8, 0.7] as const;

const HEIC_TYPES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);
const HEIC_EXTENSION = /\.(heic|heif|hif)$/i;

/** HEIC/HEIF by type or by file extension (iOS gives files from the Files app or AirDrop an empty type). Case-insensitive. */
export function looksHeic(file: Pick<File, 'type' | 'name'>): boolean {
  return HEIC_TYPES.has(file.type.toLowerCase()) || HEIC_EXTENSION.test(file.name);
}

/** The API's answer to a photo it cannot decode (`errors.unsupportedImage`). */
const UNSUPPORTED = 'Unsupported image';

/**
 * The message a failed upload shows: for a HEIC-looking file the API's `Unsupported image` becomes the HEIC message
 * (`upload.reason.heic`: it got a HEIC the device did not convert, e.g. an older cached client), else `message` as it is.
 */
export function uploadFailureMessage(file: Pick<File, 'type' | 'name'>, message: string): string {
  return message === UNSUPPORTED && looksHeic(file) ? 'upload.reason.heic' : message;
}

/** The JPEG's name: the HEIC extension replaced, else `.jpg` appended. */
export function jpegName(name: string): string {
  return HEIC_EXTENSION.test(name) ? name.replace(HEIC_EXTENSION, '.jpg') : `${name}.jpg`;
}

/** The size to draw at: the decoded size, scaled down (never up) to at most `MAX_JPEG_PIXELS`. */
export function targetSize(width: number, height: number): { width: number; height: number } {
  if (width * height <= MAX_JPEG_PIXELS) return { width, height };
  const scale = Math.sqrt(MAX_JPEG_PIXELS / (width * height));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

/** A decoded photo, upright (EXIF orientation applied), and the way to release it. */
export interface Decoded {
  width: number;
  height: number;
  close: () => void;
}

/** The browser's part, replaceable in tests. */
export interface HeicBrowser {
  /** Rejects when the browser cannot decode the file. */
  decode: (file: File) => Promise<Decoded>;
  /** Draws the photo at `width` × `height` on white and encodes a JPEG; null when the browser cannot. */
  encode: (photo: Decoded, width: number, height: number, quality: number) => Promise<Blob | null>;
}

export type HeicResult = { ok: true; file: File } | { ok: false; reason: 'unsupported' | 'tooLarge' };

/**
 * Converts one HEIC/HEIF file to a JPEG `File` of at most `maxBytes`. Never throws; never answers with the
 * original file: `unsupported` when the browser cannot decode or encode it, `tooLarge` when even the lowest
 * quality is above `maxBytes`.
 */
export async function convertHeic(file: File, maxBytes: number, browser: HeicBrowser = browserHeic): Promise<HeicResult> {
  let photo: Decoded;
  try {
    photo = await browser.decode(file);
  } catch {
    return { ok: false, reason: 'unsupported' };
  }
  try {
    if (!(photo.width > 0 && photo.height > 0)) return { ok: false, reason: 'unsupported' };
    const { width, height } = targetSize(photo.width, photo.height);
    for (const quality of JPEG_QUALITIES) {
      const blob = await browser.encode(photo, width, height, quality);
      if (!blob || blob.size === 0) return { ok: false, reason: 'unsupported' };
      if (blob.size <= maxBytes) return { ok: true, file: new File([blob], jpegName(file.name), { type: 'image/jpeg', lastModified: file.lastModified }) };
    }
    return { ok: false, reason: 'tooLarge' };
  } catch {
    return { ok: false, reason: 'unsupported' };
  } finally {
    photo.close();
  }
}

interface BitmapPhoto extends Decoded {
  bitmap: ImageBitmap;
}

async function decode(file: File): Promise<BitmapPhoto> {
  if (typeof createImageBitmap !== 'function') throw new Error('createImageBitmap is missing');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (error) {
    // Older Safari takes only 'none' and 'flipY' (a TypeError) and applies the orientation by itself; anything else cannot decode.
    if (!(error instanceof TypeError)) throw error;
    bitmap = await createImageBitmap(file);
  }
  return { width: bitmap.width, height: bitmap.height, close: () => bitmap.close(), bitmap };
}

function encode(photo: Decoded & { bitmap?: ImageBitmap }, width: number, height: number, quality: number): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return Promise.resolve(null);
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  if (!photo.bitmap) return Promise.resolve(null);
  context.drawImage(photo.bitmap, 0, 0, width, height);
  return new Promise((done) =>
    canvas.toBlob(
      (blob) => {
        canvas.width = canvas.height = 0;
        done(blob && blob.type === 'image/jpeg' ? blob : null);
      },
      'image/jpeg',
      quality,
    ),
  );
}

/** The real browser: `createImageBitmap` onto a canvas. */
export const browserHeic: HeicBrowser = { decode, encode };
