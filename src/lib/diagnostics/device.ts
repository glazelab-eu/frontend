import type { DeviceInfo } from '../generated/types.gen';

type Parsed = Pick<DeviceInfo, 'browser' | 'browserVersion' | 'os' | 'osVersion'>;

const clip = (value: string | undefined, max: number) => (value ? value.slice(0, max) : null);
const dotted = (version: string | undefined) => clip(version?.replace(/_/g, '.').replace(/[^A-Za-z0-9._-]/g, ''), 30);

/** Browser and operating system, with versions, from the user agent string (only the names and numbers are kept, never the string). */
export function parseUserAgent(ua: string): Parsed {
  const pick = (pattern: RegExp) => pattern.exec(ua)?.[1];
  let browser: [string, string | undefined] | null = null;
  const rules: [string, RegExp][] = [
    ['Edge', /\bEdg(?:e|A|iOS)?\/([\d.]+)/],
    ['Opera', /\bOPR\/([\d.]+)/],
    ['Samsung Internet', /\bSamsungBrowser\/([\d.]+)/],
    ['Firefox', /\b(?:Firefox|FxiOS)\/([\d.]+)/],
    ['Chrome', /\b(?:Headless)?(?:Chrome|CriOS)\/([\d.]+)/],
    ['Safari', /\bVersion\/([\d.]+).*\bSafari\//],
  ];
  for (const [name, pattern] of rules) {
    const version = pick(pattern);
    if (version) {
      browser = [name, version];
      break;
    }
  }
  let os: [string, string | undefined] | null = null;
  const systems: [string, RegExp | null][] = [
    ['Windows', /Windows NT ([\d.]+)/],
    ['Android', /Android ([\d.]+)/],
    ['iOS', /(?:iPhone|CPU) OS ([\d_]+)/],
    ['macOS', /Mac OS X ([\d_.]+)/],
    ['ChromeOS', /CrOS \S+ ([\d.]+)/],
    ['Linux', null],
  ];
  for (const [name, pattern] of systems) {
    if (pattern ? pattern.test(ua) : /Linux|X11/.test(ua)) {
      os = [name, pattern ? pick(pattern) : undefined];
      break;
    }
  }
  return { browser: browser?.[0] ?? null, browserVersion: dotted(browser?.[1]), os: os?.[0] ?? null, osVersion: dotted(os?.[1]) };
}

interface Environment {
  navigator: Navigator & { deviceMemory?: number; connection?: { effectiveType?: string }; standalone?: boolean; userAgentData?: { platform?: string } };
  screen: Pick<Screen, 'width' | 'height'>;
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio: number;
  matchMedia: (query: string) => { matches: boolean };
}

/**
 * The device facts of one report (nothing here identifies a person: sizes, names of the browser and system, settings). `updatePending`
 * comes from the app (the update notice), the rest is read at send time.
 */
export function collectDevice(updatePending: boolean, online: boolean, env: Environment = globalThis as unknown as Environment): DeviceInfo {
  const nav = env.navigator;
  const media = (query: string) => env.matchMedia(query).matches;
  const parsed = parseUserAgent(nav.userAgent ?? '');
  const platform = nav.userAgentData?.platform;
  const effectiveType = nav.connection?.effectiveType;
  return {
    ...parsed,
    os: parsed.os ?? (platform && /^[\p{L}\p{N} ._()/-]{1,40}$/u.test(platform) ? platform : null),
    screenWidth: Math.round(env.screen.width),
    screenHeight: Math.round(env.screen.height),
    viewportWidth: Math.round(env.innerWidth),
    viewportHeight: Math.round(env.innerHeight),
    pixelRatio: Math.round(env.devicePixelRatio * 100) / 100,
    pointer: media('(pointer: coarse)') ? 'COARSE' : media('(pointer: fine)') ? 'FINE' : 'NONE',
    language: /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/.test(nav.language ?? '') ? nav.language : null,
    standalone: media('(display-mode: standalone)') || nav.standalone === true,
    online,
    connection: effectiveType && ['slow-2g', '2g', '3g', '4g'].includes(effectiveType) ? effectiveType : null,
    serviceWorker: !('serviceWorker' in nav) ? 'UNSUPPORTED' : nav.serviceWorker.controller ? 'ACTIVE' : 'NONE',
    updatePending,
    reducedMotion: media('(prefers-reduced-motion: reduce)'),
    colorScheme: media('(prefers-color-scheme: dark)') ? 'DARK' : 'LIGHT',
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
    deviceMemoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
  };
}
