/**
 * The square crop of a profile picture (31-2): the shared crop arithmetic of `lib/images/crop.ts` with the avatar's shape, a
 * square of zoom 1 (the whole short side) to `MAX_ZOOM` (a quarter of it), never under `MIN_WINDOW` source pixels.
 */
import * as crop from '../images/crop';
import type { Crop, CropShape, Pinch, Size } from '../images/crop';

export { MIN_ZOOM, MOVE_STEP, ZOOM_STEP, startCrop, type Crop, type Pinch, type Size } from '../images/crop';

export const MAX_ZOOM = 4;
/** The smallest window in source pixels (31-5): a small picture cannot be zoomed to a square of a few pixels. */
export const MIN_WINDOW = 64;
/** The largest side of the uploaded square (the server keeps at most 256 px and never enlarges, so this leaves room for its resampling). */
export const OUTPUT_MAX = 512;

export const AVATAR_SHAPE: CropShape = { aspect: 1, minWindow: MIN_WINDOW, maxZoom: MAX_ZOOM };

/** The square window in source pixels. */
export interface Square {
  x: number;
  y: number;
  side: number;
}

export const clampZoom = (zoom: number, max = MAX_ZOOM) => crop.clampZoom(zoom, max);
export const maxZoom = (size: Size) => crop.maxZoom(size, AVATAR_SHAPE);
/** The side of the window in source pixels at a zoom. */
export const windowSide = (size: Size, zoom: number) => crop.windowSize(size, zoom, AVATAR_SHAPE).width;
export const zoomTo = (start: Crop, size: Size, zoom: number) => crop.zoomTo(start, size, zoom, AVATAR_SHAPE);
export const pinchTo = (start: Crop, size: Size, from: Pinch, to: Pinch) => crop.pinchTo(start, size, from, to, AVATAR_SHAPE);
export const positionOf = (at: Crop, size: Size) => crop.positionOf(at, size, AVATAR_SHAPE);
export const dragBy = (at: Crop, size: Size, dx: number, dy: number, stage: number) => crop.dragBy(at, size, dx, dy, stage, AVATAR_SHAPE);
export const nudge = (at: Crop, size: Size, directionX: number, directionY: number) => crop.nudge(at, size, directionX, directionY, AVATAR_SHAPE);

/** The window as a square of the source. */
export function squareOf(at: Crop, size: Size): Square {
  const rect = crop.rectOf(at, size, AVATAR_SHAPE);
  return { x: rect.x, y: rect.y, side: rect.width };
}

/** The side of the uploaded square: the window's own pixels, never enlarged, at most OUTPUT_MAX, at least one. */
export function outputSide(square: Square): number {
  return crop.outputSize({ x: square.x, y: square.y, width: square.side, height: square.side }, OUTPUT_MAX).width;
}
