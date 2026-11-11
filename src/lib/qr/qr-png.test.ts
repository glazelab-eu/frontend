import { describe, expect, it, vi } from 'vitest';
import { encodeQr, QUIET_ZONE } from './qr';
import { qrFileName } from './qr-file-name';
import { paintQr, qrPixelSize, REVOKE_AFTER_MS, saveQr } from './qr-png';

describe('qrFileName', () => {
  it('uses the kind alone without a name', () => {
    expect(qrFileName('buddy-link')).toBe('glazelab-buddy-link.png');
  });
  it('slugs a club name: accents dropped, runs of other characters become one hyphen', () => {
    expect(qrFileName('club-invite', '  Töpferei Ätna & Co. / Süd! ')).toBe('glazelab-club-invite-topferei-atna-co-sud.png');
  });
  it('leaves the slug out when the name has no Latin letters or digits', () => {
    expect(qrFileName('club-invite', '陶芸クラブ')).toBe('glazelab-club-invite.png');
  });
  it('cuts a long name at 40 characters without a trailing hyphen', () => {
    const name = qrFileName('club-invite', `${'a'.repeat(39)} bbbb`);
    expect(name).toBe(`glazelab-club-invite-${'a'.repeat(39)}.png`);
  });
});

describe('qrPixelSize', () => {
  it('is a whole number of pixels per module near 1024', () => {
    for (const size of [21, 25, 41, 57]) {
      const { scale, side } = qrPixelSize(size);
      const modules = size + 2 * QUIET_ZONE;
      expect(side).toBe(scale * modules);
      expect(Math.abs(side - 1024)).toBeLessThanOrEqual(modules / 2);
    }
    expect(qrPixelSize(21)).toEqual({ scale: 35, side: 1015 });
  });
  it('never drops below one pixel per module', () => {
    expect(qrPixelSize(21, 5).scale).toBe(1);
  });
});

describe('paintQr', () => {
  it('paints white, then the dark modules shifted by the quiet zone', () => {
    const matrix = encodeQr('https://glazelab.eu/#/buddy/abc');
    const { scale, side } = qrPixelSize(matrix.size);
    const rects: Array<[string, number[]]> = [];
    const context = {
      fillStyle: '',
      fillRect(...args: number[]) {
        rects.push([this.fillStyle, args]);
      },
    };
    paintQr(context, matrix, scale, side);
    expect(rects[0]).toEqual(['#ffffff', [0, 0, side, side]]);
    const dark = rects.slice(1);
    expect(dark.every(([colour]) => colour === '#000000')).toBe(true);
    const area = dark.reduce((sum, [, [, , w, h]]) => sum + w * h, 0);
    const modules = matrix.modules.reduce((sum, bit) => sum + bit, 0);
    expect(area).toBe(modules * scale * scale);
    const [, [x, y]] = dark[0];
    expect(x).toBeGreaterThanOrEqual(QUIET_ZONE * scale);
    expect(y).toBe(QUIET_ZONE * scale);
  });
});

describe('saveQr', () => {
  const png = new Blob(['x'], { type: 'image/png' });
  function env(nav: Partial<Navigator>, coarse: boolean) {
    const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    const document = { createElement: vi.fn(() => anchor), body: { append: vi.fn() } };
    const url = { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() };
    return { anchor, url, env: { navigator: nav as Navigator, document: document as unknown as Document, url: url as unknown as typeof URL, coarse } };
  }

  it('downloads through an object URL that is revoked a while later (WebKit aborts a download whose URL went at once)', async () => {
    vi.useFakeTimers();
    try {
      const { anchor, url, env: e } = env({}, false);
      expect(await saveQr(png, 'f.png', e)).toBe('downloaded');
      expect(anchor.download).toBe('f.png');
      expect(anchor.href).toBe('blob:x');
      expect(anchor.click).toHaveBeenCalledOnce();
      expect(url.revokeObjectURL).not.toHaveBeenCalled();
      vi.advanceTimersByTime(REVOKE_AFTER_MS);
      expect(url.revokeObjectURL).toHaveBeenCalledWith('blob:x');
    } finally {
      vi.useRealTimers();
    }
  });
  it('shares the file on a coarse pointer when the device can', async () => {
    const share = vi.fn(async () => {});
    const { url, env: e } = env({ share, canShare: () => true }, true);
    expect(await saveQr(png, 'f.png', e)).toBe('shared');
    expect((share.mock.calls[0] as unknown as [{ files: File[] }])[0].files[0].name).toBe('f.png');
    expect(url.createObjectURL).not.toHaveBeenCalled();
  });
  it('downloads on a fine pointer even when sharing files would work', async () => {
    const share = vi.fn();
    expect(await saveQr(png, 'f.png', env({ share, canShare: () => true }, false).env)).toBe('downloaded');
    expect(share).not.toHaveBeenCalled();
  });
  it('does nothing more after a cancelled share sheet, and downloads after another refusal', async () => {
    const abort = vi.fn(async () => {
      throw new DOMException('x', 'AbortError');
    });
    expect(await saveQr(png, 'f.png', env({ share: abort, canShare: () => true }, true).env)).toBe('cancelled');
    const refuse = vi.fn(async () => {
      throw new DOMException('x', 'NotAllowedError');
    });
    expect(await saveQr(png, 'f.png', env({ share: refuse, canShare: () => true }, true).env)).toBe('downloaded');
  });
  it('downloads when files cannot be shared', async () => {
    expect(await saveQr(png, 'f.png', env({ share: vi.fn(), canShare: () => false }, true).env)).toBe('downloaded');
  });
});
