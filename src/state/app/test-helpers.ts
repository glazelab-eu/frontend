import { emptyBuddies } from '../../lib/buddies/buddies';
import { emptyAvailability } from '../../lib/stock/buddy-shelf';
import { afterEach, beforeEach, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { get } from 'svelte/store';
import { saveSnapshot } from '../../lib/offline/snapshots';
import { resetCsrf, TOO_MANY_REQUESTS } from '../../lib/api/client';
import { glaze as buildGlaze, imageInfo, stockItem } from '../../test/fixtures';
import { createAppController } from './app-controller';
import type { SyncView } from '../../lib/generated/types.gen';
import { flagsOf, type SyncState } from '../../lib/sync/lifecycle';

type Handler = (request: Request) => Response | Promise<Response>;

export const user = { id: 'u1', email: 'ana@example.test', displayName: 'Ana' };
export const glaze = buildGlaze({ barcodes: ['4006381333931'], addedBy: 'Ada' });
export const created: Handler = () => Response.json({ id: glaze.id, glaze, stock: [] });
export const stockEntry = stockItem();
export const image = imageInfo();
export const nginx = (status: number) => () =>
  new Response(`<html><body><h1>${status} Bad Gateway</h1></body></html>`, {
    status,
    headers: { 'Content-Type': 'text/html' },
  });
export const unreachable: Handler = () => Promise.reject(new TypeError('fetch failed'));
export const tooMany: Handler = () => Response.json({ error: TOO_MANY_REQUESTS }, { status: 429, headers: { 'Retry-After': '3' } });
/** A sync answer that asks for a full load (resync `CURSOR`), with the server's counts. */
export const resync = (overrides: Partial<SyncView> = {}): SyncView => ({
  format: 1,
  cursor: '1.1000',
  epoch: 'e1',
  resync: 'CURSOR',
  glazes: [],
  combinations: [],
  removedGlazeIds: [],
  removedCombinationIds: [],
  visibleGlazes: 1,
  visibleCombinations: 0,
  ...overrides,
});
/** The combination listing as the paged full load reads it: one page (any JSON, as the API's answer would be). */
export const listing = (combinations: readonly unknown[] | (() => readonly unknown[])) => (): Response =>
  Response.json({ combinations: typeof combinations === 'function' ? combinations() : combinations, next: null });
export const healthy: Record<string, Handler> = {
  'GET /api/auth/me': () => Response.json(user),
  'GET /api/glazes': () => Response.json([glaze]),
  // Every sync asks for a full load, so each load reads the listings below; `state/sync.test.ts` covers deltas.
  'GET /api/sync': () => Response.json(resync()),
  'GET /api/sync/combinations': listing([]),
  'GET /api/stock': () => Response.json([]),
  'GET /api/clubs': () => Response.json([]),
  'GET /api/favorites/counts': () => Response.json({ glazes: [], combinations: [] }),
  'GET /api/favorites': () => Response.json({ glazeIds: [], combinationIds: [] }),
  'GET /api/buddies': () => Response.json(emptyBuddies()),
  'GET /api/buddies/availability': () => Response.json([]),
  'GET /api/combinations/author-avatars': () => Response.json([]),
  'GET /api/feed/unread': () => Response.json({ unread: 0, newest: null }),
  'GET /api/auth/clear-cache': () => new Response(null, { status: 204 }),
};

/** The handlers of the current test, keyed `METHOD /path`; reset to `healthy` before each test. */
export const routes: Record<string, Handler> = {};
/** Cache names the code under test deleted (the `caches` stub records them). */
export const cachesDeleted: string[] = [];

/**
 * The shared setup of the controller tests: a fresh IndexedDB, a `localStorage` that remembers the
 * signed-in user, a snapshot with one glaze, a `caches` stub and a `fetch` answering from `routes`
 * (an unlisted request fails the test). Call once at the top of a test file.
 */
export function useMockApi() {
  beforeEach(async () => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('IDBKeyRange', IDBKeyRange);
    resetCsrf();
    vi.stubGlobal('history', { state: null, replaceState: vi.fn() });
    for (const key of Object.keys(routes)) delete routes[key];
    Object.assign(routes, healthy);
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    cachesDeleted.length = 0;
    vi.stubGlobal('caches', {
      delete: async (name: string) => {
        cachesDeleted.push(name);
        return true;
      },
    });
    vi.stubGlobal('fetch', async (request: Request) => {
      const url = new URL(request.url);
      const handler = routes[`${request.method} ${url.pathname}`];
      if (!handler) throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
      return handler(request);
    });
    // A previous session saved this user and a snapshot with one glaze.
    localStorage.setItem('glazelab:v1:lastUser', JSON.stringify(user));
    await saveSnapshot('u1', {
      glazes: [glaze],
      combinations: [],
      stock: [],
      clubs: [],
      clubMembers: {},
      buddies: emptyBuddies(),
      buddyAvailability: emptyAvailability(),
      favorites: { glazeIds: [], combinationIds: [] },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
}

/** A state with the five loading fields of the store before STATE-1b projected from its `sync` (`flagsOf`), for assertions written with them. */
export const flat = <T extends { sync: SyncState }>(state: T) => ({ ...state, ...flagsOf(state.sync) });

/** A controller that has finished one refresh. */
export async function loaded() {
  const app = createAppController();
  await app.refresh();
  return { app, state: get(app.state) };
}

/**
 * A `window`/`location`/`history` stub for routing tests: `history.state` follows `replaceState`
 * and `location.hash` its `href`; `events` receives the dispatched `hashchange` and `beforeunload`.
 */
export function stubBrowser(hash: string) {
  const events = new EventTarget();
  vi.stubGlobal('window', Object.assign(events, { scrollTo: vi.fn() }));
  vi.stubGlobal('location', { hash });
  const entry = {
    state: null as unknown,
    replaceState: vi.fn((state: unknown, _unused: string, href: string) => {
      entry.state = state;
      location.hash = href;
    }),
  };
  vi.stubGlobal('history', entry);
  vi.stubGlobal('navigator', { onLine: true });
  return { events, entry };
}

/**
 * A browser with a real session history for the tests of history entries: `pushState` adds an entry, `location.hash = …`
 * adds one and fires `hashchange` (like a link), `back()` and `forward()` move asynchronously (a microtask, as a browser's
 * traversal is queued) and fire `popstate`, and `hashchange` when the hash differs. `entries` is the whole list.
 */
export function stubSessionHistory(hash: string) {
  const events = new EventTarget();
  const entries: { state: unknown; hash: string }[] = [{ state: null, hash }];
  let index = 0;
  const at = () => entries[index];
  const move = (to: number) => {
    if (to < 0 || to >= entries.length) return;
    queueMicrotask(() => {
      const before = at().hash;
      index = to;
      events.dispatchEvent(new Event('popstate'));
      if (at().hash !== before) events.dispatchEvent(new Event('hashchange'));
    });
  };
  const session = {
    entries,
    get index() {
      return index;
    },
    get length() {
      return entries.length;
    },
    get state() {
      return at().state;
    },
    pushState: vi.fn((state: unknown, _unused: string, href: string) => {
      entries.splice(index + 1);
      entries.push({ state, hash: href.startsWith('#') ? href : href.split('#')[1] ? `#${href.split('#')[1]}` : at().hash });
      index++;
    }),
    replaceState: vi.fn((state: unknown, _unused: string, href: string) => {
      at().state = state;
      at().hash = href.startsWith('#') ? href : at().hash;
    }),
    back: vi.fn(() => move(index - 1)),
    forward: vi.fn(() => move(index + 1)),
  };
  vi.stubGlobal('window', Object.assign(events, { scrollTo: vi.fn() }));
  vi.stubGlobal('location', {
    get hash() {
      return at().hash;
    },
    set hash(value: string) {
      entries.splice(index + 1);
      entries.push({ state: null, hash: value });
      index++;
      queueMicrotask(() => events.dispatchEvent(new Event('hashchange')));
    },
    get href() {
      return `http://localhost/${at().hash}`;
    },
  });
  vi.stubGlobal('history', session);
  vi.stubGlobal('navigator', { onLine: true });
  return { events, session };
}
