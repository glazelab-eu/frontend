import { describe, expect, it } from 'vitest';
import { encodeQr, MAX_BYTES, QrTooLongError, qrPath } from './qr';
import { decodeImage, decodeMatrix, renderGray } from './qr-decode';

const token = 'Zk3-_Q0aB9xT7mWvY1rLcE5uHnJdPoS2gIiKfA6hMqU'; // 43 characters, the URL-safe alphabet of the app's tokens
const buddy = `https://glazelab.eu/#/buddy/${token}`;
const invite = `https://glazelab.eu/#/invite/${token}`;

describe('encodeQr', () => {
  it('uses 43 characters for the tokens of the vectors', () => {
    expect(token).toHaveLength(43);
  });

  it.each([
    ['a buddy link', buddy],
    ['an invite link', invite],
    ['a local development link', `http://localhost:5173/#/invite/${token}`],
    ['a short text', 'https://glazelab.eu'],
    ['non-ASCII text (UTF-8)', 'https://glazelab.eu/#/buddy/Zoë-Ångström-日本'],
  ])('encodes %s so that ZXing reads it back', async (_name, text) => {
    expect(await decodeMatrix(encodeQr(text))).toEqual([text]);
  });

  it('reads back at every version, from the first to the largest', async () => {
    const versions = new Set<number>();
    for (const length of [1, 14, 15, 26, 27, 42, 43, 62, 63, 84, 85, 106, 107, 122, 123, 152, 153, 180, 181, 213]) {
      const text = Array.from({ length }, (_, i) => String.fromCharCode(97 + ((i * 7 + length) % 26))).join('');
      const matrix = encodeQr(text);
      versions.add(matrix.version);
      expect(matrix.size).toBe(matrix.version * 4 + 17);
      expect(await decodeMatrix(matrix), `${length} bytes at version ${matrix.version}`).toEqual([text]);
    }
    expect([...versions].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('picks the smallest version that holds the text', () => {
    expect(encodeQr('x'.repeat(14)).version).toBe(1);
    expect(encodeQr('x'.repeat(15)).version).toBe(2);
    expect(encodeQr(buddy).version).toBe(5); // 73 bytes
  });

  it('is deterministic', () => {
    expect(encodeQr(buddy).modules).toEqual(encodeQr(buddy).modules);
  });

  it('survives damage up to the correction level (about 15 % of the codewords)', async () => {
    const matrix = encodeQr(buddy);
    const damaged = { ...matrix, modules: matrix.modules.slice() };
    // Blank a 6 x 6 patch of data modules away from the finder patterns (about 6 % of the symbol).
    for (let y = 24; y < 30; y++) for (let x = 24; x < 30; x++) damaged.modules[y * matrix.size + x] ^= 1;
    expect(await decodeMatrix(damaged)).toEqual([buddy]);
  });

  it('reads at a small scale (3 pixels per module)', async () => {
    expect(await decodeImage(renderGray(encodeQr(buddy), 3))).toEqual([buddy]);
  });

  it('refuses a text that does not fit, saying how long it is', () => {
    expect(() => encodeQr('x'.repeat(MAX_BYTES + 1))).toThrow(QrTooLongError);
    expect(() => encodeQr('x'.repeat(MAX_BYTES + 1))).toThrow(`${MAX_BYTES + 1} bytes`);
    expect(() => encodeQr('é'.repeat(MAX_BYTES))).toThrow(QrTooLongError); // counted in UTF-8 bytes
    expect(encodeQr('x'.repeat(MAX_BYTES)).version).toBe(10);
  });

  it('keeps the function patterns: finders, timing and the dark module', () => {
    const { size, modules } = encodeQr(buddy);
    const at = (x: number, y: number) => modules[y * size + x];
    for (const [x, y] of [
      [0, 0],
      [size - 7, 0],
      [0, size - 7],
    ]) {
      expect(at(x, y)).toBe(1);
      expect(at(x + 3, y + 3)).toBe(1);
      expect(at(x + 1, y + 1)).toBe(0);
    }
    for (let i = 8; i < size - 8; i++) expect(at(i, 6)).toBe(i % 2 === 0 ? 1 : 0);
    expect(at(8, size - 8)).toBe(1);
  });
});

describe('qrPath', () => {
  it('draws every dark module once, shifted by the quiet zone', () => {
    const matrix = encodeQr(buddy);
    const path = qrPath(matrix);
    const cells = new Set<string>();
    for (const [, x, y, w] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
      for (let i = 0; i < Number(w); i++) cells.add(`${Number(x) + i - 4},${Number(y) - 4}`);
    }
    const dark = matrix.modules.reduce((sum, value) => sum + value, 0);
    expect(cells.size).toBe(dark);
    expect(path.replace(/M\d+ \d+h\d+v1h-\d+z/g, '')).toBe('');
    expect(qrPath(matrix, 0).startsWith('M0 0h7')).toBe(true);
  });
});
