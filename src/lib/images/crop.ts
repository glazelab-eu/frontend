/**
 * The crop of a picture as pure arithmetic, shared by the profile picture (a square, sent as its window) and a photo's focus
 * (the card's 3:2 frame at zoom 1, stored as a position only, `photo-focus.ts`): the dialogs draw what these functions decide. The crop is the window of the picture the stage shows: its centre in
 * source pixels and a zoom (1 shows the largest window of the shape's aspect that fits, `maxZoom` a quarter of its sides). The
 * window never leaves the picture, so the output is always a full window of picture pixels with no empty corner.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Crop {
  /** 1 shows the largest window that fits; larger zooms in. */
  zoom: number;
  /** The window's centre in source pixels. */
  x: number;
  y: number;
}

/** The window in source pixels. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What a dialog crops to: the window's width over its height, its smallest short side in source pixels, the largest zoom. */
export interface CropShape {
  aspect: number;
  minWindow: number;
  maxZoom: number;
}

export const MIN_ZOOM = 1;
/** What the + and - keys change the zoom by. */
export const ZOOM_STEP = 0.25;
/** What an arrow key moves the picture by, as a fraction of the visible window. */
export const MOVE_STEP = 0.05;

const finite = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback);

/** The zoom within its limits; anything that is not a number counts as 1. */
export function clampZoom(zoom: number, max: number): number {
  return Math.min(max, Math.max(MIN_ZOOM, finite(zoom, MIN_ZOOM)));
}

/** The window at zoom 1: the largest one of the shape's aspect inside the picture, centred on the same axis it fills. */
function fullWindow(size: Size, shape: CropShape): Size {
  return size.width / size.height >= shape.aspect
    ? { width: size.height * shape.aspect, height: size.height }
    : { width: size.width, height: size.width / shape.aspect };
}

/** The largest zoom of a picture: the shape's, or less where the window's short side would fall below `minWindow` (never below 1). */
export function maxZoom(size: Size, shape: CropShape): number {
  const full = fullWindow(size, shape);
  return Math.max(MIN_ZOOM, Math.min(shape.maxZoom, Math.min(full.width, full.height) / shape.minWindow));
}

/** The window's size in source pixels at a zoom. */
export function windowSize(size: Size, zoom: number, shape: CropShape): Size {
  const full = fullWindow(size, shape);
  const scale = clampZoom(zoom, maxZoom(size, shape));
  return { width: full.width / scale, height: full.height / scale };
}

/** A centre kept so the whole window lies inside the picture. */
function keepInside(size: Size, window: Size, x: number, y: number): { x: number; y: number } {
  const within = (centre: number, length: number, side: number) => Math.min(length - side / 2, Math.max(side / 2, finite(centre, length / 2)));
  return { x: within(x, size.width, window.width), y: within(y, size.height, window.height) };
}

/** The crop a new file starts with: the largest centred window. */
export function startCrop(size: Size): Crop {
  return { zoom: MIN_ZOOM, x: size.width / 2, y: size.height / 2 };
}

/** The same window centre at another zoom (from the slider, the keys or a pinch), moved inward where the larger window would stick out. */
export function zoomTo(crop: Crop, size: Size, zoom: number, shape: CropShape): Crop {
  const next = clampZoom(zoom, maxZoom(size, shape));
  return { zoom: next, ...keepInside(size, windowSize(size, next, shape), crop.x, crop.y) };
}

/** Two fingers on the stage: their distance and the midpoint as a fraction of the stage from its centre (-0.5 to 0.5 across and down). */
export interface Pinch {
  distance: number;
  u: number;
  v: number;
}

/**
 * A pinch from `from` to `to`: the zoom at the start scaled by how much the distance changed, about the fingers' midpoint. The
 * point of the picture under the midpoint at the start stays under the midpoint as it moves, so the fingers also pan (a start
 * without distance changes nothing).
 */
export function pinchTo(start: Crop, size: Size, from: Pinch, to: Pinch, shape: CropShape): Crop {
  if (!(from.distance > 0) || !(to.distance >= 0)) return start;
  const before = windowSize(size, start.zoom, shape);
  const anchorX = start.x + finite(from.u, 0) * before.width;
  const anchorY = start.y + finite(from.v, 0) * before.height;
  const zoom = clampZoom(start.zoom * (to.distance / from.distance), maxZoom(size, shape));
  const after = windowSize(size, zoom, shape);
  return { zoom, ...keepInside(size, after, anchorX - finite(to.u, 0) * after.width, anchorY - finite(to.v, 0) * after.height) };
}

/** Where the window sits as a share (0 to 100) of the way it can travel across and down; an axis that cannot move counts as 50. */
export function positionOf(crop: Crop, size: Size, shape: CropShape): { x: number; y: number } {
  const window = windowSize(size, crop.zoom, shape);
  const share = (centre: number, length: number, side: number) => {
    const travel = length - side;
    return travel > 1e-9 ? Math.round(Math.min(1, Math.max(0, (centre - side / 2) / travel)) * 100) : 50;
  };
  return { x: share(crop.x, size.width, window.width), y: share(crop.y, size.height, window.height) };
}

/**
 * The picture follows a drag of (dx, dy) pixels on a stage `stage` pixels wide (of the shape's aspect): the window moves the other
 * way, by the drag scaled to source pixels. A window that cannot move further stays at the edge.
 */
export function dragBy(crop: Crop, size: Size, dx: number, dy: number, stage: number, shape: CropShape): Crop {
  if (!(stage > 0)) return crop;
  const window = windowSize(size, crop.zoom, shape);
  const scale = window.width / stage;
  return { zoom: crop.zoom, ...keepInside(size, window, crop.x - finite(dx, 0) * scale, crop.y - finite(dy, 0) * scale) };
}

/** An arrow key: the picture moves one step in that direction (`-1`, `0` or `1` along each axis), `MOVE_STEP` of the window's own side. */
export function nudge(crop: Crop, size: Size, directionX: number, directionY: number, shape: CropShape): Crop {
  const window = windowSize(size, crop.zoom, shape);
  return {
    zoom: crop.zoom,
    ...keepInside(size, window, crop.x - directionX * MOVE_STEP * window.width, crop.y - directionY * MOVE_STEP * window.height),
  };
}

/** The window as a rectangle of the source. */
export function rectOf(crop: Crop, size: Size, shape: CropShape): Rect {
  const window = windowSize(size, crop.zoom, shape);
  const { x, y } = keepInside(size, window, crop.x, crop.y);
  return { x: x - window.width / 2, y: y - window.height / 2, width: window.width, height: window.height };
}

/** The pixels of the encoded window: its own, never enlarged, the long side at most `maxSide`, the aspect kept, at least one. */
export function outputSize(rect: Rect, maxSide: number): Size {
  const width = finite(rect.width, 1);
  const height = finite(rect.height, 1);
  const scale = Math.min(1, maxSide / Math.max(width, height, 1e-9));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}
