import { describe, expect, it } from 'vitest';
import { outsidePicture, preloadIndexes, stepIndex, swipeStep, viewerKeyTarget } from './viewer';

describe('stepIndex', () => {
  it('wraps in both directions', () => {
    expect(stepIndex(0, 4, -1)).toBe(3);
    expect(stepIndex(3, 4, 1)).toBe(0);
    expect(stepIndex(1, 4, 1)).toBe(2);
    expect(stepIndex(2, 4, -1)).toBe(1);
  });
  it('copes with an empty list and with long steps', () => {
    expect(stepIndex(0, 0, 1)).toBe(0);
    expect(stepIndex(0, 3, -7)).toBe(2);
    expect(stepIndex(0, 1, 1)).toBe(0);
  });
});

describe('viewerKeyTarget', () => {
  it('maps the arrows (wrapping), Home and End', () => {
    expect(viewerKeyTarget('ArrowRight', 1, 4)).toBe(2);
    expect(viewerKeyTarget('ArrowRight', 3, 4)).toBe(0);
    expect(viewerKeyTarget('ArrowLeft', 0, 4)).toBe(3);
    expect(viewerKeyTarget('Home', 2, 4)).toBe(0);
    expect(viewerKeyTarget('End', 0, 4)).toBe(3);
  });
  it('ignores other keys and a single photo', () => {
    expect(viewerKeyTarget('a', 0, 4)).toBeNull();
    expect(viewerKeyTarget('ArrowUp', 0, 4)).toBeNull();
    expect(viewerKeyTarget('ArrowRight', 0, 1)).toBeNull();
    expect(viewerKeyTarget('End', 0, 0)).toBeNull();
  });
});

describe('preloadIndexes', () => {
  it('lists the next photo first, then the previous one', () => {
    expect(preloadIndexes(1, 5)).toEqual([2, 0]);
    expect(preloadIndexes(4, 5)).toEqual([0, 3]);
    expect(preloadIndexes(0, 5)).toEqual([1, 4]);
  });
  it('lists a single neighbour once and nothing for one photo', () => {
    expect(preloadIndexes(0, 2)).toEqual([1]);
    expect(preloadIndexes(1, 2)).toEqual([0]);
    expect(preloadIndexes(0, 1)).toEqual([]);
    expect(preloadIndexes(0, 0)).toEqual([]);
  });
  it('never includes the shown photo', () => {
    for (let total = 0; total < 6; total++)
      for (let current = 0; current < Math.max(total, 1); current++) expect(preloadIndexes(current, total)).not.toContain(current);
  });
});

describe('swipeStep', () => {
  it('steps forward after a swipe to the left and back after one to the right', () => {
    expect(swipeStep(-80, 5)).toBe(1);
    expect(swipeStep(80, -5)).toBe(-1);
  });
  it('ignores a tap, a short move and a mostly vertical one', () => {
    expect(swipeStep(0, 0)).toBe(0);
    expect(swipeStep(-47, 0)).toBe(0);
    expect(swipeStep(-60, 60)).toBe(0);
    expect(swipeStep(-60, 100)).toBe(0);
  });
  it('accepts exactly the minimum distance and a clearly sideways diagonal', () => {
    expect(swipeStep(-48, 0)).toBe(1);
    expect(swipeStep(-90, 59)).toBe(1);
    expect(swipeStep(-90, 61)).toBe(0);
  });
});

describe('outsidePicture', () => {
  const box = { left: 0, top: 0, width: 1000, height: 600 };
  it('is true in the letterbox beside a picture that is taller than its frame', () => {
    // 3:4 portrait in a 1000x600 frame is drawn 450 wide, from x=275 to x=725.
    const natural = { width: 300, height: 400 };
    expect(outsidePicture(box, natural, 100, 300)).toBe(true);
    expect(outsidePicture(box, natural, 800, 300)).toBe(true);
    expect(outsidePicture(box, natural, 500, 300)).toBe(false);
    expect(outsidePicture(box, natural, 276, 10)).toBe(false);
    expect(outsidePicture(box, natural, 274, 10)).toBe(true);
  });
  it('is true above and below a picture that is wider than its frame', () => {
    // 4:1 in 1000x600: drawn 1000x250 from y=175 to y=425.
    const natural = { width: 400, height: 100 };
    expect(outsidePicture(box, natural, 500, 100)).toBe(true);
    expect(outsidePicture(box, natural, 500, 500)).toBe(true);
    expect(outsidePicture(box, natural, 500, 300)).toBe(false);
  });
  it('honours the frame offset and never counts unknown sizes', () => {
    expect(outsidePicture({ left: 100, top: 50, width: 200, height: 200 }, { width: 100, height: 100 }, 150, 100)).toBe(false);
    expect(outsidePicture({ left: 100, top: 50, width: 200, height: 200 }, { width: 100, height: 50 }, 150, 90)).toBe(true);
    expect(outsidePicture(box, { width: 0, height: 0 }, 1, 1)).toBe(false);
    expect(outsidePicture({ ...box, width: 0 }, { width: 10, height: 10 }, 1, 1)).toBe(false);
  });
});
