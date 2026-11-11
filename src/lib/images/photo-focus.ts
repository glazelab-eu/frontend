/**
 * A photo's focus point: where the cards' covers (`object-fit: cover`) place their crop, stored as `focusX`/`focusY` in percent
 * (0 to 100, both or neither; none is the centre). The photo itself stays whole. The value is CSS `object-position` itself: the
 * point at X% and Y% of the photo sits at X% and Y% of every cover, so it is visible whatever the cover's aspect. The focus
 * dialog shows the whole photo with a 3:2 frame: what a card's cover shows of it at that focus.
 */
import type { ImageInfo } from '../api/models';
import { MOVE_STEP, positionOf, rectOf, windowSize, type Crop, type CropShape, type Rect, type Size } from './crop';

export interface Focus {
  x: number;
  y: number;
}

/**
 * The frame's width over its height. A card's cover (`PictureCover`) is 15rem high and as wide as the card: about 3:2 on a 390 px
 * phone and in the three-column desktop grid (wider in the two-column grid, narrower on a 320 px phone; the focus point stays
 * inside it).
 */
export const PHOTO_FOCUS_ASPECT = 3 / 2;
/** The frame is the largest 3:2 window inside the photo; it moves but never zooms. */
export const PHOTO_FOCUS: CropShape = { aspect: PHOTO_FOCUS_ASPECT, minWindow: 1, maxZoom: 1 };

const percent = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : null);

/** A stored focus as a point, or null for none (both coordinates are needed; an old snapshot has neither). */
export function focusOf(image: Partial<Pick<ImageInfo, 'focusX' | 'focusY'>>): Focus | null {
  const x = percent(image.focusX);
  const y = percent(image.focusY);
  return x === null || y === null ? null : { x, y };
}

/** The `object-position` of a cover: the focus, the centre without one. */
export function coverPosition(image: Partial<Pick<ImageInfo, 'focusX' | 'focusY'>>): string {
  const focus = focusOf(image);
  return focus ? `${focus.x}% ${focus.y}%` : '50% 50%';
}

/** The frame (a crop at zoom 1 of `PHOTO_FOCUS`) that shows what a cover at `focus` shows; the centre without one. */
export function frameAt(size: Size, focus: Focus | null): Crop {
  const window = windowSize(size, 1, PHOTO_FOCUS);
  const at = (share: number, length: number, side: number) => side / 2 + (share / 100) * Math.max(0, length - side);
  const point = focus ?? { x: 50, y: 50 };
  return { zoom: 1, x: at(point.x, size.width, window.width), y: at(point.y, size.height, window.height) };
}

/** The focus a frame stands for: how far it travelled across and down, 0 to 100 (an axis it fills counts as 50). */
export function frameFocus(frame: Crop, size: Size): Focus {
  return positionOf(frame, size, PHOTO_FOCUS);
}

/** The frame moved by (dx, dy) source pixels, kept inside the photo. */
export function moveFrame(frame: Crop, size: Size, dx: number, dy: number): Crop {
  const rect = rectOf({ zoom: 1, x: frame.x + (Number.isFinite(dx) ? dx : 0), y: frame.y + (Number.isFinite(dy) ? dy : 0) }, size, PHOTO_FOCUS);
  return { zoom: 1, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** An arrow key: the frame moves one step that way (`-1`, `0` or `1` along each axis), `MOVE_STEP` of its own side. */
export function stepFrame(frame: Crop, size: Size, directionX: number, directionY: number): Crop {
  const window = windowSize(size, 1, PHOTO_FOCUS);
  return moveFrame(frame, size, directionX * MOVE_STEP * window.width, directionY * MOVE_STEP * window.height);
}

/** Where the whole photo is drawn on a stage of `stage` pixels: as large as fits, centred (`contain`). */
export function fitRect(size: Size, stage: Size): Rect {
  if (!(size.width > 0 && size.height > 0 && stage.width > 0 && stage.height > 0)) return { x: 0, y: 0, width: 0, height: 0 };
  const scale = Math.min(stage.width / size.width, stage.height / size.height);
  const width = size.width * scale;
  const height = size.height * scale;
  return { x: (stage.width - width) / 2, y: (stage.height - height) / 2, width, height };
}
