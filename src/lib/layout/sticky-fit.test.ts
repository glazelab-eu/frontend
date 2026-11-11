import { describe, expect, it } from 'vitest';
import { fitsSticky } from './sticky-fit';

describe('fitsSticky', () => {
  it('sticks a column that fits the window with the gap above and below', () => {
    expect(fitsSticky(736, 768, 16)).toBe(true);
    expect(fitsSticky(500, 1080, 16)).toBe(true);
  });

  it('never sticks a column whose lower part would stay below the screen', () => {
    expect(fitsSticky(737, 768, 16)).toBe(false);
    expect(fitsSticky(759, 768, 16)).toBe(false);
    expect(fitsSticky(900, 800, 16)).toBe(false);
  });

  it('counts the sticky header above the column, so the column fits what is left of the window', () => {
    expect(fitsSticky(662, 768, 16, 74)).toBe(true);
    expect(fitsSticky(663, 768, 16, 74)).toBe(false);
    expect(fitsSticky(500, 400, 16, 145)).toBe(false);
  });

  it('does not stick before anything was measured', () => {
    expect(fitsSticky(0, 800, 16)).toBe(false);
    expect(fitsSticky(500, 0, 16)).toBe(false);
  });
});
