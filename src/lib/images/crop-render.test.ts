import { describe, expect, it } from 'vitest';
import { stagePixels } from './crop-render';

describe('preview canvas pixels', () => {
  it('follow the size on the screen times the device pixel ratio', () => {
    expect(stagePixels(224, 1)).toBe(224);
    expect(stagePixels(224, 3)).toBe(672);
    expect(stagePixels(224.4, 2.625)).toBe(589);
  });

  it('never go below the screen size, and are limited', () => {
    expect(stagePixels(224, 0.5)).toBe(224);
    expect(stagePixels(224, Number.NaN)).toBe(224);
    expect(stagePixels(256, 8)).toBe(1024);
    expect(stagePixels(10, 1)).toBe(64);
  });

  it('use a default before the stage is measured', () => {
    expect(stagePixels(0, 3)).toBe(360);
    expect(stagePixels(Number.NaN, 3)).toBe(360);
  });
});
