import { paintedPng, type Colour } from './images';

const WIDTH = 480;
const HEIGHT = 360;

/** Deterministic noise in [0, 1) for a pixel, so the speckles stay the same on every run. */
function noise(x: number, y: number, seed: number): number {
  let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

const mix = (a: Colour, b: Colour, amount: number): Colour => [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount];

/**
 * A test tile on a wooden table: a rounded tile whose glaze runs from `top` to `bottom` with a darker break at the edge and
 * `speckle` iron spots, lit from the upper left.
 */
export function testTile(name: string, top: Colour, bottom: Colour, speckle = 0.01, seed = 1) {
  const table: Colour = [201, 183, 160];
  const centre = { x: WIDTH / 2, y: HEIGHT / 2 };
  const half = { x: 150, y: 120 };
  const radius = 34;
  return paintedPng(name, WIDTH, HEIGHT, (x, y) => {
    const grain = Math.sin(y * 0.35 + Math.sin(x * 0.05 + seed) * 3) * 5;
    let colour: Colour = [table[0] + grain, table[1] + grain, table[2] + grain];
    const dx = Math.abs(x - centre.x) - (half.x - radius);
    const dy = Math.abs(y - centre.y) - (half.y - radius);
    const distance = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius;
    const shadow = Math.exp(-Math.max(distance - 4 + (x - centre.x) * 0.04, 0) / 14);
    colour = mix(colour, [90, 72, 56], Math.min(shadow * 0.45, 0.45) * (distance > 0 ? 1 : 0));
    if (distance <= 0) {
      const flow = (y - (centre.y - half.y)) / (2 * half.y);
      colour = mix(top, bottom, Math.min(Math.max(flow + Math.sin(x * 0.045 + seed) * Math.cos(y * 0.06 + seed * 2) * 0.13, 0), 1));
      const edge = Math.min(Math.max(1 + distance / 16, 0), 1);
      colour = mix(colour, [colour[0] * 0.62, colour[1] * 0.62, colour[2] * 0.66], edge * edge);
      const light = Math.exp(-(((x - 190) / 120) ** 2 + ((y - 120) / 70) ** 2)) * 38;
      colour = [colour[0] + light, colour[1] + light, colour[2] + light];
      if (noise(x, y, seed) < speckle) colour = mix(colour, [48, 32, 24], 0.8);
    }
    return colour.map((value) => Math.min(Math.max(value, 0), 255)) as Colour;
  });
}
