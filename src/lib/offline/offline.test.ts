import { emptyBuddies } from '../buddies/buddies';
import { emptyAvailability } from '../stock/buddy-shelf';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { deleteSnapshot } from './snapshots';
import {
  dropCachedImages,
  forgetLoadedImages,
  imageUrl,
  networkReachable,
  pruneImageCache,
  SAVED_DOWNLOAD_TIMEOUT_MS,
  readSnapshot,
  saveSnapshot,
  clearPrivateCache,
  pictureBlob,
  readLastUser,
  saveLastUser,
} from './offline';
import { TOO_MANY_REQUESTS } from '../api/client';
import type { Snapshot } from '../api/models';
import { quantize } from '../vision/embeddings';
import { embeddingStore } from '../vision/embedding-store';

beforeEach(() => {
  forgetLoadedImages();
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  networkReachable.set(true);
});

describe('offline snapshots', () => {
  it('normalizes older IndexedDB snapshots without newer fields', async () => {
    const legacyGlaze = { id: 'g1', brand: 'Amaco', name: 'Blue', code: 'PC-20', notes: null };
    const legacyStep = { position: 1, glazeId: 'g1', coats: 2, method: null, notes: null };
    await saveSnapshot('user-1', {
      glazes: [legacyGlaze, { ...legacyGlaze, id: 'g2', code: null }],
      combinations: [{ id: 'c1', title: 'Blue', steps: [{ ...legacyStep, brand: 'Amaco', name: 'Blue' }] }],
      stock: [{ id: 's1', glazeId: 'g1', quantityG: 5, brand: 'Amaco', name: 'Blue' }],
      clubs: [],
    } as unknown as Snapshot);
    // Brands become manufacturers without an ID or short ID; glazes then show their code alone.
    const manufacturer = { id: '', shortId: '', name: 'Amaco' };
    expect(await readSnapshot('user-1')).toEqual({
      glazes: [
        {
          id: 'g1',
          manufacturer,
          name: 'Blue',
          code: 'PC-20',
          notes: null,
          images: [],
          tags: [],
          barcodes: [],
          createdAt: '',
          addedBy: null,
          lastEditedAt: null,
          lastEditedBy: null,
        },
        {
          id: 'g2',
          manufacturer,
          name: 'Blue',
          code: '',
          notes: null,
          images: [],
          tags: [],
          barcodes: [],
          createdAt: '',
          addedBy: null,
          lastEditedAt: null,
          lastEditedBy: null,
        },
      ],
      combinations: [
        {
          id: 'c1',
          title: 'Blue',
          steps: [{ ...legacyStep, type: 'GLAZE', label: null, manufacturer: 'Amaco', name: 'Blue' }],
          images: [],
          tags: [],
          authorId: null,
          own: false,
          stepsLocked: false,
          draft: false,
          publishedAt: null,
          basedOnId: null,
          cone: null,
          temperatureC: null,
          atmosphere: null,
          clayBody: null,
          kiln: null,
          firedOn: null,
        },
      ],
      stock: [
        {
          id: 's1',
          glazeId: 'g1',
          quantityG: 5,
          jarSizeG: null,
          manufacturer: 'Amaco',
          name: 'Blue',
          addedById: null,
          canRemove: true,
          keepPrivate: false,
        },
      ],
      clubs: [],
      clubMembers: {},
      buddies: emptyBuddies(),
      buddyAvailability: emptyAvailability(),
      authorAvatars: {},
      favorites: { glazeIds: [], combinationIds: [] },
    });
  });

  it('reads club entries saved before they named their adder as not removable until the next load', async () => {
    await saveSnapshot('user-1', {
      glazes: [],
      combinations: [],
      stock: [
        { id: 's1', glazeId: 'g1', userId: 'u1', clubId: null, quantityG: 5, manufacturer: 'Amaco', name: 'Blue' },
        { id: 's2', glazeId: 'g1', userId: null, clubId: 'k1', quantityG: 5, manufacturer: 'Amaco', name: 'Blue', clubName: 'Kiln' },
      ],
      clubs: [],
    } as unknown as Snapshot);
    const saved = (await readSnapshot('user-1'))?.stock;
    expect(saved?.map(({ addedById, canRemove, keepPrivate }) => ({ addedById, canRemove, keepPrivate }))).toEqual([
      { addedById: null, canRemove: true, keepPrivate: false },
      { addedById: null, canRemove: false, keepPrivate: false },
    ]);
  });

  it('reads combinations saved before variations as originals', async () => {
    await saveSnapshot('user-1', {
      glazes: [],
      combinations: [
        { id: 'c1', title: 'Old', steps: [], images: [] },
        { id: 'c2', title: 'Variation', steps: [], images: [], basedOnId: 'c1' },
      ],
      stock: [],
      clubs: [],
    } as unknown as Snapshot);
    const saved = (await readSnapshot('user-1'))?.combinations;
    expect(saved?.map((combo) => combo.basedOnId)).toEqual([null, 'c1']);
  });

  it('reads combinations saved before the final firing without one and keeps a saved firing', async () => {
    const firing = {
      cone: '6',
      temperatureC: 1222,
      atmosphere: 'OXIDATION',
      clayBody: 'Speckled stoneware',
      kiln: 'Club electric',
      firedOn: '2026-10-12',
    };
    await saveSnapshot('user-1', {
      glazes: [],
      combinations: [
        { id: 'c1', title: 'Old', steps: [], images: [] },
        { id: 'c2', title: 'Fired', steps: [], images: [], ...firing },
      ],
      stock: [],
      clubs: [],
    } as unknown as Snapshot);
    const [old, fired] = (await readSnapshot('user-1'))!.combinations;
    expect(old).toMatchObject({
      cone: null,
      temperatureC: null,
      atmosphere: null,
      clayBody: null,
      kiln: null,
      firedOn: null,
    });
    expect(fired).toMatchObject(firing);
  });

  it('keeps custom steps as saved and gives older steps the glaze type', async () => {
    const custom = {
      position: 2,
      type: 'CUSTOM',
      label: 'Bisque firing',
      notes: 'Cone 04',
      glazeId: null,
      coats: null,
      method: null,
      manufacturer: null,
      name: null,
    };
    const older = { position: 1, glazeId: 'g1', coats: 1, manufacturer: 'Amaco', name: 'Blue' };
    await saveSnapshot('user-1', {
      glazes: [],
      combinations: [{ id: 'c1', title: 'Fired', steps: [older, custom], images: [] }],
      stock: [],
      clubs: [],
    } as unknown as Snapshot);
    const steps = (await readSnapshot('user-1'))?.combinations[0].steps;
    expect(steps?.[0]).toMatchObject({ type: 'GLAZE', glazeId: 'g1', label: null });
    expect(steps?.[1]).toEqual(custom);
  });

  it('reads pictures saved before visibility changes as not owned, without a club, caption or firing date, with a card URL', async () => {
    const legacyImage = {
      id: 'i1',
      kind: 'TEST_TILE',
      visibility: 'PUBLIC',
      url: '/api/images/i1',
    };
    await saveSnapshot('user-1', {
      glazes: [{ id: 'g1', manufacturer: { id: 'm1', shortId: 'A', name: 'A' }, images: [legacyImage] }],
      combinations: [{ id: 'c1', title: 'Blue', steps: [], images: [legacyImage] }],
      stock: [],
      clubs: [],
    } as unknown as Snapshot);
    const saved = await readSnapshot('user-1');
    const normalized = { ...legacyImage, cardUrl: '/api/images/i1/card', own: false, clubId: null, caption: null, firedOn: null };
    expect(saved?.glazes[0].images).toEqual([normalized]);
    // Unknown, not "deleted account" (null): the picture line shows no uploader until the next load replaces it.
    expect(saved?.glazes[0].images[0]).not.toHaveProperty('uploader');
    expect(saved?.combinations[0].images).toEqual([normalized]);
  });

  it('retains packaging kinds while normalizing old picture ownership fields', async () => {
    const packaging = {
      id: 'jar',
      kind: 'PACKAGING',
      visibility: 'PUBLIC',
      url: '/api/images/jar',
    };
    await saveSnapshot('user-1', {
      glazes: [{ id: 'g', images: [packaging] }],
      combinations: [],
      stock: [],
      clubs: [],
    } as unknown as Snapshot);
    expect((await readSnapshot('user-1'))?.glazes[0].images).toEqual([
      { ...packaging, cardUrl: '/api/images/jar/card', own: false, clubId: null, caption: null, firedOn: null },
    ]);
  });

  it('reads a snapshot saved before club members as having none', async () => {
    await saveSnapshot('user-1', { glazes: [], combinations: [], stock: [], clubs: [{ id: 'k1' }] } as unknown as Snapshot);
    expect(await readSnapshot('user-1')).toMatchObject({ clubs: [{ id: 'k1' }], clubMembers: {} });
  });

  it('reads a snapshot saved before buddies as having none', async () => {
    await saveSnapshot('user-1', { glazes: [], combinations: [], stock: [], clubs: [], clubMembers: {} } as unknown as Snapshot);
    expect(await readSnapshot('user-1')).toMatchObject({ buddies: { buddies: [], incoming: [], outgoing: [], hasLink: false } });
  });

  it('reads a snapshot saved before buddy availability as having none', async () => {
    await saveSnapshot('user-1', { glazes: [], combinations: [], stock: [], clubs: [], clubMembers: {}, buddies: emptyBuddies() } as unknown as Snapshot);
    expect(await readSnapshot('user-1')).toMatchObject({ buddyAvailability: { glazes: [], asOf: null } });
  });

  it('reads a snapshot saved before authors showed profile pictures as having none known', async () => {
    await saveSnapshot('user-1', {
      glazes: [],
      combinations: [],
      stock: [],
      clubs: [],
      favorites: { glazeIds: [], combinationIds: [] },
    } as unknown as Snapshot);
    expect(await readSnapshot('user-1')).toMatchObject({ authorAvatars: {} });
  });

  it('keeps saved glaze pictures per account', async () => {
    const snapshot: Snapshot = {
      glazes: [
        {
          id: 'g1',
          manufacturer: { id: 'm1', shortId: 'AMACO', name: 'Amaco' },
          name: 'Blue',
          code: 'PC-20',
          notes: null,
          images: [
            {
              id: 'i1',
              kind: 'TEST_TILE',
              visibility: 'PRIVATE',
              url: '/api/images/i1',
              cardUrl: '/api/images/i1/card',
              width: 1,
              height: 1,
              clubId: null,
              own: true,
              uploader: 'Ada',
              canDelete: true,
              caption: null,
              firedOn: null,
              focusX: null,
              focusY: null,
            },
          ],
          tags: ['satin-matte'],
          barcodes: ['4006381333931'],
          createdAt: '2026-10-28T12:00:00Z',
          addedBy: 'Ada',
          lastEditedAt: '2026-10-30T09:15:00Z',
          lastEditedBy: 'Bo',
        },
      ],
      combinations: [],
      stock: [],
      clubs: [],
      clubMembers: { k1: [{ id: 'u1', displayName: 'Ada', role: 'ADMIN', avatarId: null }] },
      buddies: {
        buddies: [{ id: 'u2', displayName: 'Bo', since: '2026-10-31T10:00:00Z', avatarId: null }],
        incoming: [{ id: 'u3', displayName: 'Cy', since: '2026-10-31T11:00:00Z', avatarId: null }],
        outgoing: [],
        hasLink: true,
      },
      buddyAvailability: { glazes: [{ glazeId: 'g1', buddies: [{ id: 'u2', displayName: 'Bo' }] }], asOf: 1_793_000_000_000 },
      authorAvatars: { u1: 'a1', u2: 'a2' },
      favorites: { glazeIds: [], combinationIds: [] },
    };
    await saveSnapshot('user-1', snapshot);
    expect(await readSnapshot('user-1')).toEqual(snapshot);
    expect(await readSnapshot(null)).toBeNull();
  });
  const empty: Snapshot = {
    glazes: [],
    combinations: [],
    stock: [],
    clubs: [],
    clubMembers: {},
    buddies: emptyBuddies(),
    buddyAvailability: emptyAvailability(),
    authorAvatars: {},
    favorites: { glazeIds: [], combinationIds: [] },
  };

  it('does not import localStorage snapshots from either prefix', async () => {
    localStorage.setItem('glazelab:v1:user-1', JSON.stringify(empty));
    localStorage.setItem('glazebook:v1:user-1', JSON.stringify(empty));
    expect(await readSnapshot('user-1')).toBeNull();
  });

  it('removes old localStorage snapshots of the account on clearing', async () => {
    vi.stubGlobal('caches', { delete: async () => true });
    localStorage.setItem('glazelab:v1:user-1', JSON.stringify(empty));
    localStorage.setItem('glazebook:v1:user-1', JSON.stringify(empty));
    localStorage.setItem('glazelab:v1:user-2', JSON.stringify(empty));
    await clearPrivateCache('user-1');
    expect(localStorage.getItem('glazelab:v1:user-1')).toBeNull();
    expect(localStorage.getItem('glazebook:v1:user-1')).toBeNull();
    expect(localStorage.getItem('glazelab:v1:user-2')).not.toBeNull();
  });

  it('outside a secure context (no Cache Storage) still deletes the snapshot', async () => {
    vi.stubGlobal('caches', undefined);
    await saveSnapshot('user-1', empty);
    await clearPrivateCache('user-1');
    expect(await readSnapshot('user-1')).toBeNull();
  });

  it('deletes private data after pending writes while preserving other snapshots', async () => {
    const removed = vi.fn(async () => true);
    vi.stubGlobal('caches', { delete: removed });
    const saving = saveSnapshot('user-1', empty);
    const clearing = clearPrivateCache('user-1');
    await saveSnapshot(null, empty);
    await saveSnapshot('user-2', empty);
    await Promise.all([saving, clearing]);
    expect(await readSnapshot('user-1')).toBeNull();
    expect(await readSnapshot('user-2')).toEqual(empty);
    expect(await readSnapshot(null)).toEqual(empty);
    expect(removed.mock.calls).toEqual([['glazelab-images-user-1'], ['glazebook-images-user-1']]);
  });

  it('rejects quota errors and can recover on the next write', async () => {
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    await expect(saveSnapshot('user-1', empty)).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
    put.mockRestore();
    await saveSnapshot('user-1', empty);
    expect(await readSnapshot('user-1')).toEqual(empty);
  });

  it('rejects unavailable IndexedDB reads, writes and clears', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(readSnapshot('user-1')).rejects.toThrow();
    await expect(saveSnapshot('user-1', empty)).rejects.toThrow();
    await expect(deleteSnapshot('user-1')).rejects.toThrow();
  });

  it('waits for commit and rejects an aborted transaction', async () => {
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      const result = original.apply(this, args);
      this.transaction.abort();
      return result;
    });
    await expect(saveSnapshot('user-1', empty)).rejects.toThrow();
    expect(await readSnapshot('user-1')).toBeNull();
  });
});

