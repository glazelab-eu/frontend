import { describe, expect, it } from 'vitest';
import { centerCrop, toTensor } from './preprocess';

describe('centerCrop', () => {
  it.each([
    [4000, 3000, { x: 500, y: 0, size: 3000 }],
    [3000, 4000, { x: 0, y: 500, size: 3000 }],
    [224, 224, { x: 0, y: 0, size: 224 }],
    [225, 224, { x: 0, y: 0, size: 224 }],
    [227, 224, { x: 1, y: 0, size: 224 }],
    [100, 301, { x: 0, y: 100, size: 100 }],
  ])('takes the middle square of %i x %i', (width, height, expected) => {
    expect(centerCrop(width, height)).toEqual(expected);
  });
});

describe('toTensor', () => {
  const mean = [0.5, 0.25, 0.75];
  const std = [0.5, 0.25, 0.25];

  it('normalizes each channel as (value / 255 - mean) / std and lays the channels out one after the other', () => {
    // 2 x 2 pixels: red 255/0/0, green 0/255/0, blue 0/0/255, grey 51/51/51 (alpha 7, ignored).
    const rgba = Uint8ClampedArray.from([255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 128, 51, 51, 51, 7]);
    const tensor = toTensor(rgba, 2, mean, std);
    expect(tensor).toHaveLength(12);
    expect([...tensor.slice(0, 4)]).toEqual([1, -1, -1, (0.2 - 0.5) / 0.5].map((value) => Math.fround(value)));
    expect([...tensor.slice(4, 8)]).toEqual([-1, 3, -1, (0.2 - 0.25) / 0.25].map((value) => Math.fround(value)));
    expect([...tensor.slice(8, 12)]).toEqual([-3, -3, 1, (0.2 - 0.75) / 0.25].map((value) => Math.fround(value)));
  });

  it('does not let the alpha channel change a value', () => {
    const opaque = toTensor([10, 20, 30, 255], 1, mean, std);
    const clear = toTensor([10, 20, 30, 0], 1, mean, std);
    expect([...clear]).toEqual([...opaque]);
  });

  it('refuses pixel data of another size', () => {
    expect(() => toTensor(new Uint8ClampedArray(12), 2, mean, std)).toThrow(RangeError);
    expect(() => toTensor(new Uint8ClampedArray(20), 2, mean, std)).toThrow(RangeError);
  });
});
