import { describe, expect, it } from 'vitest';
import { rectOf, type Crop, type Size } from './crop';
import { PHOTO_FOCUS, coverPosition, fitRect, focusOf, frameAt, frameFocus, moveFrame, stepFrame } from './photo-focus';

const landscape: Size = { width: 4000, height: 2000 };
const portrait: Size = { width: 1200, height: 1600 };
const exact: Size = { width: 3000, height: 2000 };

function expectInside(frame: Crop, size: Size) {
  const rect = rectOf(frame, size, PHOTO_FOCUS);
  expect(rect.x).toBeGreaterThanOrEqual(-1e-9);
  expect(rect.y).toBeGreaterThanOrEqual(-1e-9);
  expect(rect.x + rect.width).toBeLessThanOrEqual(size.width + 1e-9);
  expect(rect.y + rect.height).toBeLessThanOrEqual(size.height + 1e-9);
  expect(rect.width / rect.height).toBeCloseTo(1.5, 9);
}

describe('coverPosition', () => {
  it('is the stored focus in percent, the centre without one', () => {
    expect(coverPosition({ focusX: 20, focusY: 75 })).toBe('20% 75%');
    expect(coverPosition({ focusX: 0, focusY: 100 })).toBe('0% 100%');
    expect(coverPosition({ focusX: null, focusY: null })).toBe('50% 50%');
    // An old snapshot has neither field.
    expect(coverPosition({})).toBe('50% 50%');
  });

  it('never trusts half a focus or a value outside 0 to 100', () => {
    expect(coverPosition({ focusX: 30, focusY: null })).toBe('50% 50%');
    expect(coverPosition({ focusX: Number.NaN, focusY: 10 })).toBe('50% 50%');
    expect(coverPosition({ focusX: -5, focusY: 140 })).toBe('0% 100%');
    expect(focusOf({ focusX: 12.6, focusY: 3 })).toEqual({ x: 13, y: 3 });
  });
});

describe('the focus frame', () => {
  it('is the largest 3:2 window, centred without a focus', () => {
    expect(rectOf(frameAt(landscape, null), landscape, PHOTO_FOCUS)).toEqual({ x: 500, y: 0, width: 3000, height: 2000 });
    expect(rectOf(frameAt(portrait, null), portrait, PHOTO_FOCUS)).toEqual({ x: 0, y: 400, width: 1200, height: 800 });
    expect(frameFocus(frameAt(landscape, null), landscape)).toEqual({ x: 50, y: 50 });
  });

  it('stands for the same focus it starts from: the frame at X % of its travel shows what object-position X % shows', () => {
    for (const size of [landscape, portrait]) {
      for (const focus of [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        { x: 25, y: 80 },
      ]) {
        const frame = frameAt(size, focus);
        expectInside(frame, size);
        const travelled = frameFocus(frame, size);
        // An axis the frame fills cannot move: it counts as the centre.
        expect(travelled).toEqual({ x: size === landscape ? focus.x : 50, y: size === portrait ? focus.y : 50 });
      }
    }
    // The left quarter of a landscape photo's travel: 1000 px of travel, so the frame starts at 250 px.
    expect(rectOf(frameAt(landscape, { x: 25, y: 0 }), landscape, PHOTO_FOCUS).x).toBe(250);
  });

  it('moves with a drag in source pixels and stays inside the photo', () => {
    const start = frameAt(landscape, null);
    expect(moveFrame(start, landscape, 200, 50)).toEqual({ zoom: 1, x: start.x + 200, y: start.y });
    const far = moveFrame(start, landscape, -100_000, 100_000);
    expect(rectOf(far, landscape, PHOTO_FOCUS)).toEqual({ x: 0, y: 0, width: 3000, height: 2000 });
    expect(frameFocus(far, landscape)).toEqual({ x: 0, y: 50 });
    expect(frameFocus(moveFrame(start, landscape, 100_000, 0), landscape)).toEqual({ x: 100, y: 50 });
    expect(moveFrame(start, landscape, Number.NaN, Number.POSITIVE_INFINITY)).toEqual(start);
  });

  it('steps a twentieth of its own side for an arrow key, in the arrow’s direction', () => {
    const start = frameAt(portrait, null);
    expect(stepFrame(start, portrait, 0, 1).y).toBeCloseTo(start.y + 0.05 * 800, 9);
    expect(stepFrame(start, portrait, 0, -1).y).toBeCloseTo(start.y - 0.05 * 800, 9);
    // A photo of the frame's own shape cannot move at all.
    expect(stepFrame(frameAt(exact, null), exact, 1, 1)).toEqual(frameAt(exact, null));
    expect(frameFocus(frameAt(exact, { x: 0, y: 100 }), exact)).toEqual({ x: 50, y: 50 });
  });
});

describe('fitRect', () => {
  it('draws the whole photo as large as the stage allows, centred', () => {
    expect(fitRect(landscape, { width: 600, height: 400 })).toEqual({ x: 0, y: 50, width: 600, height: 300 });
    expect(fitRect(portrait, { width: 600, height: 400 })).toEqual({ x: 150, y: 0, width: 300, height: 400 });
    expect(fitRect(landscape, { width: 0, height: 400 })).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});