describe('last user', () => {
  it('reads users saved before site admins existed as non-admins', () => {
    const user = { id: 'u1', email: 'ana@example.test', displayName: 'Ana' };
    localStorage.setItem('glazelab:v1:lastUser', JSON.stringify(user));
    expect(readLastUser()).toEqual({ ...user, siteAdmin: false, avatarId: null, diagnosticsOptIn: false, feedUnread: 0, feedBuddies: true, feedClubs: true });
    const admin = {
      ...user,
      siteAdmin: true,
      acceptedTermsVersion: '2026-10-27',
      avatarId: null,
      diagnosticsOptIn: false,
      feedUnread: 3,
      feedBuddies: true,
      feedClubs: false,
    };
    saveLastUser(admin);
    expect(readLastUser()).toEqual(admin);
  });
});

describe('last user and profile pictures', () => {
  it('reads users saved before profile pictures as having none, and keeps a picture ID', () => {
    const user = { id: 'u1', email: 'ana@example.test', displayName: 'Ana', siteAdmin: false, acceptedTermsVersion: null };
    localStorage.setItem('glazelab:v1:lastUser', JSON.stringify(user));
    expect(readLastUser()?.avatarId).toBeNull();
    saveLastUser({ ...user, avatarId: 'a1', diagnosticsOptIn: false, feedUnread: 0, feedBuddies: true, feedClubs: true });
    expect(readLastUser()?.avatarId).toBe('a1');
  });
});

