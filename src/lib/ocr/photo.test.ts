import { describe, expect, it } from 'vitest';
import { photoSize, validatePhoto } from './photo';

describe('label photo limits', () => {
  it('accepts raster photo types and rejects empty, oversized or unsupported files', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) expect(() => validatePhoto({ type, size: 1024 })).not.toThrow();
    for (const type of ['image/svg+xml', 'text/html', '']) expect(() => validatePhoto({ type, size: 1024 })).toThrow('fileType');
    for (const size of [0, 12 * 1024 * 1024 + 1]) expect(() => validatePhoto({ type: 'image/jpeg', size })).toThrow('fileSize');
  });
  it('bounds the canvas, keeps aspect ratio and caps small-photo upscaling at 3x', () => {
    expect(photoSize(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(photoSize(206, 350)).toEqual({ width: 618, height: 1050 });
    expect(photoSize(1, 1)).toEqual({ width: 3, height: 3 });
    for (const [width, height] of [
      [6000, 5000],
      [0, 10],
      [1, -2],
      [NaN, 10],
      [Infinity, 10],
    ])
      expect(() => photoSize(width, height)).toThrow('pixels');
  });
});
