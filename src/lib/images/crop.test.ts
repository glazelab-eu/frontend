import { describe, expect, it } from 'vitest';
import { dragBy, maxZoom, nudge, pinchTo, positionOf, rectOf, startCrop, windowSize, zoomTo, type Crop, type CropShape, type Size } from './crop';

// The square shape is covered through the avatar's binding (`lib/avatars/avatar-crop.test.ts`); these cases use a 3:2 window that
// zooms, so the arithmetic is checked on an aspect that is not square.
const PHOTO_FRAME: CropShape = { aspect: 3 / 2, minWindow: 240, maxZoom: 4 };
const landscape: Size = { width: 4000, height: 2000 };
const portrait: Size = { width: 1200, height: 1600 };
const exact: Size = { width: 3000, height: 2000 };

function expectInside(crop: Crop, size: Size) {
  const rect = rectOf(crop, size, PHOTO_FRAME);
  expect(rect.x).toBeGreaterThanOrEqual(-1e-9);
  expect(rect.y).toBeGreaterThanOrEqual(-1e-9);
  expect(rect.x + rect.width).toBeLessThanOrEqual(size.width + 1e-9);
  expect(rect.y + rect.height).toBeLessThanOrEqual(size.height + 1e-9);
  expect(rect.width / rect.height).toBeCloseTo(PHOTO_FRAME.aspect, 9);
}

describe('a 3:2 crop', () => {
  it('starts as the largest centred frame, filling the axis the photo is short on', () => {
    expect(rectOf(startCrop(landscape), landscape, PHOTO_FRAME)).toEqual({ x: 500, y: 0, width: 3000, height: 2000 });
    expect(rectOf(startCrop(portrait), portrait, PHOTO_FRAME)).toEqual({ x: 0, y: 400, width: 1200, height: 800 });
    expect(rectOf(startCrop(exact), exact, PHOTO_FRAME)).toEqual({ x: 0, y: 0, width: 3000, height: 2000 });
  });

  it('keeps the aspect at every zoom and stays inside the photo', () => {
    for (const size of [landscape, portrait, exact]) {
      for (const zoom of [1, 1.3, 2, 4, 9]) expectInside(zoomTo(startCrop(size), size, zoom, PHOTO_FRAME), size);
    }
  });

  it('zooms up to four times, but never below the smallest frame of a small photo, and never below 1', () => {
    expect(maxZoom(landscape, PHOTO_FRAME)).toBe(4);
    expect(windowSize(landscape, 4, PHOTO_FRAME)).toEqual({ width: 750, height: 500 });
    const small: Size = { width: 600, height: 400 };
    expect(maxZoom(small, PHOTO_FRAME)).toBeCloseTo(400 / 240, 9);
    expect(windowSize(small, 99, PHOTO_FRAME).height).toBeCloseTo(240, 9);
    expect(maxZoom({ width: 300, height: 200 }, PHOTO_FRAME)).toBe(1);
  });

  it('moves with a drag scaled to source pixels and stops at the edges', () => {
    const start = zoomTo(startCrop(landscape), landscape, 2, PHOTO_FRAME);
    // A 300 px wide stage shows 1500 source pixels: a 30 px drag moves the frame by 150.
    expect(dragBy(start, landscape, 30, 10, 300, PHOTO_FRAME)).toEqual({ zoom: 2, x: start.x - 150, y: start.y - 50 });
    const far = dragBy(start, landscape, -100_000, -100_000, 300, PHOTO_FRAME);
    expect(rectOf(far, landscape, PHOTO_FRAME)).toEqual({ x: 2500, y: 1000, width: 1500, height: 1000 });
    expectInside(far, landscape);
  });

  it('moves a key step of the frame’s own width and height', () => {
    const start = zoomTo(startCrop(landscape), landscape, 2, PHOTO_FRAME);
    expect(nudge(start, landscape, -1, 0, PHOTO_FRAME).x).toBeCloseTo(start.x + 0.05 * 1500, 9);
    expect(nudge(start, landscape, 0, 1, PHOTO_FRAME).y).toBeCloseTo(start.y - 0.05 * 1000, 9);
    // The whole height is shown at zoom 1: up and down cannot move, and the position says so.
    expect(nudge(startCrop(landscape), landscape, 0, 1, PHOTO_FRAME).y).toBe(1000);
    expect(positionOf(startCrop(landscape), landscape, PHOTO_FRAME)).toEqual({ x: 50, y: 50 });
  });

  it('pinches about the fingers’ midpoint on a stage of the frame’s shape', () => {
    const start = startCrop(landscape);
    // Fingers spread to twice their distance with the midpoint a quarter of the stage to the left: that point stays under them.
    const pinched = pinchTo(start, landscape, { distance: 100, u: -0.25, v: 0 }, { distance: 200, u: -0.25, v: 0 }, PHOTO_FRAME);
    expect(pinched.zoom).toBe(2);
    const anchor = start.x - 0.25 * 3000;
    expect(pinched.x - 0.25 * 1500).toBeCloseTo(anchor, 9);
    expectInside(pinched, landscape);
  });
});
