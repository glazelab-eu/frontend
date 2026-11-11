/**
 * A minimal QR code encoder for links, run on the device: byte mode (UTF-8), error correction level M,
 * versions 1 to 10 (up to 213 bytes), all eight masks tried. No dependency and no network. The tests decode
 * every version with ZXing, the scanner library the app already ships (`qr.test.ts`).
 */

/** Thrown when the text does not fit the largest supported version; the message says by how much. */
export class QrTooLongError extends Error {
  constructor(readonly length: number) {
    super(`The text is ${length} bytes long; a QR code of this app holds at most ${MAX_BYTES}.`);
    this.name = 'QrTooLongError';
  }
}

/** The finished symbol: `modules[y * size + x]` is 1 for a dark module. The quiet zone is not part of it. */
export interface QrMatrix {
  size: number;
  version: number;
  modules: Uint8Array;
}

/** Quiet zone the standard asks for, in modules. */
export const QUIET_ZONE = 4;

// Level M, versions 1 to 10: error correction codewords per block, then [blocks, data codewords] per group.
const BLOCKS: readonly { ecc: number; groups: readonly (readonly [number, number])[] }[] = [
  { ecc: 10, groups: [[1, 16]] },
  { ecc: 16, groups: [[1, 28]] },
  { ecc: 26, groups: [[1, 44]] },
  { ecc: 18, groups: [[2, 32]] },
  { ecc: 24, groups: [[2, 43]] },
  { ecc: 16, groups: [[4, 27]] },
  { ecc: 18, groups: [[4, 31]] },
  {
    ecc: 22,
    groups: [
      [2, 38],
      [2, 39],
    ],
  },
  {
    ecc: 22,
    groups: [
      [3, 36],
      [2, 37],
    ],
  },
  {
    ecc: 26,
    groups: [
      [4, 43],
      [1, 44],
    ],
  },
];
// Centres of the alignment patterns per version (index 0 is version 1: none).
const ALIGNMENT: readonly (readonly number[])[] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

const dataCodewords = (version: number) => BLOCKS[version - 1].groups.reduce((sum, [count, size]) => sum + count * size, 0);
/** Bytes that fit a version: the mode and count header takes 12 bits (16 bit count from version 10). */
const capacity = (version: number) => dataCodewords(version) - (version < 10 ? 2 : 3);
export const MAX_BYTES = capacity(BLOCKS.length);

const bit = (value: number, index: number) => ((value >>> index) & 1) === 1;

function gfMultiply(x: number, y: number): number {
  let result = 0;
  for (let i = 7; i >= 0; i--) {
    result = (result << 1) ^ ((result >>> 7) * 0x11d);
    result ^= ((y >>> i) & 1) * x;
  }
  return result;
}

/** Reed-Solomon remainder of `data` over GF(256) for `degree` error correction codewords. */
function remainder(data: readonly number[], degree: number): number[] {
  const divisor: number[] = new Array<number>(degree).fill(0);
  divisor[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      divisor[j] = gfMultiply(divisor[j], root);
      if (j + 1 < degree) divisor[j] ^= divisor[j + 1];
    }
    root = gfMultiply(root, 2);
  }
  const result: number[] = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift()!;
    result.push(0);
    divisor.forEach((coefficient, i) => (result[i] ^= gfMultiply(coefficient, factor)));
  }
  return result;
}

/** Header, bytes, terminator and padding as data codewords. */
function dataBits(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const push = (value: number, count: number) => {
    for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  bytes.forEach((byte) => push(byte, 8));
  const total = dataCodewords(version) * 8;
  push(0, Math.min(4, total - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < total; pad ^= 0xec ^ 0x11) push(pad, 8);
  const words: number[] = [];
  for (let i = 0; i < bits.length; i += 8) words.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  return words;
}

/** Splits into blocks, appends each block's error correction and interleaves, as the standard lays it out. */
function codewords(words: readonly number[], version: number): number[] {
  const { ecc, groups } = BLOCKS[version - 1];
  const blocks: { data: number[]; ecc: number[] }[] = [];
  let offset = 0;
  for (const [count, size] of groups) {
    for (let i = 0; i < count; i++) {
      const data = words.slice(offset, offset + size);
      offset += size;
      blocks.push({ data, ecc: remainder(data, ecc) });
    }
  }
  const result: number[] = [];
  const longest = Math.max(...blocks.map((block) => block.data.length));
  for (let i = 0; i < longest; i++) blocks.forEach((block) => i < block.data.length && result.push(block.data[i]));
  for (let i = 0; i < ecc; i++) blocks.forEach((block) => result.push(block.ecc[i]));
  return result;
}

/** The drawing surface: `dark` holds the modules, `fixed` marks the function patterns the data must skip. */
class Grid {
  readonly dark: Uint8Array;
  readonly fixed: Uint8Array;
  constructor(readonly size: number) {
    this.dark = new Uint8Array(size * size);
    this.fixed = new Uint8Array(size * size);
  }
  private index = (x: number, y: number) => y * this.size + x;
  set(x: number, y: number, dark: boolean) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    this.dark[this.index(x, y)] = dark ? 1 : 0;
    this.fixed[this.index(x, y)] = 1;
  }
  get(x: number, y: number) {
    return this.dark[this.index(x, y)] === 1;
  }
  isFixed(x: number, y: number) {
    return this.fixed[this.index(x, y)] === 1;
  }
  flip(x: number, y: number) {
    this.dark[this.index(x, y)] ^= 1;
  }
}

function drawFunctionPatterns(grid: Grid, version: number) {
  const { size } = grid;
  for (let i = 0; i < size; i++) {
    grid.set(6, i, i % 2 === 0);
    grid.set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        grid.set(cx + dx, cy + dy, distance !== 2 && distance !== 4);
      }
    }
  }
  const centres = ALIGNMENT[version - 1];
  const last = centres.length - 1;
  centres.forEach((cx, i) => {
    centres.forEach((cy, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) grid.set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    });
  });
  drawFormat(grid, 0); // reserves the format area; the real mask is drawn last
  if (version >= 7) {
    let rest = version;
    for (let i = 0; i < 12; i++) rest = (rest << 1) ^ ((rest >>> 11) * 0x1f25);
    const bits = (version << 12) | rest;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      grid.set(a, b, bit(bits, i));
      grid.set(b, a, bit(bits, i));
    }
  }
}

