import { describe, expect, it } from 'vitest';
import { chipScrollLeft, scrollEdges, type ChipScroll } from './chip-scroll';

// A 300 px row of 700 px of chips, 100 px wide with 8 px gaps, fades of 24 px.
const row = (over: Partial<ChipScroll>): ChipScroll => ({ chipLeft: 0, chipRight: 100, scrollLeft: 0, viewWidth: 300, scrollWidth: 700, fade: 24, ...over });

describe('chipScrollLeft', () => {
  it('leaves the row alone when the chip is already clear of the fades', () => {
    expect(chipScrollLeft(row({ chipLeft: 0, chipRight: 100 }))).toBe(0);
    expect(chipScrollLeft(row({ chipLeft: 120, chipRight: 220 }))).toBe(0);
    expect(chipScrollLeft(row({ scrollLeft: 100, chipLeft: 130, chipRight: 230 }))).toBe(100);
  });

  it('scrolls a chip beyond the end edge in, behind the start fade', () => {
    expect(chipScrollLeft(row({ chipLeft: 324, chipRight: 424 }))).toBe(300);
    expect(chipScrollLeft(row({ chipLeft: 230, chipRight: 330 }))).toBe(206);
  });

  it('treats the end fade as part of the edge only while more chips follow', () => {
    // Scrolled to the end (max 400): a chip at the right edge is clear, nothing fades there.
    expect(chipScrollLeft(row({ scrollLeft: 400, chipLeft: 600, chipRight: 700 }))).toBe(400);
    // Not at the end: the same chip right at the edge sits under the fade.
    expect(chipScrollLeft(row({ scrollLeft: 300, scrollWidth: 900, chipLeft: 480, chipRight: 590 }))).toBe(456);
  });

  it('scrolls a chip before the start edge back, keeping the previous chip peeking', () => {
    expect(chipScrollLeft(row({ scrollLeft: 300, chipLeft: 216, chipRight: 316 }))).toBe(192);
    expect(chipScrollLeft(row({ scrollLeft: 300, chipLeft: 10, chipRight: 110 }))).toBe(0);
  });

  it('clamps to the content', () => {
    expect(chipScrollLeft(row({ chipLeft: 600, chipRight: 700 }))).toBe(400);
  });

  it('does nothing for a row without overflow', () => {
    expect(chipScrollLeft(row({ chipLeft: 200, chipRight: 290, scrollWidth: 300 }))).toBe(0);
    expect(chipScrollLeft({ chipLeft: 0, chipRight: 0, scrollLeft: 0, viewWidth: 0, scrollWidth: 0, fade: 24 })).toBe(0);
  });
});

describe('scrollEdges', () => {
  it('shows a fade only on the sides that hold more chips', () => {
    expect(scrollEdges(0, 300, 700)).toEqual({ start: false, end: true });
    expect(scrollEdges(200, 300, 700)).toEqual({ start: true, end: true });
    expect(scrollEdges(400, 300, 700)).toEqual({ start: true, end: false });
    expect(scrollEdges(0, 300, 300)).toEqual({ start: false, end: false });
  });

  it('ignores sub-pixel rounding', () => {
    expect(scrollEdges(399.8, 300, 700)).toEqual({ start: true, end: false });
    expect(scrollEdges(0.3, 300, 300.4)).toEqual({ start: false, end: false });
  });
});
