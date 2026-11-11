import { outputSize, rectOf, type Crop, type Rect, type Size } from './crop';
import { PHOTO_FOCUS, fitRect, frameFocus } from './photo-focus';

/** What a crop is encoded as: the server decodes and re-encodes it, so this only has to be small and sharp. */
export const OUTPUT_TYPE = 'image/jpeg';
const OUTPUT_QUALITY = 0.92;

/** The canvas pixels across a crop stage: its width on the screen times the device pixel ratio, within sane limits (a stage not yet measured gets a default). */
export function stagePixels(cssSize: number, pixelRatio: number): number {
  if (!(cssSize > 0)) return 360;
  const ratio = pixelRatio >= 1 ? pixelRatio : 1;
  return Math.min(1024, Math.max(64, Math.round(cssSize * ratio)));
}

/** Paints a window of the picture over the whole canvas, on white (a transparent picture would turn black as a JPEG). */
export function paintRect(canvas: HTMLCanvasElement, image: CanvasImageSource, rect: Rect): void {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No canvas');
  context.imageSmoothingQuality = 'high';
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
}

/** The chosen window as the file to send: its own pixels, the long side at most `maxSide`, never enlarged. */
export function renderRect(image: CanvasImageSource, rect: Rect, maxSide: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  const size = outputSize(rect, maxSide);
  canvas.width = size.width;
  canvas.height = size.height;
  paintRect(canvas, image, rect);
  return new Promise((done, fail) =>
    canvas.toBlob(
      (blob) => {
        canvas.width = canvas.height = 0;
        if (blob) done(blob);
        else fail(new Error('No picture'));
      },
      OUTPUT_TYPE,
      OUTPUT_QUALITY,
    ),
  );
}

/**
 * The focus stage: the whole photo as large as it fits (`fitRect`; the stage's tint shows around it), the parts outside the 3:2
 * frame dimmed, the frame outlined and its focus point marked. Canvas pixels are not CSS, so the colours are spelled here.
 */
export function paintFocus(canvas: HTMLCanvasElement, image: CanvasImageSource, size: Size, frame: Crop): void {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No canvas');
  context.clearRect(0, 0, canvas.width, canvas.height);
  const fit = fitRect(size, { width: canvas.width, height: canvas.height });
  if (!fit.width) return;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, fit.x, fit.y, fit.width, fit.height);
  const scale = fit.width / size.width;
  const window = rectOf(frame, size, PHOTO_FOCUS);
  const box = { x: fit.x + window.x * scale, y: fit.y + window.y * scale, width: window.width * scale, height: window.height * scale };
  context.fillStyle = 'rgba(0, 0, 0, 0.55)';
  context.fillRect(fit.x, fit.y, fit.width, box.y - fit.y);
  context.fillRect(fit.x, box.y + box.height, fit.width, fit.y + fit.height - box.y - box.height);
  context.fillRect(fit.x, box.y, box.x - fit.x, box.height);
  context.fillRect(box.x + box.width, box.y, fit.x + fit.width - box.x - box.width, box.height);
  const line = Math.max(2, Math.round(canvas.width / 240));
  const focus = frameFocus(frame, size);
  const point = { x: fit.x + (focus.x / 100) * fit.width, y: fit.y + (focus.y / 100) * fit.height };
  const arm = line * 6;
  // A dark band under the light one keeps frame and mark visible on a pale and on a dark photo.
  for (const [colour, width] of [
    ['rgba(0, 0, 0, 0.7)', line * 2.5],
    ['#fff', line],
  ] as const) {
    context.strokeStyle = colour;
    context.lineWidth = width;
    context.strokeRect(box.x + line / 2, box.y + line / 2, box.width - line, box.height - line);
    context.beginPath();
    context.moveTo(point.x - arm, point.y);
    context.lineTo(point.x + arm, point.y);
    context.moveTo(point.x, point.y - arm);
    context.lineTo(point.x, point.y + arm);
    context.stroke();
  }
}
