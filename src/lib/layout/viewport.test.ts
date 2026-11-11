import { afterEach, describe, expect, it, vi } from 'vitest';
import { PHONE_QUERY, isPhone, phoneMedia } from './viewport';

/** A media query list that counts its change listeners. */
function mockMedia(matches: boolean) {
  const target = new EventTarget();
  let listeners = 0;
  const media = {
    matches,
    addEventListener: (...args: Parameters<EventTarget['addEventListener']>) => {
      listeners++;
      target.addEventListener(...args);
    },
    removeEventListener: (...args: Parameters<EventTarget['removeEventListener']>) => {
      listeners--;
      target.removeEventListener(...args);
    },
  };
  const matchMedia = vi.fn((_query: string) => media);
  vi.stubGlobal('matchMedia', matchMedia);
  return {
    matchMedia,
    listeners: () => listeners,
    resize(next: boolean) {
      media.matches = next;
      target.dispatchEvent(new Event('change'));
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('viewport', () => {
  it('uses the exclusive 720 px query', () => {
    expect(PHONE_QUERY).toBe('(width < 45em)');
  });

  it('reads the phone state now', () => {
    const { matchMedia } = mockMedia(true);
    expect(isPhone()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith(PHONE_QUERY);
    mockMedia(false);
    expect(isPhone()).toBe(false);
  });

  it('reports the initial value, then every change', () => {
    const media = mockMedia(false);
    const seen: boolean[] = [];
    phoneMedia((phone) => seen.push(phone));
    media.resize(true);
    media.resize(false);
    expect(seen).toEqual([false, true, false]);
  });

  it('removes its listener on cleanup', () => {
    const media = mockMedia(true);
    const seen: boolean[] = [];
    const stop = phoneMedia((phone) => seen.push(phone));
    expect(media.listeners()).toBe(1);
    stop();
    expect(media.listeners()).toBe(0);
    media.resize(false);
    expect(seen).toEqual([true]);
  });

  it('answers wide where matchMedia is missing', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(isPhone()).toBe(false);
    const seen: boolean[] = [];
    phoneMedia((phone) => seen.push(phone))();
    expect(seen).toEqual([false]);
  });
});