describe('last user and error reports', () => {
  it('reads users saved before error reports as opted out, and keeps the choice', () => {
    const user = { id: 'u1', email: 'ana@example.test', displayName: 'Ana', siteAdmin: false, acceptedTermsVersion: null, avatarId: null };
    localStorage.setItem('glazelab:v1:lastUser', JSON.stringify(user));
    expect(readLastUser()?.diagnosticsOptIn).toBe(false);
    saveLastUser({ ...user, diagnosticsOptIn: true, feedUnread: 0, feedBuddies: true, feedClubs: true });
    expect(readLastUser()?.diagnosticsOptIn).toBe(true);
  });
});

describe('last user and the activity feed', () => {
  it('reads users saved before the feed with no badge and both sources on, and keeps the saved values', () => {
    const user = { id: 'u1', email: 'ana@example.test', displayName: 'Ana', siteAdmin: false, acceptedTermsVersion: null, avatarId: null };
    localStorage.setItem('glazelab:v1:lastUser', JSON.stringify(user));
    expect(readLastUser()).toMatchObject({ feedUnread: 0, feedBuddies: true, feedClubs: true });
    saveLastUser({ ...user, diagnosticsOptIn: false, feedUnread: 7, feedBuddies: false, feedClubs: true });
    expect(readLastUser()).toMatchObject({ feedUnread: 7, feedBuddies: false, feedClubs: true });
  });
});

