import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  MIN_WINDOW,
  MOVE_STEP,
  OUTPUT_MAX,
  clampZoom,
  dragBy,
  nudge,
  outputSide,
  maxZoom,
  pinchTo,
  positionOf,
  squareOf,
  startCrop,
  windowSide,
  zoomTo,
  type Crop,
  type Size,
} from './avatar-crop';

const wide: Size = { width: 2000, height: 1000 };
const tall: Size = { width: 600, height: 1200 };

/** Every window must lie inside the picture. */
function inside(crop: Crop, size: Size) {
  const square = squareOf(crop, size);
  expect(square.x).toBeGreaterThanOrEqual(0);
  expect(square.y).toBeGreaterThanOrEqual(0);
  expect(square.x + square.side).toBeLessThanOrEqual(size.width + 1e-9);
  expect(square.y + square.side).toBeLessThanOrEqual(size.height + 1e-9);
}

describe('zoom limits', () => {
  it('keeps the zoom between 1 and the maximum', () => {
    expect(clampZoom(0.2)).toBe(MIN_ZOOM);
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(2.5)).toBe(2.5);
    expect(clampZoom(40)).toBe(MAX_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(MIN_ZOOM);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(MIN_ZOOM);
  });

  it('shows the whole short side at zoom 1 and a quarter of it at the maximum', () => {
    expect(windowSide(wide, 1)).toBe(1000);
    expect(windowSide(wide, MAX_ZOOM)).toBe(250);
    expect(windowSide(tall, 1)).toBe(600);
    expect(windowSide(tall, 2)).toBe(300);
    expect(windowSide(wide, 99)).toBe(250);
  });
});

describe('the start', () => {
  it('is the largest centred square', () => {
    expect(squareOf(startCrop(wide), wide)).toEqual({ x: 500, y: 0, side: 1000 });
    expect(squareOf(startCrop(tall), tall)).toEqual({ x: 0, y: 300, side: 600 });
    expect(squareOf(startCrop({ width: 500, height: 500 }), { width: 500, height: 500 })).toEqual({ x: 0, y: 0, side: 500 });
  });
});

describe('position clamping', () => {
  it('cannot drag the window out of the picture', () => {
    const start = startCrop(wide);
    // Dragging the picture far right moves the window to its left edge, and far left to its right edge.
    expect(squareOf(dragBy(start, wide, 10_000, 0, 300), wide).x).toBe(0);
    expect(squareOf(dragBy(start, wide, -10_000, 0, 300), wide).x).toBe(1000);
    // At zoom 1 the short side is whole, so the other axis cannot move at all.
    expect(squareOf(dragBy(start, wide, 0, 500, 300), wide).y).toBe(0);
    const zoomed = zoomTo(start, wide, 2);
    for (const [dx, dy] of [
      [9999, 9999],
      [-9999, 9999],
      [9999, -9999],
      [-9999, -9999],
    ]) {
      inside(dragBy(zoomed, wide, dx, dy, 300), wide);
    }
  });

  it('moves the window opposite to the drag, scaled from stage pixels to source pixels', () => {
    const zoomed = zoomTo(startCrop(wide), wide, 2); // a 500 px window
    const moved = dragBy(zoomed, wide, 60, -30, 300); // 300 px stage: 500 / 300 source pixels per stage pixel
    expect(moved.x).toBeCloseTo(1000 - 100, 6);
    expect(moved.y).toBeCloseTo(500 + 50, 6);
  });

  it('pulls the centre inward when zooming out would let the window stick out', () => {
    let crop = zoomTo(startCrop(wide), wide, MAX_ZOOM);
    crop = dragBy(crop, wide, 100_000, 100_000, 300); // the top-left corner of the picture
    expect(squareOf(crop, wide)).toEqual({ x: 0, y: 0, side: 250 });
    crop = zoomTo(crop, wide, 1);
    expect(squareOf(crop, wide)).toEqual({ x: 0, y: 0, side: 1000 });
    inside(zoomTo(crop, wide, 3), wide);
  });

  it('ignores a stage without size or a drag that is not a number', () => {
    const start = zoomTo(startCrop(wide), wide, 2);
    expect(dragBy(start, wide, 10, 10, 0)).toBe(start);
    expect(dragBy(start, wide, Number.NaN, Number.NaN, 300)).toEqual(start);
  });
});

