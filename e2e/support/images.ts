import { crc32, deflateSync } from 'node:zlib';

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export type Colour = [number, number, number];

/** A PNG painted pixel by pixel, built in memory so the repository holds no binary fixtures. */
export function paintedPng(name: string, width: number, height: number, paint: (x: number, y: number) => Colour) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB, no interlace
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const start = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) raw.set(paint(x, y).map(Math.round), start + 1 + x * 3);
  }
  const pixels = deflateSync(raw);
  const buffer = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', pixels),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return { name, mimeType: 'image/png', buffer };
}

/** The start of a PNG that states a size (signature and header chunk) and has no picture data: for what is decided from the header alone. */
export function pngHeaderOnly(name: string, width: number, height: number) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const buffer = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header)]);
  return { name, mimeType: 'image/png', buffer };
}

/** A small PNG of one colour. */
export function png(name: string, colour: Colour = [96, 140, 120], width = 64, height = 48) {
  return paintedPng(name, width, height, () => colour);
}

/**
 * A camera-sized photo (smooth shading with sensor-like noise, deterministic), larger than the API's card
 * size, so its card copy is a fraction of the full size.
 */
export function photoPng(name: string, width = 1600, height = 1200) {
  let seed = 7;
  const grain = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) | 0;
    return ((seed >>> 16) & 0xff) / 255 - 0.5;
  };
  return paintedPng(name, width, height, (x, y) => {
    const shade = Math.sin(x / 90) * Math.cos(y / 70) * 40;
    return [150 + (60 * x) / width + shade + grain() * 14, 120 + (50 * y) / height - shade / 2 + grain() * 14, 90 + shade / 3 + grain() * 14].map((value) =>
      Math.min(Math.max(value, 0), 255),
    ) as Colour;
  });
}

/**
 * A 240 px square of 6 x 6 blocks in colours drawn from a seed: different seeds give clearly different pictures (a site admin's
 * removal blocks a picture and its close copies for every later upload of the run, so a test that may have it removed never shares one).
 */
export function seededPicture(seed: string, name = 'picture.png') {
  let state = 0;
  for (const char of seed) state = (Math.imul(state, 31) + char.charCodeAt(0)) | 0;
  const next = () => {
    state = (Math.imul(state ^ (state >>> 15), 2246822507) + 3266489909) | 0;
    return (state >>> 8) & 0xff;
  };
  const blocks = Array.from({ length: 36 }, () => [next(), next(), next()] as Colour);
  return paintedPng(name, 240, 240, (x, y) => blocks[Math.floor(y / 40) * 6 + Math.floor(x / 40)]);
}