describe('image cache', () => {
  function cacheWith(saved: Response) {
    const cache = { put: vi.fn(), match: vi.fn(async () => saved.clone()) };
    vi.stubGlobal('caches', { open: async () => cache, has: async () => false });
    return cache;
  }

  /** A fake CacheStorage with real URL keys, as the browser resolves relative ones. */
  function savedImages(entries: Record<string, string[]>) {
    const stores = new Map(
      Object.entries(entries).map(([name, paths]) => [name, new Map(paths.map((path) => [`http://localhost${path}`, new Response('jpeg')]))]),
    );
    vi.stubGlobal('caches', {
      has: async (name: string) => stores.has(name),
      open: async (name: string) => {
        const store = stores.get(name) ?? new Map<string, Response>();
        stores.set(name, store);
        return {
          keys: async () => [...store.keys()].map((url) => new Request(url)),
          delete: async (request: Request) => store.delete(request.url),
          match: async (url: string) => store.get(`http://localhost${url}`)?.clone(),
          put: async (url: string, response: Response) => store.set(`http://localhost${url}`, response),
        };
      },
    });
    return (name: string) => [...(stores.get(name)?.keys() ?? [])].map((url) => new URL(url).pathname);
  }

  const unreachable = async () => {
    throw new TypeError('Failed to fetch');
  };
  const answered = (status: number) => async () => Response.json({ error: status === 429 ? TOO_MANY_REQUESTS : 'Image not found' }, { status });
  /** Shows a picture and releases its object URL; null when nothing is shown. */
  async function shown(url: string, userId: string | null = 'user-1') {
    const object = await imageUrl(url, userId);
    if (object) URL.revokeObjectURL(object);
    return object;
  }

  it('shows a saved copy at once, whatever the network would do', async () => {
    savedImages({ 'glazelab-images-user-1': ['/api/images/i1', '/api/images/i1/card'], 'glazebook-images-user-1': ['/api/images/i2'] });
    // Never answers and never fails: a black hole, a captive portal.
    const request = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', request);
    for (const url of ['/api/images/i1', '/api/images/i1/card', '/api/images/i2']) expect(await shown(url)).toMatch(/^blob:/);
    expect(request).not.toHaveBeenCalled();
  });

  it('serves the saved copy first on a later visit, and asks the network only when nothing is saved', async () => {
    const saved = savedImages({});
    const request = vi.fn(async () => new Response(new Blob(['jpeg'], { type: 'image/jpeg' })));
    vi.stubGlobal('fetch', request);
    expect(await shown('/api/images/i1')).toMatch(/^blob:/);
    expect(request).toHaveBeenCalledTimes(1);
    expect(saved('glazelab-images-user-1')).toEqual(['/api/images/i1']);
    // A new session (reload): the saved copy answers, no request.
    forgetLoadedImages();
    savedImages({ 'glazelab-images-user-1': ['/api/images/i1'] });
    expect(await shown('/api/images/i1')).toMatch(/^blob:/);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('never saves or shows a 200 answer that is not a picture (the tarpit decoy, a portal page) and keeps the saved other size', async () => {
    const saved = savedImages({ 'glazelab-images-user-1': ['/api/images/i1/card'] });
    const decoy = () => new Response(new Uint8Array([1, 2, 250]), { headers: { 'Content-Type': 'application/octet-stream' } });
    const request = vi.fn(async () => decoy());
    vi.stubGlobal('fetch', request);
    const objects = vi.spyOn(URL, 'createObjectURL');
    // The full size answers the decoy: the saved card shows instead, and nothing is saved or dropped.
    expect(await shown('/api/images/i1')).toMatch(/^blob:/);
    expect(await (objects.mock.calls[0][0] as Blob).text()).toBe('jpeg');
    expect(saved('glazelab-images-user-1')).toEqual(['/api/images/i1/card']);
    // Without a saved size nothing shows, and the next view asks again.
    request.mockImplementation(async () => new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } }));
    expect(await shown('/api/images/i2')).toBeNull();
    request.mockImplementation(async () => new Response(new Blob(['jpeg'], { type: 'image/jpeg' })));
    expect(await shown('/api/images/i2')).toMatch(/^blob:/);
    expect(saved('glazelab-images-user-1')).toEqual(['/api/images/i1/card', '/api/images/i2']);
    objects.mockRestore();
  });

  it("keeps one account's saved copy from another account or a guest", async () => {
    savedImages({ 'glazelab-images-user-1': ['/api/images/i1'] });
    const request = vi.fn(unreachable);
    vi.stubGlobal('fetch', request);
    expect(await shown('/api/images/i1', 'user-2')).toBeNull();
    expect(await shown('/api/images/i1', null)).toBeNull();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not show a saved copy that was being read when the saved copies were cleared', async () => {
    let release: (value: Response) => void = () => {};
    const slow = new Promise<Response>((resolve) => (release = resolve));
    vi.stubGlobal('caches', { has: async () => false, open: async () => ({ match: () => slow }) });
    vi.stubGlobal('fetch', vi.fn());
    const reading = imageUrl('/api/images/i1', 'user-1');
    forgetLoadedImages();
    release(new Response('jpeg'));
    expect(await reading).toBeNull();
  });

  it.each([
    ['the app state says offline', () => networkReachable.set(false)],
    ['the browser says offline', () => vi.stubGlobal('navigator', { onLine: false })],
  ])('does not ask the network for an unsaved picture when %s, and shows a saved other size', async (_name, goOffline) => {
    savedImages({ 'glazelab-images-user-1': ['/api/images/i2'] });
    const request = vi.fn(unreachable);
    vi.stubGlobal('fetch', request);
    goOffline();
    expect(await shown('/api/images/i1')).toBeNull();
    expect(await shown('/api/images/i2/card')).toMatch(/^blob:/);
    expect(request).not.toHaveBeenCalled();
    // Online again: the picture is requested.
    networkReachable.set(true);
    vi.stubGlobal('navigator', { onLine: true });
    expect(await shown('/api/images/i1')).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['rate limited', answered(429)],
    ['failing', answered(503)],
    ['unreachable', unreachable],
  ])('shows the saved other size when the download is %s', async (_name, answer) => {
    const saved = savedImages({ 'glazelab-images-user-1': ['/api/images/i1'] });
    vi.stubGlobal('fetch', answer);
    expect(await shown('/api/images/i1/card')).toMatch(/^blob:/);
    expect(saved('glazelab-images-user-1')).toEqual(['/api/images/i1']);
  });

  it.each([401, 403, 404, 410])('a download answered %i drops both saved sizes and shows nothing, even offline later', async (status) => {
    const saved = savedImages({ 'glazelab-images-user-1': ['/api/images/i1', '/api/images/i2'] });
    vi.stubGlobal('fetch', answered(status));
    expect(await shown('/api/images/i1/card')).toBeNull();
    expect(saved('glazelab-images-user-1')).toEqual(['/api/images/i2']);
    vi.stubGlobal('fetch', unreachable);
    expect(await shown('/api/images/i1/card')).toBeNull();
    expect(await shown('/api/images/i1')).toBeNull();
  });

  it('gives up on a download after a few seconds when a saved other size can be shown, and only then', async () => {
    vi.useFakeTimers();
    savedImages({ 'glazelab-images-user-1': ['/api/images/i1'] });
    // A request that hangs until it is aborted.
    vi.stubGlobal(
      'fetch',
      (request: Request) =>
        new Promise<Response>((_resolve, reject) => request.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))),
    );
    let result: string | null | undefined;
    const waiting = imageUrl('/api/images/i1/card', 'user-1').then((object) => (result = object));
    await vi.advanceTimersByTimeAsync(SAVED_DOWNLOAD_TIMEOUT_MS - 1);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(result).toMatch(/^blob:/);
    URL.revokeObjectURL(result!);

    // Nothing saved for this picture: the download may take as long as it takes.
    let answer: (response: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      (request: Request) =>
        new Promise<Response>((resolve, reject) => {
          answer = resolve;
          request.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    result = undefined;
    const slow = imageUrl('/api/images/i9', 'user-1').then((object) => (result = object));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(result).toBeUndefined();
    answer(new Response(new Blob(['jpeg'], { type: 'image/jpeg' })));
    await slow;
    expect(result).toMatch(/^blob:/);
    URL.revokeObjectURL(result!);
  });

  it('times only the answer, so a slow body on a working connection still arrives', async () => {
    vi.useFakeTimers();
    const saved = savedImages({ 'glazelab-images-user-1': ['/api/images/i1/card'] });
    // The headers come at once; the body of the full size trickles in over twice the timeout.
    vi.stubGlobal('fetch', async (request: Request) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          request.signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
          setTimeout(() => controller.enqueue(new TextEncoder().encode('fu')), SAVED_DOWNLOAD_TIMEOUT_MS);
          setTimeout(() => {
            controller.enqueue(new TextEncoder().encode('ll'));
            controller.close();
          }, 2 * SAVED_DOWNLOAD_TIMEOUT_MS);
        },
      });
      return new Response(body, { headers: { 'Content-Type': 'image/jpeg' } });
    });
    const objects = vi.spyOn(URL, 'createObjectURL');
    let result: string | null | undefined;
    const waiting = imageUrl('/api/images/i1', 'user-1').then((object) => (result = object));
    await vi.advanceTimersByTimeAsync(2 * SAVED_DOWNLOAD_TIMEOUT_MS);
    await waiting;
    expect(result).toMatch(/^blob:/);
    // The downloaded full size, not the saved card ('jpeg').
    expect(objects).toHaveBeenCalledTimes(1);
    expect(await (objects.mock.calls[0][0] as Blob).text()).toBe('full');
    expect(saved('glazelab-images-user-1')).toEqual(['/api/images/i1/card', '/api/images/i1']);
    URL.revokeObjectURL(result!);
    objects.mockRestore();
  });

  it('does not time out a download that answers in time', async () => {
    vi.useFakeTimers();
    savedImages({ 'glazelab-images-user-1': ['/api/images/i1'] });
    vi.stubGlobal('fetch', async () => new Response(new Blob(['card'], { type: 'image/jpeg' })));
    const object = await imageUrl('/api/images/i1/card', 'user-1');
    expect(object).toMatch(/^blob:/);
    expect(vi.getTimerCount()).toBe(0);
    URL.revokeObjectURL(object!);
  });

  it('drops named pictures and prunes those no listing shows, in both cache generations', async () => {
    const saved = savedImages({
      'glazelab-images-user-1': ['/api/images/i1', '/api/images/i2', '/api/images/i3'],
      'glazebook-images-user-1': ['/api/images/i2', '/api/images/old'],
      'glazelab-images-user-2': ['/api/images/i1'],
    });
    await dropCachedImages('user-1', ['/api/images/i1']);
    expect(saved('glazelab-images-user-1')).toEqual(['/api/images/i2', '/api/images/i3']);
    await pruneImageCache('user-1', ['/api/images/i2']);
    expect(saved('glazelab-images-user-1')).toEqual(['/api/images/i2']);
    expect(saved('glazebook-images-user-1')).toEqual(['/api/images/i2']);
    expect(saved('glazelab-images-user-2')).toEqual(['/api/images/i1']);
  });

  it('drops and prunes both sizes of a picture by its full-size URL', async () => {
    const saved = savedImages({
      'glazelab-images-user-1': ['/api/images/i1', '/api/images/i1/card', '/api/images/i2/card', '/api/images/i3/card'],
    });
    await dropCachedImages('user-1', ['/api/images/i1']);
    expect(saved('glazelab-images-user-1')).toEqual(['/api/images/i2/card', '/api/images/i3/card']);
    await pruneImageCache('user-1', ['/api/images/i2']);
    expect(saved('glazelab-images-user-1')).toEqual(['/api/images/i2/card']);
  });

  it('saves a card under its own URL and drops both sizes after a removal response', async () => {
    const saved = savedImages({ 'glazelab-images-user-1': ['/api/images/i2'] });
    const requested: string[] = [];
    vi.stubGlobal('fetch', async (request: Request) => {
      requested.push(new URL(request.url).pathname);
      return new Response(new Blob(['card'], { type: 'image/jpeg' }));
    });
    const url = await imageUrl('/api/images/i1/card', 'user-1');
    expect(url).toMatch(/^blob:/);
    URL.revokeObjectURL(url!);
    expect(requested).toEqual(['/api/images/i1/card']);
    expect(saved('glazelab-images-user-1')).toEqual(['/api/images/i2', '/api/images/i1/card']);
    vi.stubGlobal('fetch', async () => Response.json({ error: 'Image not found' }, { status: 404 }));
    expect(await imageUrl('/api/images/i2/card', 'user-1')).toBeNull();
    expect(saved('glazelab-images-user-1')).toEqual(['/api/images/i1/card']);
  });

  it('shows the saved copy of the other size when the wanted one was never saved', async () => {
    savedImages({ 'glazelab-images-user-1': ['/api/images/i1', '/api/images/i2/card'] });
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    for (const shown of ['/api/images/i1/card', '/api/images/i2']) {
      const url = await imageUrl(shown, 'user-1');
      expect(url).toMatch(/^blob:/);
      URL.revokeObjectURL(url!);
    }
    expect(await imageUrl('/api/images/i3/card', 'user-1')).toBeNull();
  });

  it('prunes without failing when storage is unavailable', async () => {
    vi.stubGlobal('caches', undefined);
    await expect(pruneImageCache('user-1', [])).resolves.toBeUndefined();
    await expect(dropCachedImages(null, ['/api/images/i1'])).resolves.toBeUndefined();
  });
  it.each(['open', 'put'] as const)('shows a downloaded image when cache %s fails', async (failure) => {
    const cache = cacheWith(new Response('old'));
    if (failure === 'open')
      vi.stubGlobal('caches', {
        open: async () => {
          throw new DOMException('Disabled', 'SecurityError');
        },
      });
    else cache.put.mockRejectedValue(new DOMException('Full', 'QuotaExceededError'));
    vi.stubGlobal('fetch', async () => new Response(new Blob(['new jpeg'], { type: 'image/jpeg' })));
    const url = await imageUrl('/api/images/i1', 'user-1');
    expect(url).toMatch(/^blob:/);
    URL.revokeObjectURL(url!);
  });

  it('returns unavailable without throwing when both network and storage fail', async () => {
    vi.stubGlobal('caches', undefined);
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Offline');
    });
    expect(await imageUrl('/api/images/i1', 'user-1')).toBeNull();
  });
});

