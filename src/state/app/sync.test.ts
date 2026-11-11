import { emptyBuddies } from '../../lib/buddies/buddies';
import { emptyAvailability } from '../../lib/stock/buddy-shelf';
import { describe, expect, it, vi } from 'vitest';
import { IDBObjectStore } from 'fake-indexeddb';
import { get } from 'svelte/store';
import type { Combination } from '../../lib/api/models';
import type { SyncView } from '../../lib/generated/types.gen';
import { listingOf } from '../../lib/explore/listing';
import { deleteSnapshot, readFirstSync, readSaved, saveFirstSyncPage, saveSnapshot } from '../../lib/offline/snapshots';
import { findItem } from '../../lib/routing/routes';
import { CLIENT_FORMAT, PAGE_SIZE, RESUME_SYNC_MS, type SyncPoint } from '../../lib/sync/sync';
import { progressOf } from '../../lib/sync/lifecycle';
import { combination, glaze as buildGlaze, glazeStep } from '../../test/fixtures';
import { createAppController } from './app-controller';
import { flat, glaze, resync, routes, stubBrowser, unreachable, useMockApi, user } from './test-helpers';

useMockApi();

const point: SyncPoint = { cursor: '5.1000', epoch: 'e1', format: 1, client: CLIENT_FORMAT };
const empty = {
  stock: [],
  clubs: [],
  clubMembers: {},
  buddies: emptyBuddies(),
  buddyAvailability: emptyAvailability(),
  favorites: { glazeIds: [], combinationIds: [] },
};
const older = combination({ id: 'c1', title: 'Older', publishedAt: '2026-10-01T10:00:00Z' });
const newer = combination({ id: 'c2', title: 'Newer', publishedAt: '2026-10-20T10:00:00Z' });

/** The device saved u1's listings at `point` (one glaze, two combinations). */
const savedListings = (combinations: Combination[] = [newer, older], at: SyncPoint | null = point) =>
  saveSnapshot('u1', { glazes: [glaze], combinations, ...empty }, at);

/** A delta answer at the next cursor, with counts that fit `glazes`/`combinations` after applying. */
function delta(overrides: Partial<SyncView> = {}): SyncView {
  return resync({ resync: null, cursor: '7.2000', visibleGlazes: 1, visibleCombinations: 2, ...overrides });
}

/** Records every request of `key` (its query) and answers with `answer`. */
function recorded(key: string, answer: (url: URL) => Response | Promise<Response>) {
  const queries: URLSearchParams[] = [];
  routes[key] = (request) => {
    const url = new URL(request.url);
    queries.push(url.searchParams);
    return answer(url);
  };
  return queries;
}

/** A request that waits until `release` is called. */
function held(key: string, answer: () => Response) {
  let release = () => {};
  const started = new Promise<void>((begin) => {
    routes[key] = () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(answer());
        begin();
      });
  });
  return { started, release: () => release() };
}

const page = (combinations: Combination[], next: string | null) => Response.json({ combinations, next });