describe('keys', () => {
  it('an arrow moves the picture by a step of the visible window, like a drag', () => {
    const zoomed = zoomTo(startCrop(wide), wide, 2); // 500 px window
    const right = nudge(zoomed, wide, 1, 0); // the picture moves right: the window moves left
    expect(right.x).toBeCloseTo(1000 - 500 * MOVE_STEP, 6);
    expect(right.y).toBe(zoomed.y);
    const up = nudge(zoomed, wide, 0, -1);
    expect(up.y).toBeCloseTo(500 + 500 * MOVE_STEP, 6);
    expect(nudge(zoomed, wide, 0, 0)).toEqual(zoomed);
  });

  it('holding an arrow ends at the edge', () => {
    let crop = zoomTo(startCrop(tall), tall, 2);
    for (let i = 0; i < 100; i++) crop = nudge(crop, tall, -1, 1);
    expect(squareOf(crop, tall).x + squareOf(crop, tall).side).toBe(600);
    expect(squareOf(crop, tall).y).toBe(0);
    inside(crop, tall);
  });
});

describe('pinch', () => {
  const at = (distance: number, u = 0, v = 0) => ({ distance, u, v });

  it('scales the zoom with the distance between the fingers, within the limits', () => {
    const start = zoomTo(startCrop(wide), wide, 2);
    expect(pinchTo(start, wide, at(100), at(150)).zoom).toBeCloseTo(3, 9);
    expect(pinchTo(start, wide, at(100), at(50)).zoom).toBeCloseTo(1, 9);
    expect(pinchTo(start, wide, at(100), at(5000)).zoom).toBe(MAX_ZOOM);
    expect(pinchTo(start, wide, at(100), at(0)).zoom).toBe(MIN_ZOOM);
  });

  it('changes nothing without a starting distance', () => {
    const start = zoomTo(startCrop(wide), wide, 2);
    expect(pinchTo(start, wide, at(0), at(100))).toBe(start);
    expect(pinchTo(start, wide, at(Number.NaN), at(100))).toBe(start);
  });

  it('zooms about the midpoint of the fingers: the point of the picture under it stays under it', () => {
    const start = zoomTo(startCrop(wide), wide, 2);
    // The midpoint sits a quarter of the stage right of and above the centre.
    const u = 0.25;
    const v = -0.25;
    const sourceAt = (crop: Crop) => {
      const side = windowSide(wide, crop.zoom);
      return { x: crop.x + u * side, y: crop.y + v * side };
    };
    const zoomed = pinchTo(start, wide, at(100, u, v), at(200, u, v));
    expect(zoomed.zoom).toBeCloseTo(4, 9);
    expect(sourceAt(zoomed).x).toBeCloseTo(sourceAt(start).x, 6);
    expect(sourceAt(zoomed).y).toBeCloseTo(sourceAt(start).y, 6);
    // Zooming out about the same point keeps it there too, as far as the picture's edges allow.
    const out = pinchTo(zoomTo(start, wide, 3), wide, at(100, u, v), at(80, u, v));
    expect(sourceAt(out).x).toBeCloseTo(sourceAt(zoomTo(start, wide, 3)).x, 6);
    inside(zoomed, wide);
    inside(out, wide);
  });

  it('about the centre it matches a plain zoom, and a midpoint that moves pans the picture with it', () => {
    const start = zoomTo(startCrop(wide), wide, 2);
    expect(pinchTo(start, wide, at(100), at(150))).toEqual(zoomTo(start, wide, 3));
    // Same distance, the midpoint moves a tenth of the stage to the right: the picture follows the fingers (the window moves left).
    const panned = pinchTo(start, wide, at(100), at(100, 0.1, 0));
    expect(panned.x).toBeCloseTo(start.x - 0.1 * windowSide(wide, 2), 6);
    expect(panned.y).toBeCloseTo(start.y, 6);
  });

  it('keeps the window inside the picture when the midpoint is at the stage edge', () => {
    const start = startCrop(wide);
    inside(pinchTo(start, wide, at(100, -0.5, -0.5), at(400, -0.5, -0.5)), wide);
    inside(pinchTo(start, wide, at(100, 0.5, 0.5), at(400, 0.5, 0.5)), wide);
  });
});

