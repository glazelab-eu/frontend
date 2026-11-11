import base from 'virtual:label-ocr-assets';
import { readLabelText } from './worker';

import { PhotoError, photoSize, validatePhoto } from './photo';

/** Photos and raw OCR text live only in this invocation; nothing is uploaded or persisted. */
export async function readPhoto(file: File, signal: AbortSignal) {
  validatePhoto(file);
  signal.throwIfAborted();
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  let abort: () => void = () => {};
  const timeout = setTimeout(() => {
    image.onerror?.(new Event('error'));
  }, 15_000);
  try {
    await new Promise<void>((resolve, reject) => {
      abort = () => {
        image.src = '';
        reject(signal.reason);
      };
      image.onload = () => resolve();
      image.onerror = () => reject(new PhotoError('image'));
      signal.addEventListener('abort', abort, { once: true });
      image.src = url;
    });
    clearTimeout(timeout);
    signal.throwIfAborted();
    const size = photoSize(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new PhotoError('image');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(image, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    canvas.width = canvas.height = 0;
    if (!blob) throw new PhotoError('image');
    signal.throwIfAborted();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return await readLabelText(bytes, new URL(base, location.href).href, signal);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
    image.onload = image.onerror = null;
    image.src = '';
    URL.revokeObjectURL(url);
  }
}
