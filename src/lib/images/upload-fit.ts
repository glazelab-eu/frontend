/**
 * Photos above the API's pixel limit are scaled down on the device before upload, the way HEIC photos are converted
 * (`lib/images/heic.ts`): the API refuses more than `ImageEncoder.MAX_PIXELS` with `Image dimensions are too large`,
 * while a 48 MP or 50 MP phone camera's JPEG often stays under the byte limit. Nothing is lost: the API keeps at most
 * 1600 px on the long side (`ImageEncoder.MAX_SIDE`).
 */
import type { Size } from './crop';
import { HEADER_BYTES, readImageSize } from './crop-source';
import { browserHeic, toJpeg, type HeicBrowser, type HeicResult } from './heic';

/** The most pixels the API decodes (`ImageEncoder.MAX_PIXELS`). */
export const MAX_UPLOAD_PIXELS = 24_000_000;

/** The size the file's header states, or null (another format, a cut-off header or an unreadable file). */
export async function headerSize(file: Blob): Promise<Size | null> {
  try {
    return readImageSize(new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer()));
  } catch {
    return null;
  }
}

/**
 * The file to send: the file itself when its header states at most `MAX_UPLOAD_PIXELS` (or states nothing: the API
 * decides), else a JPEG of at most `maxBytes` drawn at most 4096 × 4096 px (`toJpeg`). Never throws; a photo the
 * browser cannot scale is refused here, since the API would refuse it as it is.
 */
export async function fitForUpload(
  file: File,
  maxBytes: number,
  browser: HeicBrowser = browserHeic,
  readSize: (file: File) => Promise<Size | null> = headerSize,
): Promise<HeicResult> {
  const size = await readSize(file);
  if (!size || size.width * size.height <= MAX_UPLOAD_PIXELS) return { ok: true, file };
  return toJpeg(file, maxBytes, browser);
}

/** The message a photo that could not be scaled shows at its row. */
export const fitFailureMessage = (reason: 'unsupported' | 'tooLarge') => (reason === 'tooLarge' ? 'errors.imageTooBig' : 'errors.imageDimensions');
