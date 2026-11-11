/** Pure rules of the full-screen photo viewer (`images/PhotoViewer`); the gallery stage keeps clamping, the viewer wraps. */

/** The position `delta` steps from `current` in a list of `total` photos, wrapping around (previous of the first is the last). */
export function stepIndex(current: number, total: number, delta: number): number {
  if (total <= 0) return 0;
  return (((current + delta) % total) + total) % total;
}

/**
 * The position a key shows, or null for a key the viewer does not use. Arrows wrap, Home and End jump to the first and
 * last photo. One photo has nowhere to go.
 */
export function viewerKeyTarget(key: string, current: number, total: number): number | null {
  if (total < 2) return null;
  if (key === 'ArrowLeft') return stepIndex(current, total, -1);
  if (key === 'ArrowRight') return stepIndex(current, total, 1);
  if (key === 'Home') return 0;
  if (key === 'End') return total - 1;
  return null;
}

/** The neighbours to load ahead of time, next first (the likelier step), without duplicates (two photos have one neighbour; with two or more, neither is the shown photo). */
export function preloadIndexes(current: number, total: number): number[] {
  if (total < 2) return [];
  return [...new Set([stepIndex(current, total, 1), stepIndex(current, total, -1)])];
}

/** Movement of a finger that counts as a swipe: far enough, and clearly more sideways than up or down. */
export const SWIPE_DISTANCE = 48;
export const SWIPE_DOMINANCE = 1.5;

/** +1 (next) after a swipe to the left, -1 (previous) after one to the right, 0 for anything else (a tap, a scroll, a drag downwards). */
export function swipeStep(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < SWIPE_DOMINANCE * Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

/**
 * Whether a point lies outside the picture itself, in the letterbox around it: the `<img>` fills its frame with
 * `object-fit: contain`, so the box is larger than what is drawn. A click there counts as a click on the backdrop. Unknown
 * sizes (not loaded yet, a placeholder) never count.
 */
export function outsidePicture(
  box: { left: number; top: number; width: number; height: number },
  natural: { width: number; height: number },
  x: number,
  y: number,
): boolean {
  if (!(natural.width > 0 && natural.height > 0 && box.width > 0 && box.height > 0)) return false;
  const scale = Math.min(box.width / natural.width, box.height / natural.height);
  const [width, height] = [natural.width * scale, natural.height * scale];
  const [left, top] = [box.left + (box.width - width) / 2, box.top + (box.height - height) / 2];
  return x < left || x > left + width || y < top || y > top + height;
}
