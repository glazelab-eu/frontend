import { describe, expect, it, vi } from 'vitest';
import { MAX_CROP_SOURCE_PIXELS, MIN_CROP_SOURCE_SIDE, readImageSize, readableSource, sourceProblem } from './crop-source';
import type { HeicResult } from './heic';

const bytes = (...parts: Array<number[] | string>) =>
  Uint8Array.from(parts.flatMap((part) => (typeof part === 'string' ? [...part].map((letter) => letter.charCodeAt(0)) : part)));
const be32 = (value: number) => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
const be16 = (value: number) => [(value >> 8) & 255, value & 255];
const le16 = (value: number) => [value & 255, (value >> 8) & 255];
const le24 = (value: number) => [value & 255, (value >> 8) & 255, (value >> 16) & 255];

const png = (width: number, height: number) => bytes([0x89], 'PNG\r\n', [0x1a, 0x0a], be32(13), 'IHDR', be32(width), be32(height), [8, 6, 0, 0, 0]);
const sof = (marker: number, width: number, height: number) => [
  0xff,
  marker,
  ...be16(17),
  8,
  ...be16(height),
  ...be16(width),
  3,
  1,
  0x22,
  0,
  2,
  0x11,
  1,
  3,
  0x11,
  1,
];
const jpeg = (width: number, height: number, ...before: number[][]) => bytes([0xff, 0xd8], ...before, sof(0xc0, width, height), [0xff, 0xda]);
const segment = (marker: number, length: number) => [0xff, marker, ...be16(length + 2), ...new Array<number>(length).fill(0)];