describe('profile pictures in the image cache', () => {
  function savedImages(entries: Record<string, string[]>) {
    const stores = new Map(
      Object.entries(entries).map(([name, paths]) => [name, new Map(paths.map((path) => [`http://localhost${path}`, new Response('jpeg')]))]),
    );
    vi.stubGlobal('caches', {
      has: async (name: string) => stores.has(name),
      open: async (name: string) => {
        const store = stores.get(name) ?? new Map<string, Response>();
        stores.set(name, store);
        return {
          keys: async () => [...store.keys()].map((url) => new Request(url)),
          delete: async (request: Request) => store.delete(request.url),
          match: async (url: string) => store.get(`http://localhost${url}`)?.clone(),
          put: async (url: string, response: Response) => store.set(`http://localhost${url}`, response),
        };
      },
    });
    return (name: string) => [...(stores.get(name)?.keys() ?? [])].map((url) => new URL(url).pathname);
  }

  it('downloads each size from its own endpoint once, saves it per account and serves the saved copy later', async () => {
    const saved = savedImages({});
    const requested: string[] = [];
    vi.stubGlobal('fetch', async (request: Request) => {
      requested.push(new URL(request.url).pathname);
      return new Response(new Blob(['jpeg'], { type: 'image/jpeg' }));
    });
    for (const url of ['/api/avatars/a1', '/api/avatars/a1/small', '/api/avatars/a1/small']) URL.revokeObjectURL((await imageUrl(url, 'user-1'))!);
    expect(requested).toEqual(['/api/avatars/a1', '/api/avatars/a1/small']);
    expect(saved('glazelab-images-user-1')).toEqual(['/api/avatars/a1', '/api/avatars/a1/small']);
    forgetLoadedImages();
    requested.length = 0;
    URL.revokeObjectURL((await imageUrl('/api/avatars/a1/small', 'user-1'))!);
    expect(requested).toEqual([]);
  });

  it('is not pruned by the listing of photos, and leaves with both sizes when dropped', async () => {
    const saved = savedImages({
      'glazelab-images-user-1': ['/api/images/i1', '/api/images/i2', '/api/avatars/a1', '/api/avatars/a1/small', '/api/avatars/a2'],
    });
    await pruneImageCache('user-1', ['/api/images/i1']);
    expect(saved('glazelab-images-user-1')).toEqual(['/api/images/i1', '/api/avatars/a1', '/api/avatars/a1/small', '/api/avatars/a2']);
    await dropCachedImages('user-1', ['/api/avatars/a1', '/api/avatars/a1/small']);
    expect(saved('glazelab-images-user-1')).toEqual(['/api/images/i1', '/api/avatars/a2']);
  });

  it('drops both saved sizes after a 4xx (replaced or removed picture) and shows nothing', async () => {
    const saved = savedImages({ 'glazelab-images-user-1': ['/api/avatars/a1/small'] });
    vi.stubGlobal('fetch', async () => Response.json({ error: 'Profile picture not found' }, { status: 404 }));
    expect(await imageUrl('/api/avatars/a1', 'user-1')).toBeNull();
    expect(saved('glazelab-images-user-1')).toEqual([]);
  });

  it('shows the saved small copy while offline when only it was saved', async () => {
    savedImages({ 'glazelab-images-user-1': ['/api/avatars/a1/small'] });
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    const url = await imageUrl('/api/avatars/a1', 'user-1');
    expect(url).toMatch(/^blob:/);
    URL.revokeObjectURL(url!);
    expect(await imageUrl('/api/avatars/a9/small', 'user-1')).toBeNull();
  });
});

