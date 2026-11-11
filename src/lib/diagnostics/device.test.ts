import { describe, expect, it } from 'vitest';
import { collectDevice, parseUserAgent } from './device';

describe('parseUserAgent', () => {
  it.each([
    ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', 'Chrome', '141.0.0.0', 'Linux'],
    ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36', 'Chrome', '141.0.0.0', 'Linux'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36 Edg/141.0.3000.1', 'Edge', '141.0.3000.1', 'Windows'],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      'Safari',
      '17.4',
      'iOS',
    ],
    ['Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0', 'Firefox', '132.0', 'Android'],
  ])('reads %s', (ua, browser, version, os) => {
    expect(parseUserAgent(ua)).toMatchObject({ browser, browserVersion: version, os });
  });
  it('gives nothing for an unknown string, and never the string itself', () => {
    expect(parseUserAgent('curl/8')).toEqual({ browser: null, browserVersion: null, os: null, osVersion: null });
  });
});

describe('collectDevice', () => {
  const media = (on: string[]) => (query: string) => ({ matches: on.includes(query) });
  const env = (extra: object = {}, on: string[] = []) =>
    ({
      navigator: {
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/141.0.0.0 Safari/537.36',
        language: 'pt-PT',
        serviceWorker: { controller: {} },
        ...extra,
      },
      screen: { width: 1920, height: 1080 },
      innerWidth: 390.4,
      innerHeight: 800,
      devicePixelRatio: 2.625,
      matchMedia: media(on),
    }) as never;

  it('reports sizes, enums and flags, and only values the API accepts', () => {
    const info = collectDevice(
      true,
      false,
      env({ connection: { effectiveType: '4g' }, deviceMemory: 8 }, ['(pointer: coarse)', '(prefers-color-scheme: dark)', '(display-mode: standalone)']),
    );
    expect(info).toMatchObject({
      viewportWidth: 390,
      pixelRatio: 2.63,
      pointer: 'COARSE',
      colorScheme: 'DARK',
      standalone: true,
      online: false,
      updatePending: true,
      serviceWorker: 'ACTIVE',
      connection: '4g',
      deviceMemoryGb: 8,
      language: 'pt-PT',
      reducedMotion: false,
    });
  });

  it('marks missing support and drops odd values', () => {
    const e = env({ connection: { effectiveType: 'weird' }, language: 'x_y' });
    delete (e as { navigator: { serviceWorker?: unknown } }).navigator.serviceWorker;
    const info = collectDevice(false, true, e);
    expect(info).toMatchObject({ serviceWorker: 'UNSUPPORTED', connection: null, language: null, pointer: 'NONE', deviceMemoryGb: null });
  });
});