describe('header sizes', () => {
  it('reads a PNG, however large it claims to be', () => {
    expect(readImageSize(png(640, 480))).toEqual({ width: 640, height: 480 });
    expect(readImageSize(png(10_000, 10_000))).toEqual({ width: 10_000, height: 10_000 });
    expect(readImageSize(png(4_000_000_000, 3))).toEqual({ width: 4_000_000_000, height: 3 });
  });

  it('reads a JPEG after its metadata segments, baseline or progressive', () => {
    expect(readImageSize(jpeg(4000, 3000))).toEqual({ width: 4000, height: 3000 });
    expect(readImageSize(jpeg(8000, 6000, segment(0xe1, 60_000), segment(0xe2, 30_000), segment(0xdb, 130)))).toEqual({ width: 8000, height: 6000 });
    expect(readImageSize(bytes([0xff, 0xd8], segment(0xc4, 20), sof(0xc2, 300, 200)))).toEqual({ width: 300, height: 200 });
  });

  it('skips fill bytes and markers without a length in a JPEG', () => {
    expect(readImageSize(bytes([0xff, 0xd8, 0xff, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0x01], sof(0xc1, 70, 80)))).toEqual({ width: 70, height: 80 });
  });

  it('gives nothing for a JPEG whose frame header is missing or cut off', () => {
    expect(readImageSize(bytes([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull();
    expect(readImageSize(jpeg(4000, 3000).subarray(0, 10))).toBeNull();
    expect(readImageSize(bytes([0xff, 0xd8], segment(0xe1, 500)).subarray(0, 100))).toBeNull();
    expect(readImageSize(bytes([0xff, 0xd8, 0x12, 0x34, 0x56, 0x78]))).toBeNull();
  });

  it('reads a GIF', () => {
    expect(readImageSize(bytes('GIF89a', le16(321), le16(123), [0, 0, 0]))).toEqual({ width: 321, height: 123 });
  });

  it('reads the three WebP flavours', () => {
    const riff = (chunk: string, body: number[]) => bytes('RIFF', [0, 0, 0, 0], 'WEBP', chunk, [0, 0, 0, 0], body);
    expect(readImageSize(riff('VP8X', [0, 0, 0, 0, ...le24(5999), ...le24(3999), 0, 0]))).toEqual({ width: 6000, height: 4000 });
    expect(readImageSize(riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(640), ...le16(480), 0, 0]))).toEqual({ width: 640, height: 480 });
    const bits = (123 | (77 << 14)) >>> 0;
    expect(readImageSize(riff('VP8L', [0x2f, bits & 255, (bits >> 8) & 255, (bits >> 16) & 255, (bits >>> 24) & 255, 0, 0, 0]))).toEqual({
      width: 124,
      height: 78,
    });
  });

  it('gives nothing for other formats, text, or too few bytes', () => {
    expect(readImageSize(bytes('BM', new Array<number>(40).fill(0)))).toBeNull();
    expect(readImageSize(bytes('not a picture at all, just text'))).toBeNull();
    expect(readImageSize(new Uint8Array())).toBeNull();
    expect(readImageSize(png(10, 10).subarray(0, 20))).toBeNull();
    expect(readImageSize(bytes('RIFF', [0, 0, 0, 0], 'WEBP'))).toBeNull();
  });
});

describe('source limits', () => {
  it('accepts up to the pixel limit and refuses above it', () => {
    expect(sourceProblem({ width: 5000, height: 10_000 })).toBeNull();
    expect(MAX_CROP_SOURCE_PIXELS).toBe(50_000_000);
    expect(sourceProblem({ width: 5000, height: 10_001 })).toBe('tooManyPixels');
    expect(sourceProblem({ width: 10_000, height: 10_000 })).toBe('tooManyPixels');
    expect(sourceProblem({ width: 4_000_000_000, height: 3 })).toBe('tooManyPixels');
  });

  it('refuses a picture whose shorter side is below the minimum', () => {
    expect(MIN_CROP_SOURCE_SIDE).toBe(64);
    expect(sourceProblem({ width: 64, height: 64 })).toBeNull();
    expect(sourceProblem({ width: 63, height: 500 })).toBe('tooSmall');
    expect(sourceProblem({ width: 500, height: 63 })).toBe('tooSmall');
    expect(sourceProblem({ width: 40, height: 30 })).toBe('tooSmall');
  });

  it('leaves a size without pixels to the decoder', () => {
    expect(sourceProblem({ width: 0, height: 0 })).toBeNull();
    expect(sourceProblem({ width: Number.NaN, height: 10 })).toBeNull();
  });
});

describe('the file the dialog decodes', () => {
  const jpegFile = new File([jpeg(300, 200)], 'IMG_1.jpg', { type: 'image/jpeg' });

  it('converts a HEIC photo by type or by name and hands on the JPEG, which then passes the same header checks', async () => {
    for (const heic of [new File(['x'], 'IMG_1.HEIC', { type: 'image/heic' }), new File(['x'], 'IMG_2.heif', { type: '' })]) {
      const convert = vi.fn(async (): Promise<HeicResult> => ({ ok: true, file: jpegFile }));
      expect(await readableSource(heic, 40_000_000, convert)).toEqual({ file: jpegFile });
      expect(convert).toHaveBeenCalledWith(heic, 40_000_000);
    }
    const header = readImageSize(new Uint8Array(await jpegFile.arrayBuffer()));
    expect(header && sourceProblem(header)).toBeNull();
    const small = new File([jpeg(60, 200)], 'small.jpg', { type: 'image/jpeg' });
    const smallHeader = readImageSize(new Uint8Array(await small.arrayBuffer()));
    expect(smallHeader && sourceProblem(smallHeader)).toBe('tooSmall');
  });

  it('names a HEIC photo the browser cannot convert, whatever the reason, and never hands the raw file on', async () => {
    const heic = new File(['x'], 'IMG_1.HEIC', { type: 'image/heic' });
    for (const reason of ['unsupported', 'tooLarge'] as const) {
      expect(await readableSource(heic, 40_000_000, async () => ({ ok: false, reason }))).toEqual({ problem: 'heic' });
    }
  });

  it('leaves any other file alone, without converting', async () => {
    const convert = vi.fn();
    expect(await readableSource(jpegFile, 40_000_000, convert)).toEqual({ file: jpegFile });
    expect(convert).not.toHaveBeenCalled();
  });
});
