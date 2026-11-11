import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AVATAR_404_LIMIT, AVATAR_404_WINDOW_MS, avatarIdsConfirmed, forgetLoadedImages, imageUrl, networkReachable, onAvatarGone } from './offline';

/** Profile pictures in the image cache (31-3): a 404 is never asked twice, stale IDs are not downloaded, a burst of 404s stops downloads. */
let requested: string[];
let answers: Record<string, number>;
let saved: Map<string, Response>;

beforeEach(() => {
  forgetLoadedImages();
  requested = [];
  answers = {};
  saved = new Map();
  vi.stubGlobal('caches', {
    has: async () => false,
    open: async () => ({
      keys: async () => [...saved.keys()].map((url) => new Request(url)),
      delete: async (request: Request) => saved.delete(request.url),
      match: async (url: string) => saved.get(`http://localhost${url}`)?.clone(),
      put: async (url: string, response: Response) => saved.set(`http://localhost${url}`, response),
    }),
  });
  vi.stubGlobal('fetch', async (request: Request) => {
    const path = new URL(request.url).pathname;
    requested.push(path);
    const id = path.split('/')[3];
    const status = answers[id] ?? 200;
    return status === 200 ? new Response(new Blob(['jpeg'], { type: 'image/jpeg' })) : Response.json({ error: 'Profile picture not found' }, { status });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  networkReachable.set(true);
  avatarIdsConfirmed.set(true);
  onAvatarGone(undefined);
});

const small = (id: string) => `/api/avatars/${id}/small`;
async function shown(url: string) {
  const object = await imageUrl(url, 'user-1');
  if (object) URL.revokeObjectURL(object);
  return object;
}

describe('a profile picture that answered 404', () => {
  it('is never asked for again in the session, by any view or size', async () => {
    answers.gone = 404;
    expect(await shown(small('gone'))).toBeNull();
    expect(await shown(small('gone'))).toBeNull();
    expect(await shown('/api/avatars/gone')).toBeNull();
    expect(await shown(small('gone'))).toBeNull();
    expect(requested).toEqual([small('gone')]);
  });

  it('costs one request for sixty cards that show the same author at once', async () => {
    answers.gone = 404;
    const views = await Promise.all(Array.from({ length: 60 }, () => shown(small('gone'))));
    expect(views.every((view) => view === null)).toBe(true);
    expect(requested).toEqual([small('gone')]);
  });

  it('downloads a picture that works once for sixty cards, whatever the order', async () => {
    const views = await Promise.all(Array.from({ length: 60 }, () => shown(small('ok'))));
    expect(views.every((view) => view?.startsWith('blob:'))).toBe(true);
    expect(requested).toEqual([small('ok')]);
  });

  it('drops both saved sizes, and is forgotten with the session (sign-out, another account)', async () => {
    saved.set(`http://localhost${small('gone')}`, new Response('jpeg'));
    saved.set('http://localhost/api/avatars/gone', new Response('jpeg'));
    answers.gone = 404;
    expect(await shown('/api/avatars/gone/small')).toMatch(/^blob:/);
    expect(requested).toEqual([]);
    saved.clear();
    forgetLoadedImages();
    expect(await shown(small('gone'))).toBeNull();
    expect(await shown(small('gone'))).toBeNull();
    expect(requested).toEqual([small('gone')]);
    forgetLoadedImages();
    answers.gone = 200;
    expect(await shown(small('gone'))).toMatch(/^blob:/);
  });

  it('tells the app once, so it reads the lists that name pictures again', async () => {
    const gone = vi.fn();
    onAvatarGone(gone);
    answers.gone = 404;
    await Promise.all([shown(small('gone')), shown(small('gone')), shown('/api/avatars/gone')]);
    await shown(small('gone'));
    expect(gone).toHaveBeenCalledTimes(1);
  });

  it('is not remembered after a 429, a 5xx or an unreachable server (they say nothing about the picture)', async () => {
    answers.busy = 429;
    answers.broken = 503;
    expect(await shown(small('busy'))).toBeNull();
    expect(await shown(small('busy'))).toBeNull();
    expect(await shown(small('broken'))).toBeNull();
    expect(await shown(small('broken'))).toBeNull();
    expect(requested).toEqual([small('busy'), small('busy'), small('broken'), small('broken')]);
  });
});

describe('a burst of 404s', () => {
  it('stops new downloads for a while, then lets them through again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const ids = Array.from({ length: AVATAR_404_LIMIT }, (_, index) => `gone${index}`);
    for (const id of ids) answers[id] = 404;
    for (const id of ids) await shown(small(id));
    expect(requested).toHaveLength(AVATAR_404_LIMIT);
    // Another ID is not even asked for.
    expect(await shown(small('fresh'))).toBeNull();
    expect(requested).toHaveLength(AVATAR_404_LIMIT);
    vi.setSystemTime(Date.now() + AVATAR_404_WINDOW_MS + 1000);
    expect(await shown(small('fresh'))).toMatch(/^blob:/);
    expect(requested).toHaveLength(AVATAR_404_LIMIT + 1);
  });

  it('still shows saved copies and this session’s downloads', async () => {
    saved.set(`http://localhost${small('kept')}`, new Response('jpeg'));
    expect(await shown(small('ok'))).toMatch(/^blob:/);
    const ids = Array.from({ length: AVATAR_404_LIMIT }, (_, index) => `gone${index}`);
    for (const id of ids) answers[id] = 404;
    for (const id of ids) await shown(small(id));
    expect(await shown(small('kept'))).toMatch(/^blob:/);
    expect(await shown(small('ok'))).toMatch(/^blob:/);
  });

  it('does not count photos', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ error: 'Image not found' }, { status: 404 }));
    for (let index = 0; index < AVATAR_404_LIMIT + 2; index++) await shown(`/api/images/i${index}/card`);
    answers.fresh = 200;
    vi.stubGlobal('fetch', async (request: Request) => {
      requested.push(new URL(request.url).pathname);
      return new Response(new Blob(['jpeg'], { type: 'image/jpeg' }));
    });
    expect(await shown(small('fresh'))).toMatch(/^blob:/);
  });
});

describe('profile picture IDs that may be stale (the saved snapshot, before a load confirmed them)', () => {
  it('are not downloaded, and show a saved size of the same picture', async () => {
    avatarIdsConfirmed.set(false);
    expect(await shown(small('a1'))).toBeNull();
    expect(requested).toEqual([]);
    saved.set('http://localhost/api/avatars/a1', new Response('jpeg'));
    expect(await shown(small('a1'))).toMatch(/^blob:/);
    expect(requested).toEqual([]);
    saved.set(`http://localhost${small('a1')}`, new Response('jpeg'));
    expect(await shown(small('a1'))).toMatch(/^blob:/);
  });

  it('are downloaded once the IDs are confirmed', async () => {
    avatarIdsConfirmed.set(false);
    expect(await shown(small('a1'))).toBeNull();
    avatarIdsConfirmed.set(true);
    expect(await shown(small('a1'))).toMatch(/^blob:/);
    expect(requested).toEqual([small('a1')]);
  });

  it('do not hold photos back', async () => {
    avatarIdsConfirmed.set(false);
    expect(await shown('/api/images/i1/card')).toMatch(/^blob:/);
    expect(requested).toEqual(['/api/images/i1/card']);
  });
});
