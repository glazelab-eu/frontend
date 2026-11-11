import { encodeQr, QUIET_ZONE, type QrMatrix } from './qr';

/** The saved picture is about this many pixels wide (a whole number of pixels per module, so the edges stay sharp). */
export const TARGET_PIXELS = 1024;

/** Pixels per module and the picture's side in pixels (quiet zone included) for a code of `size` modules. */
export function qrPixelSize(size: number, target: number = TARGET_PIXELS): { scale: number; side: number } {
  const modules = size + 2 * QUIET_ZONE;
  const scale = Math.max(1, Math.round(target / modules));
  return { scale, side: scale * modules };
}

/** Paints the code black on white with its quiet zone, `scale` pixels per module, onto a canvas context of `side` pixels. */
export function paintQr(context: Pick<CanvasRenderingContext2D, 'fillStyle' | 'fillRect'>, matrix: QrMatrix, scale: number, side: number): void {
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, side, side);
  context.fillStyle = '#000000';
  for (let y = 0; y < matrix.size; y++) {
    for (let x = 0; x < matrix.size; x++) {
      if (!matrix.modules[y * matrix.size + x]) continue;
      let end = x;
      while (end + 1 < matrix.size && matrix.modules[y * matrix.size + end + 1]) end++;
      context.fillRect((x + QUIET_ZONE) * scale, (y + QUIET_ZONE) * scale, (end - x + 1) * scale, scale);
      x = end;
    }
  }
}

/** The code of a link as a PNG (in memory only). */
export async function qrPng(link: string): Promise<Blob> {
  const matrix = encodeQr(link);
  const { scale, side } = qrPixelSize(matrix.size);
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No canvas');
  paintQr(context, matrix, scale, side);
  return await new Promise<Blob>((done, fail) => canvas.toBlob((blob) => (blob ? done(blob) : fail(new Error('No picture'))), 'image/png'));
}

export type SaveOutcome = 'shared' | 'downloaded' | 'cancelled';

/** How long the download's object URL lives: desktop WebKit aborts a download whose URL is revoked right after the click. */
export const REVOKE_AFTER_MS = 30_000;

/**
 * Gives the user the picture: through the share sheet with the file where the device is a phone-like one that can share
 * files, else as a download through a temporary object URL (revoked after `REVOKE_AFTER_MS`). Nothing is stored or requested.
 */
export async function saveQr(
  png: Blob,
  fileName: string,
  env: { navigator: Navigator; document: Document; url: typeof URL; coarse: boolean },
): Promise<SaveOutcome> {
  const file = new File([png], fileName, { type: 'image/png' });
  const nav = env.navigator;
  if (env.coarse && typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file] });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      // Any other refusal falls back to the download.
    }
  }
  const href = env.url.createObjectURL(png);
  try {
    const anchor = env.document.createElement('a');
    anchor.href = href;
    anchor.download = fileName;
    env.document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    setTimeout(() => env.url.revokeObjectURL(href), REVOKE_AFTER_MS);
  }
  return 'downloaded';
}