describe('instant start', () => {
  it('shows the saved snapshot of the same account before the server answers, then applies the delta in place', async () => {
    await savedListings();
    const added = combination({ id: 'c3', title: 'Added', publishedAt: '2026-10-25T10:00:00Z' });
    const me = held('GET /api/auth/me', () => Response.json(user));
    const syncs = recorded('GET /api/sync', () => Response.json(delta({ combinations: [added], visibleCombinations: 3 })));
    const pages = recorded('GET /api/sync/combinations', () => page([], null));
    const glazes = recorded('GET /api/glazes', () => Response.json([glaze]));
    const app = createAppController();
    const loading = app.refresh();
    await me.started;
    // Before /me answers: the snapshot, no loading state, and a load running over it.
    expect(flat(get(app.state))).toMatchObject({ user, loading: false, syncing: true, glazes: [glaze] });
    expect(get(app.state).combinations.map((item) => item.id)).toEqual(['c2', 'c1']);
    const shown = get(app.state).combinations;
    me.release();
    await loading;
    expect(flat(get(app.state))).toMatchObject({ loading: false, syncing: false, loadFailed: false, online: true });
    expect(get(app.state).combinations.map((item) => item.id)).toEqual(['c3', 'c2', 'c1']);
    // Unchanged items keep their objects: the list updates in place.
    expect(get(app.state).combinations[1]).toBe(shown[0]);
    expect(syncs.map((query) => Object.fromEntries(query))).toEqual([{ since: '5.1000', epoch: 'e1', format: '1' }]);
    expect(pages).toHaveLength(0);
    expect(glazes).toHaveLength(0);
    expect((await readSaved('u1'))?.point).toEqual({ ...point, cursor: '7.2000' });
    expect((await readSaved('u1'))?.snapshot.combinations.map((item) => item.id)).toEqual(['c3', 'c2', 'c1']);
  });

  describe('a deep-linked item the shown snapshot lacks (STATE-1b: the restore and the refresh are one patch)', () => {
    const added = combination({ id: 'c3', title: 'Added', publishedAt: '2026-10-25T10:00:00Z' });
    /** Every update's answer for the deep-linked `c3` while `run` loads: never "missing" before the load that brings it ended. */
    async function statuses(run: (app: ReturnType<typeof createAppController>) => Promise<void>) {
      const app = createAppController();
      const seen: string[] = [];
      const unsubscribe = app.state.subscribe((state) => seen.push(findItem(state.combinations, 'c3', state.sync).status));
      await run(app);
      unsubscribe();
      return seen;
    }

    it('is not reported missing between the instant start’s snapshot and its delta', async () => {
      await savedListings();
      routes['GET /api/sync'] = () => Response.json(delta({ combinations: [added], visibleCombinations: 3 }));
      const seen = await statuses((app) => app.refresh());
      expect(seen).not.toContain('missing');
      expect(seen.at(-1)).toBe('found');
    });

    it('is not reported missing between another account’s own snapshot and its load', async () => {
      await savedListings();
      await saveSnapshot('u2', { glazes: [glaze], combinations: [older], ...empty }, point);
      routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2' });
      routes['GET /api/sync/combinations'] = () => Response.json({ combinations: [added, older], next: null });
      routes['GET /api/sync'] = () => Response.json(resync({ visibleCombinations: 2 }));
      const seen = await statuses((app) => app.refresh());
      expect(seen).not.toContain('missing');
      expect(seen.at(-1)).toBe('found');
    });

    it('is not reported missing between the guest snapshot after an ended session and the guest’s load', async () => {
      await savedListings();
      await saveSnapshot(null, { glazes: [glaze], combinations: [older], ...empty }, point);
      routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
      routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
      routes['POST /api/auth/logout'] = () => new Response(null, { status: 200 });
      routes['GET /api/sync/combinations'] = () => Response.json({ combinations: [added, older], next: null });
      routes['GET /api/sync'] = () => Response.json(resync({ visibleCombinations: 2 }));
      const seen = await statuses((app) => app.refresh());
      expect(seen).not.toContain('missing');
      expect(seen.at(-1)).toBe('found');
    });
  });

  it('never shows the snapshot of the device account to another account the server names', async () => {
    await savedListings();
    await saveSnapshot('u2', { glazes: [buildGlaze({ id: 'g2' })], combinations: [], ...empty }, point);
    const other = { ...user, id: 'u2', displayName: 'Bea' };
    routes['GET /api/auth/me'] = () => Response.json(other);
    routes['GET /api/glazes'] = () => Response.json([buildGlaze({ id: 'g2' })]);
    const app = createAppController();
    const states: { user?: string; glazes: string[] }[] = [];
    const unsubscribe = app.state.subscribe((state) => states.push({ user: state.user?.id, glazes: state.glazes.map((item) => item.id) }));
    await app.refresh();
    unsubscribe();
    // u1's snapshot showed for u1 only; u2 never saw g1, and u1's saved copy is gone.
    expect(states.filter((state) => state.user === 'u2').every((state) => !state.glazes.includes('g1'))).toBe(true);
    expect(states.some((state) => state.user === 'u1' && state.glazes.includes('g1'))).toBe(true);
    expect(flat(get(app.state))).toMatchObject({ user: other, loading: false });
    expect(await readSaved('u1')).toBeNull();
  });

  it('shows the guest snapshot to a guest at once and keeps it while the server answers', async () => {
    localStorage.removeItem('glazelab:v1:lastUser');
    await saveSnapshot(null, { glazes: [glaze], combinations: [older], ...empty }, point);
    const me = held('GET /api/auth/me', () => new Response(null, { status: 401 }));
    routes['GET /api/sync'] = () => Response.json(delta({ visibleCombinations: 1 }));
    const app = createAppController();
    const loading = app.refresh();
    await me.started;
    expect(flat(get(app.state))).toMatchObject({ user: null, loading: false, glazes: [glaze], combinations: [older] });
    const shown = get(app.state).combinations;
    me.release();
    await loading;
    // A guest's listings are never cleared by the guest's own session check.
    expect(get(app.state).combinations).toBe(shown);
    expect(flat(get(app.state))).toMatchObject({ user: null, loading: false, loadFailed: false });
  });

  it('keeps the snapshot and shows no warning while a start that fails once retries silently', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    stubBrowser('#/');
    await savedListings();
    let down = true;
    routes['GET /api/auth/me'] = () => (down ? Promise.reject(new TypeError('fetch failed')) : Response.json(user));
    routes['GET /api/sync'] = () => Response.json(delta());
    const app = createAppController();
    const stop = app.start();
    const settle = async (ms = 0) => {
      await vi.advanceTimersByTimeAsync(ms);
      for (let round = 0; round < 30; round++) {
        await new Promise((resolve) => setImmediate(resolve));
        await vi.advanceTimersByTimeAsync(0);
      }
    };
    try {
      await settle();
      expect(flat(get(app.state))).toMatchObject({ user, online: true, loading: false, loadFailed: false, error: '', glazes: [glaze] });
      down = false;
      await settle(2000);
      expect(flat(get(app.state))).toMatchObject({ user, online: true, loading: false, syncing: false, loadFailed: false });
      expect((await readSaved('u1'))?.point?.cursor).toBe('7.2000');
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it('reports an item the snapshot lacks as loading until the refresh answers, not as missing', async () => {
    await savedListings();
    const added = combination({ id: 'c3', publishedAt: '2026-10-25T10:00:00Z' });
    const sync = held('GET /api/sync', () => Response.json(delta({ combinations: [added], visibleCombinations: 3 })));
    const app = createAppController();
    const loading = app.refresh();
    await sync.started;
    expect(findItem(get(app.state).combinations, 'c3', get(app.state).sync).status).toBe('loading');
    sync.release();
    await loading;
    expect(findItem(get(app.state).combinations, 'c3', get(app.state).sync).status).toBe('found');
    expect(findItem(get(app.state).combinations, 'unknown', get(app.state).sync).status).toBe('missing');
  });

  it('shows a snapshot saved before the sync, then loads in full from a fresh start point', async () => {
    await savedListings([older], null);
    const syncs = recorded('GET /api/sync', () => Response.json(resync({ cursor: '9.9000', visibleCombinations: 1 })));
    const pages = recorded('GET /api/sync/combinations', () => page([newer], null));
    const app = createAppController();
    await app.refresh();
    expect(syncs.map((query) => query.toString())).toEqual(['']);
    expect(pages.map((query) => Object.fromEntries(query))).toEqual([{ limit: String(PAGE_SIZE) }]);
    expect(get(app.state).combinations).toEqual([newer]);
    expect((await readSaved('u1'))?.point).toEqual({ cursor: '9.9000', epoch: 'e1', format: 1, client: CLIENT_FORMAT });
  });
});

describe('delta refresh', () => {
  async function synced() {
    await savedListings();
    routes['GET /api/sync'] = () => Response.json(delta());
    const app = createAppController();
    await app.refresh();
    return app;
  }

  it('removes a tombstoned combination and copies a corrected glaze name into the steps that use it', async () => {
    await savedListings([newer, combination({ ...older, steps: [glazeStep({ glazeId: 'g1', name: 'Blue' })] })]);
    routes['GET /api/sync'] = () =>
      Response.json(delta({ removedCombinationIds: ['c2'], glazes: [{ ...glaze, name: 'Navy' }], visibleCombinations: 1, visibleGlazes: 1 }));
    const app = createAppController();
    await app.refresh();
    const { combinations, glazes } = get(app.state);
    expect(combinations.map((item) => item.id)).toEqual(['c1']);
    expect(combinations[0].steps[0].name).toBe('Navy');
    expect(glazes[0].name).toBe('Navy');
    expect((await readSaved('u1'))?.snapshot.combinations[0].steps[0].name).toBe('Navy');
  });

  it('refreshes a write by delta, without reading the listings again', async () => {
    const app = await synced();
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['POST /api/combinations/c2/publish'] = () => new Response(null, { status: 204 });
    const pages = recorded('GET /api/sync/combinations', () => page([], null));
    const glazes = recorded('GET /api/glazes', () => Response.json([glaze]));
    const syncs = recorded('GET /api/sync', () => Response.json(delta({ cursor: '8.3000', combinations: [{ ...newer, title: 'Published' }] })));
    expect(await app.publishCombination('c2')).toBe(true);
    expect(syncs.map((query) => query.get('since'))).toEqual(['7.2000']);
    expect(pages).toHaveLength(0);
    expect(glazes).toHaveLength(0);
    expect(get(app.state).combinations[0].title).toBe('Published');
  });

  it('loads in full after joining a club: the server answers the new epoch with a resync', async () => {
    stubBrowser('#/invite/token');
    const app = await synced();
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['POST /api/clubs/join'] = () => Response.json({ id: 'k1', name: 'Kiln club' });
    const syncs = recorded('GET /api/sync', (url) =>
      Response.json(url.searchParams.get('epoch') === 'e1' ? resync({ resync: 'EPOCH', cursor: '9.1000', epoch: 'e2', visibleCombinations: 1 }) : delta()),
    );
    const clubPhoto = combination({ ...older, images: [] });
    const pages = recorded('GET /api/sync/combinations', () => page([clubPhoto], null));
    expect(await app.joinClub('T'.repeat(43))).toBe(true);
    expect(syncs.map((query) => query.get('epoch'))).toEqual(['e1']);
    expect(pages).toHaveLength(1);
    expect((await readSaved('u1'))?.point).toMatchObject({ cursor: '9.1000', epoch: 'e2' });
  });

  it('moves only the sync point when the delta changed nothing', async () => {
    const app = await synced();
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    routes['GET /api/sync'] = () => Response.json(delta({ cursor: '8.3000', combinations: [{ ...newer }] }));
    await app.refresh();
    const keys = put.mock.calls.map((call) => call[1]);
    expect(keys).toEqual(['u1/sync']);
    expect((await readSaved('u1'))?.point?.cursor).toBe('8.3000');
  });

  it('leaves the store alone once a delta with nothing new has shown its answers, so the pages derive nothing more', async () => {
    routes['GET /api/auth/options'] = () => Response.json({});
    const app = await synced();
    let previous = get(app.state);
    let later = 0;
    const stop = app.state.subscribe((state) => {
      later = flat(previous).syncing && !flat(state).syncing ? 0 : later + 1;
      previous = state;
    });
    routes['GET /api/sync'] = () => Response.json(delta({ cursor: '8.3000' }));
    await app.refresh();
    stop();
    // The update that ended `syncing` is the last one.
    expect(later).toBe(0);
    expect(flat(get(app.state))).toMatchObject({ loading: false, syncing: false, syncProgress: null, storageWarning: false });
  });

  it('makes what Explore derives from a changed delta before it shows it, on Explore only', async () => {
    const changed = delta({ combinations: [{ ...older, title: 'Changed' }] });
    await savedListings();
    routes['GET /api/sync'] = () => Response.json(changed);
    const explore = createAppController();
    await explore.refresh();
    const shown = get(explore.state);
    expect(shown.combinations.map((item) => item.title)).toContain('Changed');
    expect(listingOf(shown.glazes, shown.combinations).orders.newest.sorted).toBeDefined();
    // A-Z only when the link asks for it (19e-10).
    expect(listingOf(shown.glazes, shown.combinations).orders.az.sorted).toBeUndefined();

    stubBrowser('#/?sort=az');
    await savedListings();
    const az = createAppController();
    await az.refresh();
    const sorted = get(az.state);
    expect(sorted.combinations.map((item) => item.title)).toContain('Changed');
    expect(listingOf(sorted.glazes, sorted.combinations).orders.az.sorted).toBeDefined();

    stubBrowser('#/stock');
    await savedListings();
    const shelf = createAppController();
    await shelf.refresh();
    const listed = get(shelf.state);
    expect(listed.combinations.map((item) => item.title)).toContain('Changed');
    expect(listingOf(listed.glazes, listed.combinations).orders.newest.sorted).toBeUndefined();
  });

  describe('with buddy availability (read in full on every load, not part of the delta)', () => {
    const DAY = Date.UTC(2026, 9, 31, 12);
    const ada = { id: 'u2', displayName: 'Ada', since: '2026-10-31T10:00:00Z' };
    const held = [{ glazeId: 'g1', buddies: [{ id: 'u2', displayName: 'Ada' }] }];
    const writes = (put: { mock: { calls: unknown[][] } }) => put.mock.calls.map((call) => call[1]);

    it('moves only the sync point when the same availability is read again the same day, and rewrites it for a change or a new day', async () => {
      routes['GET /api/buddies'] = () => Response.json({ buddies: [ada], incoming: [], outgoing: [], hasLink: false });
      routes['GET /api/buddies/availability'] = () => Response.json(held);
      vi.spyOn(Date, 'now').mockReturnValue(DAY);
      const app = await synced();
      const put = vi.spyOn(IDBObjectStore.prototype, 'put');
      vi.spyOn(Date, 'now').mockReturnValue(DAY + 60_000);
      await app.refresh();
      expect(writes(put)).toEqual(['u1/sync']);
      put.mockClear();
      routes['GET /api/buddies/availability'] = () => Response.json([]);
      await app.refresh();
      expect(writes(put)).toContain('u1');
      put.mockClear();
      vi.spyOn(Date, 'now').mockReturnValue(DAY + 2 * 86_400_000);
      await app.refresh();
      expect(writes(put)).toContain('u1');
      expect((await readSaved('u1'))?.snapshot.buddyAvailability.asOf).toBe(DAY + 2 * 86_400_000);
    });
  });

  it.each(['CURSOR', 'FORMAT', 'EPOCH', 'EXPIRED', 'TOO_MANY'] as const)('loads in full after resync %s, from the answer’s own cursor', async (reason) => {
    const app = await synced();
    const syncs = recorded('GET /api/sync', () => Response.json(resync({ resync: reason, cursor: '20.5000', epoch: 'e2', visibleCombinations: 1 })));
    const pages = recorded('GET /api/sync/combinations', () => page([older], null));
    await app.refresh();
    expect(syncs).toHaveLength(1);
    expect(pages).toHaveLength(1);
    expect(get(app.state).combinations).toEqual([older]);
    expect((await readSaved('u1'))?.point).toEqual({ cursor: '20.5000', epoch: 'e2', format: 1, client: CLIENT_FORMAT });
    expect(await readFirstSync('u1')).toBeNull();
  });

  it('replaces a snapshot of the zone-less format 1 by a full load of format 2, showing it in the meantime', async () => {
    const savedOlder = combination({ id: 'c1', title: 'Older', createdAt: '2026-10-01T10:00:00', publishedAt: '2026-10-01T10:00:00' });
    const savedNewer = combination({ id: 'c2', title: 'Newer', createdAt: '2026-10-20T10:00:00', publishedAt: '2026-10-20T10:00:00' });
    await savedListings([savedNewer, savedOlder]);
    const me = held('GET /api/auth/me', () => Response.json(user));
    const syncs = recorded('GET /api/sync', () => Response.json(resync({ format: 2, resync: 'FORMAT', cursor: '30.6000', visibleCombinations: 2 })));
    recorded('GET /api/sync/combinations', () => page([newer, older], null));
    recorded('GET /api/glazes', () => Response.json([glaze]));
    const app = createAppController();
    const loading = app.refresh();
    await me.started;
    // The old snapshot shows at once (Explore reads its zone-less times as UTC).
    expect(get(app.state).combinations).toEqual([savedNewer, savedOlder]);
    me.release();
    await loading;
    expect(syncs.map((query) => query.get('format'))).toEqual(['1']);
    expect(flat(get(app.state))).toMatchObject({ loading: false, syncing: false, loadFailed: false });
    expect(get(app.state).combinations).toEqual([newer, older]);
    const saved = await readSaved('u1');
    expect(saved?.point).toEqual({ cursor: '30.6000', epoch: 'e1', format: 2, client: CLIENT_FORMAT });
    expect(saved?.snapshot.combinations.map((item) => item.publishedAt)).toEqual([newer.publishedAt, older.publishedAt]);
  });

  it('loads in full when the counts after applying differ, without asking for another start point', async () => {
    const app = await synced();
    const syncs = recorded('GET /api/sync', () => Response.json(delta({ cursor: '9.4000', visibleCombinations: 3 })));
    const missing = combination({ id: 'c9', publishedAt: '2026-10-05T10:00:00Z' });
    recorded('GET /api/sync/combinations', () => page([older, newer, missing], null));
    await app.refresh();
    expect(syncs).toHaveLength(1);
    expect(get(app.state).combinations.map((item) => item.id)).toEqual(['c2', 'c9', 'c1']);
    expect((await readSaved('u1'))?.point?.cursor).toBe('9.4000');
  });

  it('keeps the shown listings and the sync point when the connection drops during a delta', async () => {
    const app = await synced();
    const shown = get(app.state).combinations;
    routes['GET /api/sync'] = unreachable;
    await app.refresh();
    expect(flat(get(app.state))).toMatchObject({ online: false, loadFailed: true, syncing: false, loading: false });
    expect(get(app.state).combinations).toBe(shown);
    expect((await readSaved('u1'))?.point?.cursor).toBe('7.2000');
    const syncs = recorded('GET /api/sync', () => Response.json(delta({ cursor: '8.3000' })));
    await app.retry();
    expect(syncs.map((query) => query.get('since'))).toEqual(['7.2000']);
    expect(flat(get(app.state))).toMatchObject({ online: true, loadFailed: false });
  });

  it('drops a delta that answers after a sign-out, and the next account starts without the old cursor', async () => {
    stubBrowser('#/');
    const app = await synced();
    const late = held('GET /api/sync', () => Response.json(delta({ cursor: '8.3000', combinations: [combination({ id: 'late' })], visibleCombinations: 3 })));
    const refreshing = app.refresh();
    await late.started;
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['POST /api/auth/logout'] = () => {
      routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
      return new Response(null, { status: 200 });
    };
    const guestSyncs = recorded('GET /api/sync', () => Response.json(resync({ visibleCombinations: 0 })));
    await app.logout();
    late.release();
    await refreshing;
    expect(get(app.state)).toMatchObject({ user: null, combinations: [] });
    expect(await readSaved('u1')).toBeNull();
    expect(guestSyncs.map((query) => query.get('since'))).toEqual([null]);
  });

  it('refreshes by delta when the app returns to the foreground after a while, not right after a load', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    const { events } = stubBrowser('#/');
    await savedListings();
    const syncs = recorded('GET /api/sync', () => Response.json(delta()));
    const app = createAppController();
    const stop = app.start();
    const settle = async (ms = 0) => {
      await vi.advanceTimersByTimeAsync(ms);
      for (let round = 0; round < 30; round++) {
        await new Promise((resolve) => setImmediate(resolve));
        await vi.advanceTimersByTimeAsync(0);
      }
    };
    try {
      await settle();
      expect(syncs).toHaveLength(1);
      vi.stubGlobal('document', { visibilityState: 'visible' });
      events.dispatchEvent(new Event('visibilitychange'));
      await settle();
      expect(syncs).toHaveLength(1);
      await settle(RESUME_SYNC_MS);
      events.dispatchEvent(new Event('visibilitychange'));
      await settle();
      expect(syncs).toHaveLength(2);
      expect(flat(get(app.state))).toMatchObject({ loading: false, online: true });
    } finally {
      stop();
      vi.useRealTimers();
    }
  });
});

describe('paged first sync', () => {
  const library = Array.from({ length: 5 }, (_, index) => combination({ id: `c${index}`, publishedAt: `2026-10-0${index + 1}T10:00:00Z` }));
  /** Pages of two by ID, `next` naming the last ID of a page; `failAfter` drops the connection on the page after that ID. */
  function pagedServer({ failAt }: { failAt?: string } = {}) {
    return recorded('GET /api/sync/combinations', (url) => {
      const after = url.searchParams.get('after');
      if (failAt !== undefined && (after ?? '') === failAt) return Promise.reject(new TypeError('fetch failed'));
      const start = after ? library.findIndex((item) => item.id === after) + 1 : 0;
      const items = library.slice(start, start + 2);
      return page(items, start + 2 < library.length ? items[items.length - 1].id : null);
    });
  }

  it('shows "n of m" while nothing is shown, saves every page and ends with the listing in order', async () => {
    // A new device: nothing saved.
    await deleteSnapshot('u1');
    routes['GET /api/sync'] = () => Response.json(resync({ cursor: '3.3000', visibleCombinations: 5 }));
    const pages = pagedServer();
    const app = createAppController();
    const progress: (string | null)[] = [];
    const unsubscribe = app.state.subscribe((state) => {
      const counted = progressOf(state.sync);
      progress.push(counted && `${counted.done}/${counted.total}`);
    });
    await app.refresh();
    unsubscribe();
    expect(progress.filter((entry, index) => entry && entry !== progress[index - 1])).toEqual(['0/5', '2/5', '4/5', '5/5']);
    expect(pages.map((query) => query.get('after'))).toEqual([null, 'c1', 'c3']);
    expect(flat(get(app.state))).toMatchObject({ loading: false, syncProgress: null });
    expect(get(app.state).combinations.map((item) => item.id)).toEqual(['c4', 'c3', 'c2', 'c1', 'c0']);
    expect((await readSaved('u1'))?.point?.cursor).toBe('3.3000');
    expect(await readFirstSync('u1')).toBeNull();
  });

  it('never counts more done than in all: a library that grew while the pages arrive raises the total', async () => {
    await deleteSnapshot('u1');
    // The server counted 3 when the load began; 5 arrive.
    routes['GET /api/sync'] = () => Response.json(resync({ cursor: '3.3000', visibleCombinations: 3 }));
    pagedServer();
    const app = createAppController();
    const progress: string[] = [];
    const unsubscribe = app.state.subscribe((state) => {
      const counted = progressOf(state.sync);
      if (counted && `${counted.done}/${counted.total}` !== progress.at(-1)) progress.push(`${counted.done}/${counted.total}`);
    });
    await app.refresh();
    unsubscribe();
    expect(progress).toEqual(['0/3', '2/3', '4/4', '5/5']);
  });

  it('continues after a dropped connection and after a reload from the last saved page, at the first cursor', async () => {
    await deleteSnapshot('u1');
    const syncs = recorded('GET /api/sync', () => Response.json(resync({ cursor: '3.3000', visibleCombinations: 5 })));
    pagedServer({ failAt: 'c1' });
    const first = createAppController();
    await first.refresh();
    expect(flat(get(first.state))).toMatchObject({ loadFailed: true, loading: false, combinations: [] });
    expect((await readFirstSync('u1'))?.progress).toMatchObject({ next: 'c1', pages: 1, total: 5, point: { cursor: '3.3000' } });

    // A reload: the new controller continues after c1 and never asks for a new start point or the first page; once the
    // pages are in, it asks for the changes since the first cursor (the saved page may be old).
    syncs.length = 0;
    routes['GET /api/sync'] = (request) => {
      syncs.push(new URL(request.url).searchParams);
      return Response.json(resync({ resync: null, cursor: '4.4000', visibleCombinations: 5 }));
    };
    const pages = pagedServer();
    const reloaded = createAppController();
    const progress: string[] = [];
    const unsubscribe = reloaded.state.subscribe((state) => {
      const counted = progressOf(state.sync);
      if (counted) progress.push(`${counted.done}/${counted.total}`);
    });
    await reloaded.refresh();
    unsubscribe();
    expect(progress[0]).toBe('2/5');
    expect(syncs.map((query) => query.get('since'))).toEqual(['3.3000']);
    expect(pages.map((query) => query.get('after'))).toEqual(['c1', 'c3']);
    expect(get(reloaded.state).combinations).toHaveLength(5);
    expect((await readSaved('u1'))?.point?.cursor).toBe('4.4000');
    expect(await readFirstSync('u1')).toBeNull();
  });

  it('drops the unfinished pages and the sync point with the account on sign-out', async () => {
    stubBrowser('#/');
    await savedListings();
    await saveFirstSyncPage('u1', { point, total: 5, next: 'c1', pages: 1 }, 0, library.slice(0, 2));
    const app = createAppController();
    routes['GET /api/sync/combinations'] = () => page([], null);
    await app.refresh();
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['POST /api/auth/logout'] = () => {
      routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
      return new Response(null, { status: 200 });
    };
    await saveFirstSyncPage('u1', { point, total: 5, next: 'c1', pages: 1 }, 0, library.slice(0, 2));
    await app.logout();
    expect(await readFirstSync('u1')).toBeNull();
    expect(await readSaved('u1')).toBeNull();
  });

  it('starts again when the saved pages are incomplete', async () => {
    await saveFirstSyncPage('u1', { point, total: 5, next: 'c3', pages: 2 }, 0, library.slice(0, 2));
    expect(await readFirstSync('u1')).toBeNull();
  });
});

describe('writes and saved records racing a load', () => {
  it('never shows a combination deleted while a delta taken before the deletion was on its way', async () => {
    stubBrowser('#/combinations/c1');
    await savedListings();
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['DELETE /api/combinations/c1'] = () => new Response(null, { status: 204 });
    // The server's answer was taken before the deletion: c1 is still in it (an overlap repeat).
    const first = held('GET /api/sync', () => Response.json(delta({ combinations: [older] })));
    const app = createAppController();
    const loading = app.refresh();
    await first.started;
    expect(await app.removeCombination('c1')).toBe(true);
    expect(get(app.state).combinations.map((item) => item.id)).toEqual(['c2']);
    // Asked after the deletion, the server names it.
    const syncs = recorded('GET /api/sync', () => Response.json(delta({ cursor: '8.3000', removedCombinationIds: ['c1'], visibleCombinations: 1 })));
    first.release();
    await loading;
    expect(get(app.state).combinations.map((item) => item.id)).toEqual(['c2']);
    expect(syncs.map((query) => query.get('since'))).toEqual(['7.2000']);
    expect((await readSaved('u1'))?.snapshot.combinations.map((item) => item.id)).toEqual(['c2']);
    expect((await readSaved('u1'))?.point?.cursor).toBe('8.3000');
  });

  it('asks nothing more and shows nothing when a sign-out lands while a changed delta waits to be shown', async () => {
    stubBrowser('#/');
    await savedListings();
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['POST /api/auth/logout'] = () => new Response(null, { status: 204 });
    const syncs = recorded('GET /api/sync', () => Response.json(delta({ combinations: [{ ...older, title: 'Changed' }] })));
    const app = createAppController();
    const later = globalThis.setTimeout;
    let waited = false;
    let asked = 0;
    const timer = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((run: () => void, ms?: number) => {
      if (ms !== undefined || waited) return later(run, ms);
      waited = true;
      asked = syncs.length;
      routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
      void app.logout();
      later(run, 0);
      return 0;
    }) as typeof setTimeout);
    await app.refresh();
    await vi.waitFor(() => expect(flat(get(app.state)).loading).toBe(false));
    timer.mockRestore();
    expect(waited).toBe(true);
    expect(get(app.state).user).toBeNull();
    expect(get(app.state).combinations.map((item) => item.title)).not.toContain('Changed');
    expect(syncs.filter((query) => query.get('since') === '7.2000')).toHaveLength(0);
    expect(asked).toBeGreaterThan(0);
  });

  it('asks again when a write lands while a changed delta waits to be shown', async () => {
    await savedListings();
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['DELETE /api/combinations/c1'] = () => new Response(null, { status: 204 });
    routes['GET /api/sync'] = () => Response.json(delta({ combinations: [{ ...older, title: 'Changed' }] }));
    const app = createAppController();
    // The one task the load waits for after warming Explore: the deletion lands in it.
    const later = globalThis.setTimeout;
    let waited = false;
    const timer = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((run: () => void, ms?: number) => {
      if (ms !== undefined || waited) return later(run, ms);
      waited = true;
      routes['GET /api/sync'] = () => Response.json(delta({ cursor: '8.3000', removedCombinationIds: ['c1'], visibleCombinations: 1 }));
      void app.removeCombination('c1').then(run);
      return 0;
    }) as typeof setTimeout);
    await app.refresh();
    timer.mockRestore();
    expect(waited).toBe(true);
    expect(get(app.state).combinations.map((item) => item.id)).toEqual(['c2']);
    expect((await readSaved('u1'))?.snapshot.combinations.map((item) => item.id)).toEqual(['c2']);
    expect((await readSaved('u1'))?.point?.cursor).toBe('8.3000');
  });

  it('asks once more when a write lands while the asked-again answer travels, and shows both writes', async () => {
    await savedListings();
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['DELETE /api/combinations/c1'] = () => new Response(null, { status: 204 });
    routes['DELETE /api/combinations/c2'] = () => new Response(null, { status: 204 });
    const first = held('GET /api/sync', () => Response.json(delta({ combinations: [older] })));
    const app = createAppController();
    const loading = app.refresh();
    await first.started;
    expect(await app.removeCombination('c1')).toBe(true);
    // The first round asks again from the point reached; its answer was taken before the second deletion.
    const second = held('GET /api/sync', () => Response.json(delta({ cursor: '8.3000', removedCombinationIds: ['c1'], visibleCombinations: 1 })));
    first.release();
    await second.started;
    expect(await app.removeCombination('c2')).toBe(true);
    expect(get(app.state).combinations).toEqual([]);
    const third = recorded('GET /api/sync', () => Response.json(delta({ cursor: '9.4000', removedCombinationIds: ['c2'], visibleCombinations: 0 })));
    second.release();
    await loading;
    // The last round's check sees the second deletion and asks once more: nothing deleted comes back.
    expect(third.map((query) => query.get('since'))).toEqual(['8.3000']);
    expect(get(app.state).combinations).toEqual([]);
    expect((await readSaved('u1'))?.snapshot.combinations).toEqual([]);
    expect((await readSaved('u1'))?.point?.cursor).toBe('9.4000');
  });

  it('never keeps an old favourite list read before a favourite was removed during a refresh', async () => {
    await savedListings();
    await saveSnapshot('u1', { glazes: [glaze], combinations: [newer, older], ...empty, favorites: { glazeIds: [], combinationIds: ['c1'] } }, point);
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['DELETE /api/favorites/combinations/c1'] = () => Response.json({ glazeIds: [], combinationIds: [] });
    const favorites = held('GET /api/favorites', () => Response.json({ glazeIds: [], combinationIds: ['c1'] }));
    routes['GET /api/sync'] = () => Response.json(delta());
    const app = createAppController();
    const loading = app.refresh();
    await favorites.started;
    routes['GET /api/favorites'] = () => Response.json({ glazeIds: [], combinationIds: [] });
    expect(await app.toggleFavorite('combinations', 'c1')).toBe(true);
    favorites.release();
    await loading;
    expect(get(app.state).favorites.combinationIds).toEqual([]);
  });

  it('never moves only the point over a snapshot another tab saved at an older point', async () => {
    await savedListings();
    // Two tabs at 5.1000. Tab A asks first (answer at 8, c1 edited), tab B later (answer at 9, c1 and c2 edited); A saves last.
    const edited1 = { ...older, title: 'Edited one' };
    const edited2 = { ...newer, title: 'Edited two' };
    const answerA = held('GET /api/sync', () => Response.json(delta({ cursor: '8.3000', combinations: [edited1] })));
    const tabA = createAppController();
    const loadingA = tabA.refresh();
    await answerA.started;
    routes['GET /api/sync'] = () => Response.json(delta({ cursor: '9.4000', combinations: [edited1, edited2] }));
    const tabB = createAppController();
    await tabB.refresh();
    answerA.release();
    await loadingA;
    // Tab B's next delta changes nothing for its listings.
    routes['GET /api/sync'] = () => Response.json(delta({ cursor: '10.5000' }));
    await tabB.refresh();
    const saved = await readSaved('u1');
    // The device holds either B's listings at 10 or A's at 8, never A's listings at 10 (c2's edit would be lost for good).
    const titles = saved?.snapshot.combinations.map((item) => item.title);
    expect(saved?.point?.cursor === '10.5000' ? titles : ['Edited two', 'Edited one']).toEqual(['Edited two', 'Edited one']);
  });

  it('never replays the pages of a finished full load over the newer listings that followed it', async () => {
    await savedListings();
    // A full load whose snapshot failed to save leaves its finished pages behind.
    routes['GET /api/sync'] = () => Response.json(resync({ resync: 'EPOCH', cursor: '7.2000', epoch: 'e2', visibleCombinations: 2 }));
    routes['GET /api/sync/combinations'] = () => page([older, newer], null);
    const original = IDBObjectStore.prototype.put;
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (key === 'u1') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return original.call(this, value, key);
    });
    const app = createAppController();
    await app.refresh();
    put.mockRestore();
    expect((await readFirstSync('u1'))?.progress.next).toBeNull();
    // The next delta edits c1 and saves.
    routes['GET /api/sync'] = (request) =>
      Response.json(
        new URL(request.url).searchParams.get('since') === '7.2000'
          ? delta({ cursor: '8.3000', epoch: 'e2', combinations: [{ ...older, title: 'Edited' }] })
          : delta({ cursor: '9.4000', epoch: 'e2' }),
      );
    await app.refresh();
    expect(get(app.state).combinations.find((item) => item.id === 'c1')?.title).toBe('Edited');
    // In this tab and after a reload, the old pages never come back.
    await app.refresh();
    expect(get(app.state).combinations.find((item) => item.id === 'c1')?.title).toBe('Edited');
    const reloaded = createAppController();
    await reloaded.refresh();
    expect(get(reloaded.state).combinations.find((item) => item.id === 'c1')?.title).toBe('Edited');
  });

  it('never resumes the pages of a full load shown in this tab, even when no snapshot could be saved since', async () => {
    await savedListings();
    routes['GET /api/sync'] = () => Response.json(resync({ resync: 'EPOCH', cursor: '7.2000', epoch: 'e2', visibleCombinations: 2 }));
    routes['GET /api/sync/combinations'] = () => page([older, newer], null);
    const original = IDBObjectStore.prototype.put;
    // Every snapshot save fails; the pages of the paged load are saved.
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (key === 'u1') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return original.call(this, value, key);
    });
    const app = createAppController();
    await app.refresh();
    routes['GET /api/sync'] = (request) =>
      Response.json(
        new URL(request.url).searchParams.get('since') === '7.2000'
          ? delta({ cursor: '8.3000', epoch: 'e2', combinations: [{ ...older, title: 'Edited' }] })
          : delta({ cursor: '9.4000', epoch: 'e2' }),
      );
    await app.refresh();
    expect(get(app.state).combinations.find((item) => item.id === 'c1')?.title).toBe('Edited');
    const pages = recorded('GET /api/sync/combinations', () => page([older, newer], null));
    await app.refresh();
    expect(get(app.state).combinations.find((item) => item.id === 'c1')?.title).toBe('Edited');
    expect(pages).toHaveLength(0);
  });

  it('asks for the changes since a resumed full load before it counts as current (its pages may be old)', async () => {
    await deleteSnapshot('u1');
    // Pages of a load started before this account joined a club; the server now answers the old epoch with a resync.
    await saveFirstSyncPage('u1', { point, total: 2, next: 'c1', pages: 1 }, 0, [older]);
    const pages = recorded('GET /api/sync/combinations', (url) =>
      url.searchParams.get('after') === 'c1' ? page([newer], null) : page([older, newer, combination({ id: 'c3', publishedAt: '2026-10-25T10:00:00Z' })], null),
    );
    const syncs = recorded('GET /api/sync', (url) =>
      Response.json(
        url.searchParams.get('epoch') === 'e1' ? resync({ resync: 'EPOCH', cursor: '9.1000', epoch: 'e2', visibleCombinations: 3 }) : delta({ epoch: 'e2' }),
      ),
    );
    const app = createAppController();
    await app.refresh();
    expect(syncs.map((query) => query.get('since'))).toEqual(['5.1000']);
    expect(pages.map((query) => query.get('after'))).toEqual(['c1', null]);
    expect(get(app.state).combinations.map((item) => item.id)).toEqual(['c3', 'c2', 'c1']);
    expect((await readSaved('u1'))?.point).toMatchObject({ cursor: '9.1000', epoch: 'e2' });
  });
});

