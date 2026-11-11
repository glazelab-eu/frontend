import { describe, expect, it } from 'vitest';
import type { HeicBrowser } from '../images/heic';
import {
  MAX_FEEDBACK_LENGTH,
  MAX_FEEDBACK_PHOTO_BYTES,
  deviceClass,
  emptyFeedbackDraft,
  feedbackContext,
  isEmptyDraft,
  messageProblem,
  photoProblem,
  preparePhoto,
  shrunkSize,
} from './feedback';

const file = (type: string, size = 10, name = 'photo') => ({ type, size, name });

describe('feedback context', () => {
  it('names the device class by phone width first, then the pointer', () => {
    expect(deviceClass(true, true)).toBe('PHONE');
    expect(deviceClass(true, false)).toBe('PHONE');
    expect(deviceClass(false, true)).toBe('TABLET');
    expect(deviceClass(false, false)).toBe('DESKTOP');
  });

  it('carries the route name only, never anything that is not a plain name', () => {
    const base = { build: '0.1.0 (abc)', language: 'pt-PT', phone: false, coarse: false };
    expect(feedbackContext({ ...base, route: 'error-reports' })).toEqual({
      route: 'error-reports',
      build: '0.1.0 (abc)',
      language: 'pt-PT',
      device: 'DESKTOP',
    });
    expect(feedbackContext({ ...base, route: '#/glazes/1?token=x' }).route).toBe('unknown');
    expect(feedbackContext({ ...base, route: 'Stock' }).route).toBe('unknown');
  });
});

describe('feedback draft', () => {
  it('needs text within the limit, counted after trimming', () => {
    expect(messageProblem('   ')).toBe('feedback.problem.empty');
    expect(messageProblem(` ${'x'.repeat(MAX_FEEDBACK_LENGTH)} `)).toBeNull();
    expect(messageProblem('x'.repeat(MAX_FEEDBACK_LENGTH + 1))).toBe('feedback.problem.tooLong');
  });

  it('is empty without text and photos, and starts with the context attached', () => {
    expect(emptyFeedbackDraft()).toEqual({ message: '', photos: [], withContext: true });
    expect(isEmptyDraft({ ...emptyFeedbackDraft(), message: '  ' })).toBe(true);
    expect(isEmptyDraft({ ...emptyFeedbackDraft(), photos: [new File(['x'], 'a.jpg')] })).toBe(false);
  });

  it('refuses a fourth photo, files that are no image and empty or huge files', () => {
    expect(photoProblem(file('image/png'), 2)).toBeNull();
    expect(photoProblem(file('image/png'), 3)).toBe('feedback.problem.tooManyPhotos');
    expect(photoProblem(file('application/pdf'), 0)).toBe('feedback.problem.notImage');
    expect(photoProblem(file('', 10, 'IMG_1.HEIC'), 0)).toBeNull();
    expect(photoProblem(file('image/jpeg', 0), 0)).toBe('feedback.problem.photoTooLarge');
    expect(photoProblem(file('image/jpeg', 40_000_001), 0)).toBe('feedback.problem.photoTooLarge');
  });
});

describe('preparePhoto', () => {
  const browser = (width: number, height: number, sizes: number[]) => {
    const drawn: { width: number; height: number; quality: number }[] = [];
    let closed = 0;
    const fake: HeicBrowser = {
      decode: async () => ({ width, height, close: () => closed++ }),
      encode: async (_photo, w, h, quality) => {
        drawn.push({ width: w, height: h, quality });
        const size = sizes.shift() ?? 0;
        return size ? new Blob([new Uint8Array(size)], { type: 'image/jpeg' }) : null;
      },
    };
    return { fake, drawn, closed: () => closed };
  };

  it('scales to 1600 px on the long side, never up', () => {
    expect(shrunkSize(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(shrunkSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('answers a JPEG that fits, trying lower qualities, and always releases the decoded photo', async () => {
    const { fake, drawn, closed } = browser(3200, 1600, [MAX_FEEDBACK_PHOTO_BYTES + 1, 1000]);
    const result = await preparePhoto(new File(['x'], 'IMG.png', { type: 'image/png' }), fake);
    expect(result.ok && result.file.type).toBe('image/jpeg');
    expect(result.ok && result.file.name).toBe('photo.jpg');
    expect(drawn.map(({ width, height }) => [width, height])).toEqual([
      [1600, 800],
      [1600, 800],
    ]);
    expect(closed()).toBe(1);
  });

  it('refuses a photo the browser cannot read or that stays too large, never sending the original', async () => {
    const unreadable: HeicBrowser = { decode: () => Promise.reject(new Error('no')), encode: async () => null };
    expect(await preparePhoto(new File(['x'], 'a.heic'), unreadable)).toEqual({ ok: false, reason: 'feedback.problem.unreadable' });
    const big = MAX_FEEDBACK_PHOTO_BYTES + 1;
    expect(await preparePhoto(new File(['x'], 'a.png'), browser(100, 100, [big, big, big]).fake)).toEqual({
      ok: false,
      reason: 'feedback.problem.photoTooLarge',
    });
    expect(await preparePhoto(new File(['x'], 'a.png'), browser(100, 100, []).fake)).toEqual({ ok: false, reason: 'feedback.problem.unreadable' });
  });
});
