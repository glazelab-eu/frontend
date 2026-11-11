import { createHash } from 'node:crypto';
import { encodeQr, QUIET_ZONE } from '../../src/lib/qr/qr';

/** The GS1 check digit of the first 12 (EAN-13) or 7 (EAN-8) digits. */
export function checkDigit(digits: string): string {
  const sum = [...digits].reverse().reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  return String((10 - (sum % 10)) % 10);
}

/** A valid EAN-13 of the in-store range (prefix 2, never a real product), derived from a text such as a test's uid. */
export function eanFor(seed: string): string {
  const digits = BigInt('0x' + createHash('sha256').update(seed).digest('hex').slice(0, 15))
    .toString()
    .slice(0, 11)
    .padStart(11, '0');
  return '2' + digits + checkDigit('2' + digits);
}

const L_CODES = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const R_CODES = L_CODES.map((code) => code.replace(/./g, (bit) => (bit === '0' ? '1' : '0')));
const G_CODES = R_CODES.map((code) => [...code].reverse().join(''));
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** The bars of an EAN-13 as modules ('1' is a bar). */
function eanModules(code: string): string {
  const parity = PARITY[Number(code[0])];
  let modules = '101';
  for (let index = 0; index < 6; index++) modules += (parity[index] === 'L' ? L_CODES : G_CODES)[Number(code[1 + index])];
  modules += '01010';
  for (let index = 0; index < 6; index++) modules += R_CODES[Number(code[7 + index])];
  return modules + '101';
}

/**
 * An EAN-13 as a still YUV4MPEG2 video for Chromium's fake camera (`--use-file-for-fake-video-capture`): the suite
 * scans through it and never reaches a real camera. A null code gives an empty frame for non-decoding checks.
 */
export function barcodeVideo(code: string | null): Buffer {
  const [width, height, module, quiet] = [640, 480, 5, 11];
  const modules = code ? eanModules(code) : '';
  const luma = Buffer.alloc(width * height, 255);
  const left = Math.floor((width - (modules.length + 2 * quiet) * module) / 2) + quiet * module;
  for (let row = 90; row < 390; row++)
    for (let index = 0; index < modules.length; index++)
      if (modules[index] === '1') luma.fill(0, row * width + left + index * module, row * width + left + (index + 1) * module);
  const chroma = Buffer.alloc((width / 2) * (height / 2), 128);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), luma, chroma, chroma]);
  return Buffer.concat([Buffer.from(`YUV4MPEG2 W${width} H${height} F10:1 Ip A1:1 C420jpeg\n`), ...Array<Buffer>(10).fill(frame)]);
}

/**
 * QR codes as a YUV4MPEG2 video for the fake camera (same rules as `barcodeVideo`): black modules on white, the quiet
 * zone of 4 modules, the largest whole number of pixels per module that fits. `frames` lists what each picture shows
 * (several texts are drawn side by side in one picture); the file loops, so two pictures alternate.
 */
export function qrVideoOf(frames: string[][], framesEach = 10): Buffer {
  const [width, height] = [640, 480];
  const chroma = Buffer.alloc((width / 2) * (height / 2), 128);
  const pictures = frames.map((texts) => {
    const cell = width / texts.length;
    const luma = Buffer.alloc(width * height, 255);
    texts.forEach((text, index) => {
      const matrix = encodeQr(text);
      const module = Math.floor(Math.min(cell, height) / (matrix.size + 2 * QUIET_ZONE));
      const left = Math.floor(index * cell + (cell - matrix.size * module) / 2);
      const top = Math.floor((height - matrix.size * module) / 2);
      for (let y = 0; y < matrix.size; y++)
        for (let x = 0; x < matrix.size; x++)
          if (matrix.modules[y * matrix.size + x])
            for (let row = 0; row < module; row++)
              luma.fill(0, (top + y * module + row) * width + left + x * module, (top + y * module + row) * width + left + (x + 1) * module);
    });
    return Buffer.concat([Buffer.from('FRAME\n'), luma, chroma, chroma]);
  });
  const all = pictures.flatMap((picture) => Array<Buffer>(framesEach).fill(picture));
  return Buffer.concat([Buffer.from(`YUV4MPEG2 W${width} H${height} F10:1 Ip A1:1 C420jpeg\n`), ...all]);
}

/** One QR code of a text as a still video for the fake camera. */
export const qrVideo = (text: string): Buffer => qrVideoOf([[text]]);