describe('a small picture', () => {
  it('has no zoom past the point where the window is smaller than MIN_WINDOW source pixels', () => {
    expect(maxZoom(wide)).toBe(MAX_ZOOM);
    expect(maxZoom({ width: 1000, height: 256 })).toBe(MAX_ZOOM);
    expect(maxZoom({ width: 1000, height: 128 })).toBe(2);
    expect(maxZoom({ width: 300, height: MIN_WINDOW })).toBe(1);
    // Below the smallest accepted picture there is no zoom at all.
    expect(maxZoom({ width: 40, height: 30 })).toBe(1);
  });

  it('never gives a square below MIN_WINDOW pixels, by slider, keys or fingers', () => {
    const small: Size = { width: 150, height: 100 };
    const limit = maxZoom(small);
    expect(limit).toBeCloseTo(100 / MIN_WINDOW, 9);
    expect(squareOf(zoomTo(startCrop(small), small, MAX_ZOOM), small).side).toBeCloseTo(MIN_WINDOW, 9);
    expect(squareOf(pinchTo(startCrop(small), small, { distance: 10, u: 0, v: 0 }, { distance: 1000, u: 0, v: 0 }), small).side).toBeCloseTo(MIN_WINDOW, 9);
  });
});

describe('position', () => {
  it('is the share of the way the window can travel, and 50 where it cannot move', () => {
    const zoomed = zoomTo(startCrop(wide), wide, 2);
    expect(positionOf(zoomed, wide)).toEqual({ x: 50, y: 50 });
    expect(positionOf(startCrop(wide), wide)).toEqual({ x: 50, y: 50 });
    const left = dragBy(zoomed, wide, 1e6, 1e6, 100);
    expect(positionOf(left, wide)).toEqual({ x: 0, y: 0 });
    const right = dragBy(zoomed, wide, -1e6, -1e6, 100);
    expect(positionOf(right, wide)).toEqual({ x: 100, y: 100 });
    // The window of the whole short side can only move along the long side.
    expect(positionOf(dragBy(startCrop(wide), wide, 1e6, 0, 100), wide)).toEqual({ x: 0, y: 50 });
  });
});

describe('output square', () => {
  it("is square, with the window's own pixels", () => {
    const square = squareOf(zoomTo(startCrop(wide), wide, 2), wide);
    expect(square.side).toBe(500);
    expect(outputSide(square)).toBe(500);
  });

  it('is never enlarged and never above the maximum', () => {
    expect(outputSide({ x: 0, y: 0, side: 80 })).toBe(80);
    expect(outputSide({ x: 0, y: 0, side: 80.9 })).toBe(80);
    expect(outputSide({ x: 0, y: 0, side: 4000 })).toBe(OUTPUT_MAX);
    expect(outputSide({ x: 0, y: 0, side: 0 })).toBe(1);
    expect(outputSide({ x: 0, y: 0, side: Number.NaN })).toBe(1);
  });

  it('keeps a crop that lies outside, or has no centre, inside the picture (the centre then falls back to the middle)', () => {
    expect(squareOf({ zoom: 2, x: -500, y: 5000 }, wide)).toEqual({ x: 0, y: 500, side: 500 });
    expect(squareOf({ zoom: 2, x: Number.NaN, y: Number.NaN }, wide)).toEqual({ x: 750, y: 250, side: 500 });
    // An extreme aspect ratio: a one-pixel-high strip still gives a whole square (it has no zoom: its window is already below the minimum).
    const strip: Size = { width: 5000, height: 1 };
    expect(squareOf(dragBy(zoomTo(startCrop(strip), strip, MAX_ZOOM), strip, 1e9, 0, 100), strip)).toEqual({ x: 0, y: 0, side: 1 });
  });

  it('a tiny picture gives a small but whole square', () => {
    const tiny: Size = { width: 40, height: 30 };
    const square = squareOf(startCrop(tiny), tiny);
    expect(square).toEqual({ x: 5, y: 0, side: 30 });
    expect(outputSide(square)).toBe(30);
  });
});