describe('pictures loaded in this session', () => {
  let downloads: string[];
  let answer: (id: string) => Response | Promise<Response>;

  beforeEach(() => {
    downloads = [];
    answer = () => new Response(new Blob(['jpeg'], { type: 'image/jpeg' }));
    // No saved copies: every shown picture comes from the network or this session.
    vi.stubGlobal('caches', {
      delete: async () => true,
      has: async () => false,
      open: async () => {
        throw new DOMException('Disabled', 'SecurityError');
      },
    });
    vi.stubGlobal('fetch', async (request: Request) => {
      const id = new URL(request.url).pathname.split('/').pop()!;
      downloads.push(id);
      return answer(id);
    });
  });

  async function show(id: string, userId: string | null = 'user-1') {
    const url = await imageUrl(`/api/images/${id}`, userId);
    if (url) URL.revokeObjectURL(url);
    return url;
  }

  it('downloads a picture once and gives every view its own object URL', async () => {
    const [first, second] = await Promise.all([imageUrl('/api/images/i1', 'user-1'), imageUrl('/api/images/i1', 'user-1')]);
    const third = await imageUrl('/api/images/i1', 'user-1');
    expect(downloads).toEqual(['i1']);
    expect(new Set([first, second, third]).size).toBe(3);
    // One view revoking its URL leaves the others and the shared Blob usable.
    URL.revokeObjectURL(first!);
    URL.revokeObjectURL(second!);
    URL.revokeObjectURL(third!);
    await show('i1');
    expect(downloads).toEqual(['i1']);
  });

  it('downloads the card and the full size of a picture separately', async () => {
    for (const url of ['/api/images/i1/card', '/api/images/i1/card', '/api/images/i1']) {
      const shown = await imageUrl(url, 'user-1');
      URL.revokeObjectURL(shown!);
    }
    expect(downloads).toEqual(['card', 'i1']);
    await dropCachedImages('user-1', ['/api/images/i1']);
    await imageUrl('/api/images/i1/card', 'user-1').then((url) => URL.revokeObjectURL(url!));
    expect(downloads).toEqual(['card', 'i1', 'card']);
  });

  it('shows this session’s download offline even when storage could not save it', async () => {
    expect(await show('i1')).toMatch(/^blob:/);
    networkReachable.set(false);
    expect(await show('i1')).toMatch(/^blob:/);
    expect(downloads).toEqual(['i1']);
  });

  it('keeps no failures or saved copies, so the next view asks again', async () => {
    answer = () => Response.json({ error: 'Unavailable' }, { status: 503 });
    expect(await show('i1')).toBeNull();
    answer = () => Response.json({ error: TOO_MANY_REQUESTS }, { status: 429 });
    expect(await show('i1')).toBeNull();
    answer = () => new Response(new Blob(['jpeg'], { type: 'image/jpeg' }));
    expect(await show('i1')).toMatch(/^blob:/);
    await show('i1');
    expect(downloads).toEqual(['i1', 'i1', 'i1']);
  });

  it('forgets dropped pictures and those a fresh listing no longer shows', async () => {
    await Promise.all(['i1', 'i2', 'i3'].map((id) => show(id)));
    await dropCachedImages('user-1', ['/api/images/i1']);
    await pruneImageCache('user-1', ['/api/images/i1', '/api/images/i2']);
    // Another account's prune or drop leaves this account's pictures alone.
    await dropCachedImages('user-2', ['/api/images/i2']);
    answer = () => Response.json({ error: 'Image not found' }, { status: 404 });
    expect(await show('i1')).toBeNull();
    expect(await show('i2')).toMatch(/^blob:/);
    expect(await show('i3')).toBeNull();
    expect(downloads).toEqual(['i1', 'i2', 'i3', 'i1', 'i3']);
  });

  it('starts over on sign-out and for another account or a guest', async () => {
    await show('i1');
    await clearPrivateCache('user-1');
    await show('i1');
    await show('i1', 'user-2');
    await show('i1', null);
    await show('i1');
    expect(downloads).toEqual(['i1', 'i1', 'i1', 'i1', 'i1']);
    // Clearing without a signed-in account (e.g. a guest) also forgets.
    await clearPrivateCache(null);
    await show('i1');
    expect(downloads).toHaveLength(6);
  });

  it('keeps at most 200 pictures, dropping the longest unused first', async () => {
    for (let i = 0; i < 200; i++) await show(`p${i}`);
    await show('p0');
    await show('p200');
    expect(downloads).toHaveLength(201);
    await show('p0');
    await show('p1');
    expect(downloads.slice(201)).toEqual(['p1']);
  });

  it('a download finishing after sign-out is not kept for the next account', async () => {
    let finish!: () => void;
    answer = () =>
      new Promise((resolve) => {
        finish = () => resolve(new Response(new Blob(['jpeg'], { type: 'image/jpeg' })));
      });
    const pending = show('i1');
    await vi.waitFor(() => expect(finish).toBeDefined());
    await clearPrivateCache('user-1');
    finish();
    expect(await pending).toMatch(/^blob:/);
    answer = () => new Response(new Blob(['jpeg'], { type: 'image/jpeg' }));
    await show('i1');
    expect(downloads).toEqual(['i1', 'i1']);
  });

  describe('with a working Cache Storage', () => {
    let stores: Map<string, Map<string, Response>>;
    let duringPut: () => Promise<void>;

    beforeEach(() => {
      stores = new Map();
      duringPut = async () => {};
      vi.stubGlobal('caches', {
        has: async (name: string) => stores.has(name),
        delete: async (name: string) => stores.delete(name),
        open: async (name: string) => {
          if (!stores.has(name)) stores.set(name, new Map());
          const store = stores.get(name)!;
          return {
            put: async (url: string, response: Response) => {
              await duringPut();
              store.set(url, response);
            },
            delete: async (request: Request | string) => store.delete(typeof request === 'string' ? request : new URL(request.url).pathname),
            keys: async () => [...store.keys()].map((url) => new Request(`http://localhost${url}`)),
            match: async (url: string) => store.get(url),
          };
        },
      });
    });

    function pendingDownload() {
      let finish!: () => void;
      answer = () =>
        new Promise((resolve) => {
          finish = () => resolve(new Response(new Blob(['jpeg'], { type: 'image/jpeg' })));
        });
      return { start: () => show('i1'), finish: () => finish() };
    }

    it('saves a finished download for offline use', async () => {
      await show('i1');
      expect([...stores.get('glazelab-images-user-1')!.keys()]).toEqual(['/api/images/i1']);
    });

    it('does not re-create a cleared account cache when a download finishes late', async () => {
      const { start, finish } = pendingDownload();
      const pending = start();
      await vi.waitFor(() => expect(downloads).toEqual(['i1']));
      await clearPrivateCache('user-1');
      finish();
      expect(await pending).toMatch(/^blob:/);
      expect(stores.has('glazelab-images-user-1')).toBe(false);
    });

    it('removes the copy of a download forgotten while it was being saved', async () => {
      duringPut = async () => forgetLoadedImages();
      await show('i1');
      expect(stores.get('glazelab-images-user-1')?.size ?? 0).toBe(0);
    });

    it('does not keep a late download after the loaded pictures were forgotten', async () => {
      const { start, finish } = pendingDownload();
      const pending = start();
      await vi.waitFor(() => expect(downloads).toEqual(['i1']));
      forgetLoadedImages();
      finish();
      await pending;
      expect(stores.get('glazelab-images-user-1')?.size ?? 0).toBe(0);
    });
  });
});

