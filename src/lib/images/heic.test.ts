import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  JPEG_QUALITIES,
  MAX_JPEG_PIXELS,
  browserHeic,
  convertHeic,
  jpegName,
  looksHeic,
  targetSize,
  uploadFailureMessage,
  type Decoded,
  type HeicBrowser,
} from './heic';

const file = (name: string, type = '', size = 8) => new File([new Uint8Array(size)], name, { type, lastModified: 1_700_000_000_000 });

describe('looksHeic', () => {
  it('knows HEIC and HEIF by type, in any case', () => {
    expect(looksHeic(file('x', 'image/heic'))).toBe(true);
    expect(looksHeic(file('x', 'image/heif'))).toBe(true);
    expect(looksHeic(file('x', 'IMAGE/HEIC'))).toBe(true);
    expect(looksHeic(file('x', 'image/heic-sequence'))).toBe(true);
  });

  it('knows them by extension, in any case, whatever the type (iOS gives Files and AirDrop photos an empty type)', () => {
    expect(looksHeic(file('IMG_0001.heic'))).toBe(true);
    expect(looksHeic(file('IMG_0001.HEIC'))).toBe(true);
    expect(looksHeic(file('IMG_0001.HeIf'))).toBe(true);
    expect(looksHeic(file('IMG_0001.heic', 'application/octet-stream'))).toBe(true);
  });

  it('leaves every other file alone', () => {
    expect(looksHeic(file('a.jpg', 'image/jpeg'))).toBe(false);
    expect(looksHeic(file('a.png', 'image/png'))).toBe(false);
    expect(looksHeic(file('a.webp', 'image/webp'))).toBe(false);
    expect(looksHeic(file('photo', ''))).toBe(false);
    expect(looksHeic(file('a.jpg', ''))).toBe(false);
    expect(looksHeic(file('heic.jpg', 'image/jpeg'))).toBe(false);
    expect(looksHeic(file('my.heic.png', 'image/png'))).toBe(false);
  });
});

describe('names and sizes', () => {
  it('renames to .jpg', () => {
    expect(jpegName('IMG_0001.HEIC')).toBe('IMG_0001.jpg');
    expect(jpegName('a.b.heif')).toBe('a.b.jpg');
    expect(jpegName('noext')).toBe('noext.jpg');
  });

  it('keeps the size, scales down only above the pixel limit and never enlarges', () => {
    expect(targetSize(4032, 3024)).toEqual({ width: 4032, height: 3024 });
    expect(targetSize(100, 50)).toEqual({ width: 100, height: 50 });
    const big = targetSize(8000, 6000);
    expect(big.width * big.height).toBeLessThanOrEqual(MAX_JPEG_PIXELS);
    expect(big.width / big.height).toBeCloseTo(8000 / 6000, 2);
    expect(big.width).toBeLessThan(8000);
  });

  it("draws a 48 MP iPhone's 24 MP photo inside older iOS Safari's canvas area of 4096 × 4096", () => {
    const { width, height } = targetSize(5712, 4284);
    expect(width * height).toBeLessThanOrEqual(4096 * 4096);
    expect(Math.max(width, height)).toBeGreaterThan(1600);
  });
});

describe('uploadFailureMessage', () => {
  it('turns the API’s Unsupported image into the HEIC message for a HEIC-looking file only', () => {
    expect(uploadFailureMessage(file('a.heic'), 'Unsupported image')).toBe('upload.reason.heic');
    expect(uploadFailureMessage(file('a', 'image/heif'), 'Unsupported image')).toBe('upload.reason.heic');
    expect(uploadFailureMessage(file('a.png', 'image/png'), 'Unsupported image')).toBe('Unsupported image');
    expect(uploadFailureMessage(file('a.heic'), 'Choose an image under 12 MB')).toBe('Choose an image under 12 MB');
  });
});

function stub(options: { width?: number; height?: number; sizes?: number[]; decodeFails?: boolean; encodeNull?: boolean } = {}) {
  const close = vi.fn();
  const sizes = [...(options.sizes ?? [100])];
  const browser: HeicBrowser = {
    decode: vi.fn(async () => {
      if (options.decodeFails) throw new DOMException('cannot decode', 'InvalidStateError');
      return { width: options.width ?? 4000, height: options.height ?? 3000, close } satisfies Decoded;
    }),
    encode: vi.fn(async () => (options.encodeNull ? null : new Blob([new Uint8Array(sizes.length > 1 ? sizes.shift()! : sizes[0])], { type: 'image/jpeg' }))),
  };
  return { browser, close };
}

