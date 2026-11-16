import { describe, expect, it, vi } from 'vitest';
import { MAX_JPEG_PIXELS, type Decoded, type HeicBrowser } from './heic';
import { MAX_UPLOAD_PIXELS, fitFailureMessage, fitForUpload, headerSize } from './upload-fit';

const photo = (name = 'IMG_0001.JPG', type = 'image/jpeg') => new File([new Uint8Array(8)], name, { type, lastModified: 1_700_000_000_000 });
const sized = (width: number, height: number) => async () => ({ width, height });

function stub(width: number, height: number, bytes = 100) {
  const close = vi.fn();
  const browser: HeicBrowser = {
    decode: vi.fn(async () => ({ width, height, close }) satisfies Decoded),
    encode: vi.fn(async () => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' })),
  };
  return { browser, close };
}

describe('fitForUpload', () => {
  it('sends a photo of at most 24 MP, or one whose header states no size, as it is and decodes nothing', async () => {
    const s = stub(6000, 4000);
    const file = photo();
    expect(await fitForUpload(file, 1000, s.browser, sized(6000, 4000))).toEqual({ ok: true, file });
    expect(await fitForUpload(file, 1000, s.browser, async () => null)).toEqual({ ok: true, file });
    expect(s.browser.decode).not.toHaveBeenCalled();
  });

  it('redraws a 50 MP camera photo as a JPEG inside the API’s limit, upright from the decoder, and releases it', async () => {
    const s = stub(8160, 6144);
    const result = await fitForUpload(photo('PXL_0001.jpg'), 1000, s.browser, sized(6144, 8160));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file).toMatchObject({ name: 'PXL_0001.jpg', type: 'image/jpeg', lastModified: 1_700_000_000_000 });
    const [, width, height] = vi.mocked(s.browser.encode).mock.calls[0];
    expect(width * height).toBeLessThanOrEqual(Math.min(MAX_JPEG_PIXELS, MAX_UPLOAD_PIXELS));
    expect(width / height).toBeCloseTo(8160 / 6144, 2);
    expect(s.close).toHaveBeenCalledTimes(1);
  });

  it('renames another format to .jpg and refuses a photo the browser cannot scale or fit under the byte limit', async () => {
    const png = await fitForUpload(photo('scan.png', 'image/png'), 1000, stub(10_000, 10_000).browser, sized(10_000, 10_000));
    expect(png.ok && png.file.name).toBe('scan.jpg');
    const fails: HeicBrowser = { decode: () => Promise.reject(new Error('no decoder')), encode: async () => null };
    expect(await fitForUpload(photo(), 1000, fails, sized(10_000, 10_000))).toEqual({ ok: false, reason: 'unsupported' });
    expect(await fitForUpload(photo(), 10, stub(10_000, 10_000, 100).browser, sized(10_000, 10_000))).toEqual({ ok: false, reason: 'tooLarge' });
    expect(fitFailureMessage('unsupported')).toBe('errors.imageDimensions');
    expect(fitFailureMessage('tooLarge')).toBe('errors.imageTooBig');
  });
});

describe('headerSize', () => {
  it('reads the size from the start of the file and answers null for anything it cannot read', async () => {
    const header = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x1f, 0x40, 0, 0, 0x17, 0x70];
    expect(await headerSize(new Blob([Uint8Array.from(header)]))).toEqual({ width: 8000, height: 6000 });
    expect(await headerSize(new Blob(['not an image']))).toBeNull();
    const broken = { slice: () => ({ arrayBuffer: () => Promise.reject(new Error('gone')) }) } as unknown as Blob;
    expect(await headerSize(broken)).toBeNull();
  });
});
