import type { Page } from '@playwright/test';
import { decodeImage } from '../../src/lib/qr/qr-decode';

/** The pixels of a PNG as ZXing reads them, decoded by a blank page's canvas (the harness page's CSP forbids data: images). */
export async function decodePng(page: Page, png: Buffer): Promise<string[]> {
  const scratch = await page.context().newPage();
  try {
    const pixels = await scratch.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height);
      // The pixels travel as base64, not as a JSON array of numbers: a phone screenshot (scale 2) has millions of them, and
      // the array took most of a test's time limit on a loaded host.
      let binary = '';
      for (let start = 0; start < data.data.length; start += 0x8000) binary += String.fromCharCode(...data.data.subarray(start, start + 0x8000));
      return { width: data.width, height: data.height, data: btoa(binary) };
    }, png.toString('base64'));
    return await decodeImage({ ...pixels, data: new Uint8ClampedArray(Buffer.from(pixels.data, 'base64')), colorSpace: 'srgb' } as ImageData);
  } finally {
    await scratch.close();
  }
}

/** How a saved code looks, measured on its pixels: a print-ready picture is black on white with the whole quiet zone white. */
export async function pngLook(page: Page, png: Buffer): Promise<{ darkest: number; lightest: number; margin: number }> {
  const scratch = await page.context().newPage();
  try {
    return await scratch.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
      let darkest = 255;
      let lightest = 0;
      let margin = 0; // the rows from each edge that are pure white, the smallest of the four sides
      const white = (x: number, y: number) =>
        data[(y * width + x) * 4] === 255 &&
        data[(y * width + x) * 4 + 1] === 255 &&
        data[(y * width + x) * 4 + 2] === 255 &&
        data[(y * width + x) * 4 + 3] === 255;
      for (let i = 0; i < data.length; i += 4) {
        darkest = Math.min(darkest, data[i]);
        lightest = Math.max(lightest, data[i]);
      }
      const side = (at: (k: number, edge: number) => [number, number]) => {
        let n = 0;
        for (; n < width / 2; n++) {
          let all = true;
          for (let k = 0; k < width && all; k++) all = white(...at(k, n));
          if (!all) break;
        }
        return n;
      };
      margin = Math.min(
        side((k, n) => [k, n]),
        side((k, n) => [k, height - 1 - n]),
        side((k, n) => [n, k]),
        side((k, n) => [width - 1 - n, k]),
      );
      return { darkest, lightest, margin };
    }, png.toString('base64'));
  } finally {
    await scratch.close();
  }
}