describe('the similar looks (33-2)', () => {
  it("removes the account's embeddings with its copy and keeps another account's", async () => {
    vi.stubGlobal('caches', { delete: async () => true });
    await embeddingStore.writeMeta('user-1', { consent: 'on', model: 'm', dimension: 2 });
    await embeddingStore.put('user-1', 'i1', quantize([1, 0]));
    await embeddingStore.writeMeta('user-2', { consent: 'on', model: 'm', dimension: 2 });
    await embeddingStore.put('user-2', 'i2', quantize([0, 1]));
    await clearPrivateCache('user-1');
    expect(await embeddingStore.readMeta('user-1')).toBeNull();
    expect((await embeddingStore.readAll('user-1')).size).toBe(0);
    expect((await embeddingStore.readAll('user-2')).size).toBe(1);
  });

  describe('pictureBlob', () => {
    const saved = (paths: string[]) =>
      vi.stubGlobal('caches', {
        has: async () => true,
        open: async () => ({
          match: async (url: string) => (paths.includes(url) ? new Response('saved') : undefined),
          keys: async () => [],
          delete: async () => true,
        }),
      });
    const jpeg = () => new Response(new Blob(['jpeg'], { type: 'image/jpeg' }));

    it('takes the saved copy without a request', async () => {
      saved(['/api/images/i1/card']);
      const request = vi.fn(async () => jpeg());
      vi.stubGlobal('fetch', request);
      const result = await pictureBlob('/api/images/i1/card', 'user-1');
      expect(result.ok && (await result.blob.text())).toBe('saved');
      expect(request).not.toHaveBeenCalled();
    });

    it('downloads the small size once and saves nothing', async () => {
      const put = vi.fn();
      vi.stubGlobal('caches', {
        has: async () => false,
        open: async () => ({ match: async () => undefined, put, keys: async () => [], delete: async () => true }),
      });
      const request = vi.fn(async () => jpeg());
      vi.stubGlobal('fetch', request);
      const result = await pictureBlob('/api/images/i1/card', 'user-1');
      expect(result.ok).toBe(true);
      expect(request).toHaveBeenCalledTimes(1);
      expect(
        String(
          (request.mock.calls[0] as unknown[])[0] instanceof Request
            ? ((request.mock.calls[0] as unknown[])[0] as Request).url
            : (request.mock.calls[0] as unknown[])[0],
        ),
      ).toContain('/api/images/i1/card');
      expect(put).not.toHaveBeenCalled();
    });

    it('says unreachable for a 200 answer that is not a picture, and keeps the saved copies', async () => {
      saved([]);
      vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1, 2, 250]), { headers: { 'Content-Type': 'application/octet-stream' } }));
      expect(await pictureBlob('/api/images/i1/card', 'user-1')).toEqual({ ok: false, reason: 'unreachable' });
    });

    /** A saved full size of `i1` (the card size is not saved), with a spy on its removal. */
    const savedFullSize = () => {
      const removed = vi.fn(async () => true);
      vi.stubGlobal('caches', {
        has: async () => true,
        open: async () => ({ match: async () => undefined, keys: async () => [new Request('http://localhost/api/images/i1')], delete: removed }),
      });
      return removed;
    };

    it('keeps the saved copies on a 401: the session ended, the picture is not gone (FE-3)', async () => {
      const removed = savedFullSize();
      vi.stubGlobal('fetch', async () => Response.json({ error: 'Please sign in.' }, { status: 401 }));
      expect(await pictureBlob('/api/images/i1/card', 'user-1')).toEqual({ ok: false, reason: 'signed-out' });
      expect(removed).not.toHaveBeenCalled();
    });

    it('drops the saved copies of a picture that answers 404', async () => {
      const removed = savedFullSize();
      vi.stubGlobal('fetch', async () => Response.json({ error: 'Image not found' }, { status: 404 }));
      expect(await pictureBlob('/api/images/i1/card', 'user-1')).toEqual({ ok: false, reason: 'gone' });
      expect(removed).toHaveBeenCalled();
    });

    it("passes a 429's Retry-After on", async () => {
      saved([]);
      vi.stubGlobal('fetch', async () => Response.json({ error: TOO_MANY_REQUESTS }, { status: 429, headers: { 'Retry-After': '7' } }));
      expect(await pictureBlob('/api/images/i1/card', 'user-1')).toEqual({ ok: false, reason: 'unavailable', retryAfterMs: 7000 });
    });

    it('only reads photos: a profile picture URL or another path is gone without a request', async () => {
      saved([]);
      const requests: string[] = [];
      vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
        requests.push(String(input));
        return new Response(new Blob(['x']));
      });
      expect(await pictureBlob('/api/avatars/a1/small', 'user-1')).toEqual({ ok: false, reason: 'gone' });
      expect(await pictureBlob('/api/other/i1', 'user-1')).toEqual({ ok: false, reason: 'gone' });
      expect(requests).toEqual([]);
    });

    it('says gone for a refusal, unavailable for a rate limit or a server message, unreachable for a network failure, offline without a connection', async () => {
      saved([]);
      vi.stubGlobal('fetch', async () => Response.json({ error: 'Image not found' }, { status: 404 }));
      expect(await pictureBlob('/api/images/i1/card', 'user-1')).toEqual({ ok: false, reason: 'gone' });
      vi.stubGlobal('fetch', async () => new Response('', { status: 503 }));
      expect(await pictureBlob('/api/images/i1/card', 'user-1')).toEqual({ ok: false, reason: 'unreachable' });
      vi.stubGlobal('fetch', async () => Response.json({ error: 'Image storage failed' }, { status: 500 }));
      expect(await pictureBlob('/api/images/i1/card', 'user-1')).toEqual({ ok: false, reason: 'unavailable' });
      vi.stubGlobal('fetch', async () => Response.json({ error: TOO_MANY_REQUESTS }, { status: 429 }));
      expect(await pictureBlob('/api/images/i1/card', 'user-1')).toEqual({ ok: false, reason: 'unavailable' });
      vi.stubGlobal('fetch', async () => {
        throw new TypeError('Failed to fetch');
      });
      expect(await pictureBlob('/api/images/i1/card', 'user-1')).toEqual({ ok: false, reason: 'unreachable' });
      networkReachable.set(false);
      const request = vi.fn();
      vi.stubGlobal('fetch', request);
      expect(await pictureBlob('/api/images/i1/card', 'user-1')).toEqual({ ok: false, reason: 'offline' });
      expect(request).not.toHaveBeenCalled();
      expect(await pictureBlob('/somewhere/else', 'user-1')).toEqual({ ok: false, reason: 'gone' });
    });
  });
});