describe('loads that lost their account or their turn', () => {
  it('applies a delta to the listings it was asked for, so a deletion meanwhile costs no full load', async () => {
    stubBrowser('#/combinations/c1');
    await savedListings();
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['DELETE /api/combinations/c1'] = () => new Response(null, { status: 204 });
    // Nothing changed before the deletion: the answer mentions neither combination and counts both.
    const first = held('GET /api/sync', () => Response.json(delta()));
    const app = createAppController();
    const loading = app.refresh();
    await first.started;
    expect(await app.removeCombination('c1')).toBe(true);
    routes['GET /api/sync'] = () => Response.json(delta({ cursor: '8.3000', removedCombinationIds: ['c1'], visibleCombinations: 1 }));
    const pages = recorded('GET /api/sync/combinations', () => page([newer], null));
    first.release();
    await loading;
    expect(pages).toHaveLength(0);
    expect(get(app.state).combinations.map((item) => item.id)).toEqual(['c2']);
  });

  it('continues the unfinished paged load at its own cursor while an older snapshot shows, then asks from there', async () => {
    await savedListings([older]);
    const pagesAt: SyncPoint = { ...point, cursor: '6.1500' };
    await saveFirstSyncPage('u1', { point: pagesAt, total: 2, next: 'c1', pages: 1 }, 0, [older]);
    const pages = recorded('GET /api/sync/combinations', () => page([newer], null));
    const syncs = recorded('GET /api/sync', () => Response.json(delta({ cursor: '7.2000' })));
    const app = createAppController();
    await app.refresh();
    expect(pages.map((query) => query.get('after'))).toEqual(['c1']);
    expect(syncs.map((query) => query.get('since'))).toEqual(['6.1500']);
    expect(get(app.state).combinations.map((item) => item.id)).toEqual(['c2', 'c1']);
    expect((await readSaved('u1'))?.point?.cursor).toBe('7.2000');
    expect(await readFirstSync('u1')).toBeNull();
  });

  it('starts no paged load for a resync answer that arrives after a sign-out', async () => {
    stubBrowser('#/');
    await savedListings();
    const late = held('GET /api/sync', () => Response.json(resync({ resync: 'EPOCH', cursor: '8.3000', visibleCombinations: 2 })));
    const app = createAppController();
    const refreshing = app.refresh();
    await late.started;
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['POST /api/auth/logout'] = () => {
      routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
      return new Response(null, { status: 200 });
    };
    routes['GET /api/sync'] = () => Response.json(resync({ visibleCombinations: 0 }));
    const pages = recorded('GET /api/sync/combinations', () => page([], null));
    await app.logout();
    expect(pages).toHaveLength(1);
    late.release();
    await refreshing;
    // Only the guest's own full load read a page.
    expect(pages).toHaveLength(1);
    expect(await readFirstSync('u1')).toBeNull();
  });

  it('saves no snapshot for a write while nothing of the account shows yet', async () => {
    await deleteSnapshot('u1');
    routes['GET /api/sync'] = () => Response.json(resync({ cursor: '3.3000', visibleCombinations: 1 }));
    const first = held('GET /api/sync/combinations', () => page([older], null));
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['PUT /api/favorites/glazes/g1'] = () => new Response(null, { status: 204 });
    const app = createAppController();
    const loading = app.refresh();
    await first.started;
    expect(flat(get(app.state)).loading).toBe(true);
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    routes['GET /api/favorites'] = () => Response.json({ glazeIds: ['g1'], combinationIds: [] });
    expect(await app.toggleFavorite('glazes', 'g1')).toBe(true);
    expect(put.mock.calls.map((call) => call[1])).not.toContain('u1');
    // The favourite changed while the load read: it asks again from its start point before showing.
    const syncs = recorded('GET /api/sync', () => Response.json(delta({ cursor: '4.4000', visibleCombinations: 1 })));
    first.release();
    await loading;
    expect(syncs.map((query) => query.get('since'))).toEqual(['3.3000']);
    expect(get(app.state).favorites.glazeIds).toEqual(['g1']);
  });
});

describe('instant start after an offline sign-out', () => {
  it('never shows the signed-out account again when the device could not forget it', async () => {
    stubBrowser('#/');
    await savedListings();
    const app = createAppController();
    await app.refresh();
    vi.stubGlobal('navigator', { onLine: false });
    await app.refresh();
    expect(get(app.state)).toMatchObject({ user, online: false });
    // The device cannot remove the last user (storage refuses writes).
    const storage = globalThis.localStorage;
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.getItem(key),
      setItem: () => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      },
      removeItem: () => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      },
    });
    await app.logout();
    expect(get(app.state).user).toBeNull();
    await app.refresh();
    expect(get(app.state)).toMatchObject({ user: null, combinations: [] });
  });
});