describe('convertHeic', () => {
  it('answers a JPEG file named .jpg, from the first quality that fits, and releases the photo', async () => {
    const s = stub();
    const original = file('IMG_0001.HEIC', 'image/heic');
    const result = await convertHeic(original, 1000, s.browser);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file).not.toBe(original);
    expect(result.file).toMatchObject({ name: 'IMG_0001.jpg', type: 'image/jpeg', lastModified: original.lastModified });
    expect(s.browser.encode).toHaveBeenCalledTimes(1);
    expect(s.browser.encode).toHaveBeenCalledWith(expect.anything(), 4000, 3000, JPEG_QUALITIES[0]);
    expect(s.close).toHaveBeenCalledTimes(1);
  });

  it('scales a photo above the pixel limit down before it is drawn', async () => {
    const s = stub({ width: 8000, height: 6000 });
    await convertHeic(file('a.heic'), 1000, s.browser);
    const [, width, height] = vi.mocked(s.browser.encode).mock.calls[0];
    expect(width * height).toBeLessThanOrEqual(MAX_JPEG_PIXELS);
  });

  it('lowers the quality until the result fits, and says tooLarge when nothing does', async () => {
    const fits = stub({ sizes: [5000, 900] });
    const result = await convertHeic(file('a.heic'), 1000, fits.browser);
    expect(result.ok).toBe(true);
    expect(vi.mocked(fits.browser.encode).mock.calls.map((call) => call[3])).toEqual([JPEG_QUALITIES[0], JPEG_QUALITIES[1]]);

    const never = stub({ sizes: [5000] });
    expect(await convertHeic(file('a.heic'), 1000, never.browser)).toEqual({ ok: false, reason: 'tooLarge' });
    expect(never.browser.encode).toHaveBeenCalledTimes(JPEG_QUALITIES.length);
    expect(never.close).toHaveBeenCalledTimes(1);
  });

  it('never answers with the original: a decode failure, an unusable photo or a missing encoder is unsupported', async () => {
    expect(await convertHeic(file('a.heic'), 1000, stub({ decodeFails: true }).browser)).toEqual({ ok: false, reason: 'unsupported' });
    expect(await convertHeic(file('a.heic'), 1000, stub({ width: 0 }).browser)).toEqual({ ok: false, reason: 'unsupported' });
    const noEncoder = stub({ encodeNull: true });
    expect(await convertHeic(file('a.heic'), 1000, noEncoder.browser)).toEqual({ ok: false, reason: 'unsupported' });
    expect(noEncoder.close).toHaveBeenCalledTimes(1);
    const throws: HeicBrowser = {
      decode: async () => ({ width: 10, height: 10, close: () => {} }),
      encode: async () => Promise.reject(new Error('canvas lost')),
    };
    expect(await convertHeic(file('a.heic'), 1000, throws)).toEqual({ ok: false, reason: 'unsupported' });
  });
});

describe('the browser decoder', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks for the upright photo and answers its size', async () => {
    const close = vi.fn();
    const create = vi.fn(async () => ({ width: 30, height: 20, close }));
    vi.stubGlobal('createImageBitmap', create);
    const photo = await browserHeic.decode(file('a.heic'));
    expect(create).toHaveBeenCalledWith(expect.any(File), { imageOrientation: 'from-image' });
    expect([photo.width, photo.height]).toEqual([30, 20]);
    photo.close();
    expect(close).toHaveBeenCalled();
  });

  it('retries without the option where it is a TypeError (older Safari), and fails where the photo cannot be decoded', async () => {
    const close = vi.fn();
    const create = vi.fn(async (_file: File, options?: unknown) => {
      if (options) throw new TypeError('bad enum');
      return { width: 30, height: 20, close };
    });
    vi.stubGlobal('createImageBitmap', create);
    expect((await browserHeic.decode(file('a.heic'))).width).toBe(30);
    expect(create).toHaveBeenCalledTimes(2);

    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new DOMException('no codec', 'InvalidStateError')));
    await expect(browserHeic.decode(file('a.heic'))).rejects.toThrow();
    vi.stubGlobal('createImageBitmap', undefined);
    await expect(browserHeic.decode(file('a.heic'))).rejects.toThrow();
  });
});