/** Format information of level M (bits 00) with a mask, in both places, and the always dark module. */
function drawFormat(grid: Grid, mask: number) {
  const { size } = grid;
  let rest = mask;
  for (let i = 0; i < 10; i++) rest = (rest << 1) ^ ((rest >>> 9) * 0x537);
  const bits = ((mask << 10) | rest) ^ 0x5412;
  for (let i = 0; i <= 5; i++) grid.set(8, i, bit(bits, i));
  grid.set(8, 7, bit(bits, 6));
  grid.set(8, 8, bit(bits, 7));
  grid.set(7, 8, bit(bits, 8));
  for (let i = 9; i < 15; i++) grid.set(14 - i, 8, bit(bits, i));
  for (let i = 0; i < 8; i++) grid.set(size - 1 - i, 8, bit(bits, i));
  for (let i = 8; i < 15; i++) grid.set(8, size - 15 + i, bit(bits, i));
  grid.set(8, size - 8, true);
}

/** Places the codeword bits in the standard's zigzag over the columns, skipping the function patterns. */
function placeData(grid: Grid, words: readonly number[]) {
  const { size } = grid;
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - step : step;
        if (grid.isFixed(x, y) || index >= words.length * 8) continue;
        grid.dark[y * size + x] = bit(words[index >>> 3], 7 - (index & 7)) ? 1 : 0;
        index++;
      }
    }
  }
}

const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(grid: Grid, mask: number) {
  for (let y = 0; y < grid.size; y++) {
    for (let x = 0; x < grid.size; x++) if (!grid.isFixed(x, y) && MASKS[mask](x, y)) grid.flip(x, y);
  }
}

/** The standard's four penalty rules (runs, 2x2 blocks, finder-like patterns, dark balance). */
function penalty(grid: Grid): number {
  const { size } = grid;
  let result = 0;
  const lines: number[][] = [];
  for (let a = 0; a < size; a++) {
    lines.push(Array.from({ length: size }, (_, b) => (grid.get(b, a) ? 1 : 0)));
    lines.push(Array.from({ length: size }, (_, b) => (grid.get(a, b) ? 1 : 0)));
  }
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++;
      else {
        if (run >= 5) result += run - 2;
        run = 1;
      }
    }
    const text = line.join('');
    for (const pattern of ['10111010000', '00001011101']) {
      for (let at = text.indexOf(pattern); at >= 0; at = text.indexOf(pattern, at + 1)) result += 40;
    }
  }
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const colour = grid.get(x, y);
      if (colour === grid.get(x + 1, y) && colour === grid.get(x, y + 1) && colour === grid.get(x + 1, y + 1)) result += 3;
    }
  }
  const total = size * size;
  const darkCount = grid.dark.reduce((sum, value) => sum + value, 0);
  return result + (Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1) * 10;
}

/** Encodes `text` (UTF-8 bytes) at level M in the smallest version; throws `QrTooLongError` when none fits. */
export function encodeQr(text: string): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  let version = 1;
  while (version <= BLOCKS.length && bytes.length > capacity(version)) version++;
  if (version > BLOCKS.length) throw new QrTooLongError(bytes.length);
  const size = version * 4 + 17;
  const words = codewords(dataBits(bytes, version), version);
  const base = new Grid(size);
  drawFunctionPatterns(base, version);
  placeData(base, words);
  let best: Grid | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < MASKS.length; mask++) {
    const grid = new Grid(size);
    grid.dark.set(base.dark);
    grid.fixed.set(base.fixed);
    applyMask(grid, mask);
    drawFormat(grid, mask);
    const score = penalty(grid);
    if (score < bestScore) {
      best = grid;
      bestScore = score;
    }
  }
  return { size, version, modules: best!.dark };
}

/**
 * SVG path data for the dark modules, one rectangle per horizontal run, in module units with the quiet zone
 * added on every side; pair it with `viewBox="0 0 N N"` where N is `matrix.size + 2 * quiet`.
 */
export function qrPath(matrix: QrMatrix, quiet: number = QUIET_ZONE): string {
  const parts: string[] = [];
  for (let y = 0; y < matrix.size; y++) {
    for (let x = 0; x < matrix.size; x++) {
      if (!matrix.modules[y * matrix.size + x]) continue;
      let end = x;
      while (end + 1 < matrix.size && matrix.modules[y * matrix.size + end + 1]) end++;
      parts.push(`M${x + quiet} ${y + quiet}h${end - x + 1}v1h-${end - x + 1}z`);
      x = end;
    }
  }
  return parts.join('');
}
