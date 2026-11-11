import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { get, writable } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Combination, Glaze } from '../../lib/api/models';
import type { PictureBlob } from '../../lib/offline/offline';
import { createEmbeddingStore, type EmbeddingStore } from '../../lib/vision/embedding-store';
import type { LibraryPhoto } from '../../lib/vision/library';
import { combination, glaze, imageInfo } from '../../test/fixtures';
import type { PhotoSuggestionsState, PhotoSuggestions } from './photo-suggestions';
import { createSimilarLooks, type Environment, type LibraryInput, type SimilarLooks } from './similar-looks';

let factory: IDBFactory;
let store: EmbeddingStore;

beforeEach(() => {
  factory = new IDBFactory();
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  store = createEmbeddingStore(() => factory);
});

const databases = async () => (await factory.databases()).map((database) => database.name);

/** The vector a test photo has: its ID's digits are its direction, so photos with near IDs look alike. */
const vectors: Record<string, number[]> = {
  red1: [1, 0, 0],
  red2: [0.95, 0.05, 0],
  blue1: [0, 0, 1],
  blue2: [0.05, 0, 0.95],
  piece1: [1, 0, 0],
  piece2: [0.9, 0.1, 0],
  gone: [0, 1, 0],
};
const photo = (id: string, kind: 'TEST_TILE' | 'FINISHED' = 'TEST_TILE') =>
  imageInfo({ id, kind, url: `/api/images/${id}`, cardUrl: `/api/images/${id}/card` });

const libraryOf = (glazes: Glaze[], combinations: Combination[], extra: Partial<LibraryInput> = {}): LibraryInput => ({
  accountId: 'acc-1',
  glazes,
  combinations,
  online: true,
  settled: true,
  ...extra,
});
const defaultGlazes = () => [glaze({ id: 'g-red', images: [photo('red1')] }), glaze({ id: 'g-blue', images: [photo('blue1'), photo('blue2')] })];
const defaultCombinations = () => [
  combination({ id: 'c-red', images: [photo('red2'), photo('piece1', 'FINISHED')] }),
  combination({ id: 'c-piece', images: [photo('piece2', 'FINISHED')] }),
];

function harness(options: { preference?: 'on' | 'off' | null; library?: LibraryInput } = {}) {
  const modelState = writable<PhotoSuggestionsState>({
    preference: options.preference === undefined ? 'on' : options.preference,
    status: options.preference === 'off' || options.preference === null ? 'off' : 'ready',
    progress: 0,
    checkMs: null,
    bytes: 1,
  });
  const calls = { embed: 0, fetch: [] as string[], resume: 0, retry: 0, waits: [] as number[] };
  const info = { id: 'model-a', dimension: 3 };
  const model = {
    state: modelState,
    async embed(file: Blob) {
      calls.embed++;
      return { ok: true as const, embedding: Float32Array.from(JSON.parse(await file.text())) };
    },
    modelInfo: () => (get(modelState).status === 'ready' ? info : null),
    async resume() {
      calls.resume++;
      modelState.update((value) => ({ ...value, status: 'ready' }));
    },
  } as unknown as PhotoSuggestions;
  const library = writable<LibraryInput>(options.library ?? libraryOf(defaultGlazes(), defaultCombinations()));
  const conditions = { hidden: false, battery: null as { charging: boolean; level: number } | null, metered: false };
  const listeners = new Set<() => void>();
  const environment: Environment = {
    read: () => conditions,
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    idle: () => Promise.resolve(),
    retry: (ms) => {
      calls.retry++;
      calls.waits.push(ms);
      return hooks.retry?.() ?? Promise.resolve();
    },
  };
  const missing = new Set<string>();
  /** How many more fetches find no connection (the app may not know it yet). */
  const unreachable = { count: 0 };
  /** Answers that come before the photo itself, one per fetch, for any photo. */
  const failures: PictureBlob[] = [];
  const hooks: { onFetch?: (id: string) => void; retry?: () => Promise<void> } = {};
  const fetchPhoto = async (item: LibraryPhoto): Promise<PictureBlob> => {
    calls.fetch.push(item.id);
    hooks.onFetch?.(item.id);
    if (unreachable.count > 0) {
      unreachable.count--;
      return { ok: false, reason: 'offline' };
    }
    const failure = failures.shift();
    if (failure) return failure;
    if (missing.has(item.id)) return { ok: false, reason: 'gone' };
    return { ok: true, blob: new Blob([JSON.stringify(vectors[item.id] ?? [0, 0, 1])]) };
  };
  const make = () => createSimilarLooks({ photos: model, library, store, environment, fetchPhoto });
  return { modelState, library, calls, conditions, listeners, missing, unreachable, failures, hooks, make, info };
}

async function settle(similar: SimilarLooks, status: string) {
  await vi.waitFor(() => expect(get(similar.state).status).toBe(status));
}

describe('while the model is off', () => {
  it('knows no photos of the library, and counts them when the model is turned on', async () => {
    const h = harness({ preference: 'off' });
    const similar = h.make();
    h.library.set(libraryOf(defaultGlazes(), defaultCombinations()));
    await settle(similar, 'off');
    expect(get(similar.state).total).toBe(0);
    h.modelState.set({ preference: 'on', status: 'ready', progress: 0, checkMs: null, bytes: 1 });
    await settle(similar, 'ask');
    expect(get(similar.state)).toMatchObject({ total: 6, done: 0 });
  });

  it('forgets the photos when turned off, and counts the listings of that moment when turned on again', async () => {
    const h = harness({ preference: 'on' });
    const similar = h.make();
    h.library.set(libraryOf(defaultGlazes(), defaultCombinations()));
    await settle(similar, 'ask');
    expect(get(similar.state).total).toBe(6);
    const on = { preference: 'on', status: 'ready', progress: 0, checkMs: null, bytes: 1 } as const;
    h.modelState.set({ ...on, preference: 'off' });
    await settle(similar, 'off');
    expect(get(similar.state).total).toBe(0);
    h.library.set(libraryOf(defaultGlazes(), []));
    await settle(similar, 'off');
    expect(get(similar.state).total).toBe(0);
    h.modelState.set(on);
    await settle(similar, 'ask');
    expect(get(similar.state).total).toBeLessThan(6);
    expect(get(similar.state).total).toBeGreaterThan(0);
  });

  it('never knows photos for a guest, whatever the model', async () => {
    const h = harness({ preference: 'on' });
    const similar = h.make();
    h.library.set({ ...libraryOf(defaultGlazes(), defaultCombinations()), accountId: null });
    await settle(similar, 'off');
    expect(get(similar.state).total).toBe(0);
  });
});

describe('before the second consent', () => {
  it('reads, requests, embeds and stores nothing and leaves no database', async () => {
    const h = harness();
    const similar = h.make();
    await settle(similar, 'ask');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.calls).toEqual({ embed: 0, fetch: [], resume: 0, retry: 0, waits: [] });
    expect(await databases()).toEqual([]);
    expect(get(similar.state)).toMatchObject({ status: 'ask', total: 6, done: 0 });
    expect(similar.forPhoto('red1')).toEqual([]);
  });

  it('offers nothing while the model is off, for a guest, or after the model was never agreed to', async () => {
    const off = harness({ preference: null }).make();
    expect(get(off.state).status).toBe('off');
    const guest = harness({ library: libraryOf([], [], { accountId: null }) }).make();
    expect(get(guest.state).status).toBe('off');
  });

  it('"Later" is remembered for the account and nothing is indexed', async () => {
    const h = harness();
    const similar = h.make();
    await settle(similar, 'ask');
    await similar.stop();
    expect(get(similar.state).status).toBe('declined');
    expect((await store.readMeta('acc-1'))?.consent).toBe('off');
    expect(h.calls.fetch).toEqual([]);
    const reloaded = h.make();
    await settle(reloaded, 'declined');
    expect(h.calls.embed).toBe(0);
  });
});

describe('indexing', () => {
  it('indexes every test tile and finished piece after "Index now", stores them and answers searches', async () => {
    const h = harness();
    const similar = h.make();
    await settle(similar, 'ask');
    await similar.start();
    await settle(similar, 'ready');
    expect(get(similar.state)).toMatchObject({ done: 6, total: 6 });
    expect(h.calls.fetch.sort()).toEqual(['blue1', 'blue2', 'piece1', 'piece2', 'red1', 'red2']);
    expect([...(await store.readAll('acc-1')).keys()].sort()).toEqual(['blue1', 'blue2', 'piece1', 'piece2', 'red1', 'red2']);
    expect(await store.readMeta('acc-1')).toEqual({ consent: 'on', model: 'model-a', dimension: 3 });
    // The red glaze's test tile looks most like the red combination's test tile, not like the blue ones or the finished pieces.
    const groups = similar.forItem('glaze', 'g-red');
    expect(groups.map((group) => group.kind)).toEqual(['TEST_TILE']);
    expect(groups[0].hits.map((hit) => hit.photo.id)).toEqual(['red2', 'blue2']);
  });

  it('keeps finished pieces and test tiles apart', async () => {
    const h = harness();
    const similar = h.make();
    await settle(similar, 'ask');
    await similar.start();
    await settle(similar, 'ready');
    // The combination holds a red tile and a red finished piece: each kind answers with its own kind only.
    const groups = similar.forItem('combination', 'c-red');
    expect(groups.map((group) => [group.kind, group.hits.map((hit) => hit.photo.id)])).toEqual([
      ['FINISHED', ['piece2']],
      ['TEST_TILE', ['red1', 'blue2']],
    ]);
    expect(similar.forPhoto('piece1').map((hit) => hit.photo.id)).toEqual(['piece2']);
  });

  it('never embeds a photo that is not in the listings (a photo the person cannot see is not there)', async () => {
    const h = harness({ library: libraryOf([glaze({ id: 'g', images: [photo('red1')] })], []) });
    const similar = h.make();
    await settle(similar, 'ask');
    await similar.start();
    await settle(similar, 'ready');
    expect(h.calls.fetch).toEqual(['red1']);
    expect([...(await store.readAll('acc-1')).keys()]).toEqual(['red1']);
  });

  it('is resumable: a reload continues with what is missing and starts by itself while the choice stands', async () => {
    const h = harness();
    const first = h.make();
    await settle(first, 'ask');
    await store.writeMeta('acc-1', { consent: 'on', model: 'model-a', dimension: 3 });
    await store.put('acc-1', 'red1', (await import('../../lib/vision/embeddings')).quantize(vectors.red1));
    first.destroy();
    const again = h.make();
    await settle(again, 'ready');
    expect(h.calls.fetch.sort()).toEqual(['blue1', 'blue2', 'piece1', 'piece2', 'red2']);
    expect(get(again.state)).toMatchObject({ done: 6, total: 6 });
  });

  it('stops at once, keeps what is indexed and does not go on until asked', async () => {
    const h = harness();
    const similar = h.make();
    await settle(similar, 'ask');
    let stopped: Promise<void> | undefined;
    h.hooks.onFetch = () => {
      if (h.calls.fetch.length === 2) stopped = similar.stop();
    };
    await similar.start();
    await vi.waitFor(() => expect(stopped).toBeDefined());
    await stopped;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(get(similar.state).status).toBe('declined');
    // The photo in flight when Stop came may finish; no later one is requested.
    expect(h.calls.fetch).toHaveLength(2);
    expect(get(similar.state).done).toBeLessThanOrEqual(1);
    expect((await store.readMeta('acc-1'))?.consent).toBe('off');
    // Index now goes on with what is missing.
    h.hooks.onFetch = undefined;
    await similar.start();
    await settle(similar, 'ready');
    expect(new Set(h.calls.fetch).size).toBe(6);
  });

  it('gives up on a photo that is gone and still finishes', async () => {
    const h = harness();
    h.missing.add('red2');
    const similar = h.make();
    await settle(similar, 'ask');
    await similar.start();
    await settle(similar, 'ready');
    expect(get(similar.state)).toMatchObject({ done: 5, total: 6 });
    expect(similar.forItem('glaze', 'g-red')[0].hits.map((hit) => hit.photo.id)).toEqual(['blue2']);
  });
});

describe('waiting', () => {
  it.each([
    ['hidden', { hidden: true }],
    ['battery', { battery: { charging: false, level: 0.1 } }],
    ['metered', { metered: true }],
  ] as const)('pauses for %s and goes on when it passes', async (reason, change) => {
    const h = harness();
    Object.assign(h.conditions, change);
    const similar = h.make();
    await settle(similar, 'ask');
    await similar.start();
    // "Index now" on a metered connection is the agreement to use it.
    if (reason === 'metered') h.conditions.metered = true;
    if (reason !== 'metered') {
      await settle(similar, 'paused');
      expect(get(similar.state).paused).toBe(reason);
      expect(h.calls.fetch).toEqual([]);
      Object.assign(h.conditions, { hidden: false, battery: null });
      for (const listener of h.listeners) listener();
    }
    await settle(similar, 'ready');
  });

  it('on a metered connection a later session waits for the person, who can allow it', async () => {
    const h = harness();
    await store.writeMeta('acc-1', { consent: 'on', model: 'model-a', dimension: 3 });
    h.conditions.metered = true;
    const similar = h.make();
    await settle(similar, 'paused');
    expect(get(similar.state).paused).toBe('metered');
    expect(h.calls.fetch).toEqual([]);
    similar.allowMetered();
    await settle(similar, 'ready');
  });

  it('waits while offline and goes on when the connection returns', async () => {
    const h = harness({ library: libraryOf(defaultGlazes(), defaultCombinations(), { online: false }) });
    const similar = h.make();
    await settle(similar, 'ask');
    await similar.start();
    await settle(similar, 'paused');
    expect(get(similar.state).paused).toBe('offline');
    h.library.update((value) => ({ ...value, online: true }));
    await settle(similar, 'ready');
  });

  it('never gives up a photo it found no connection for, even while the app still thinks it is online: it waits and tries again (E2E-similar-1)', async () => {
    const h = harness();
    // More misses than photos: before, each was given up for the session at once and the indexing said "ready" at 0 of 6.
    h.unreachable.count = 10;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    h.hooks.retry = () => gate;
    const similar = h.make();
    await settle(similar, 'ask');
    await similar.start();
    await settle(similar, 'paused');
    expect(get(similar.state)).toMatchObject({ paused: 'offline', done: 0, total: 6 });
    h.hooks.retry = undefined;
    release();
    await settle(similar, 'ready');
    expect(get(similar.state)).toMatchObject({ done: 6, total: 6 });
    expect(h.calls.retry).toBe(10);
  });

  // FE-3: every failure waits before the next request, longer each time, and never gives a photo up.
  it('waits longer after each server problem or failed request and still indexes every photo', async () => {
    const h = harness();
    h.failures.push({ ok: false, reason: 'unavailable' }, { ok: false, reason: 'unreachable' }, { ok: false, reason: 'unavailable' });
    const similar = h.make();
    await settle(similar, 'ask');
    await similar.start();
    await settle(similar, 'ready');
    expect(get(similar.state)).toMatchObject({ done: 6, total: 6 });
    expect(h.calls.waits).toEqual([3000, 6000, 12000]);
    expect(h.calls.fetch).toHaveLength(9);
  });

  it('caps the growing wait and starts again from the shortest after a photo arrived', async () => {
    const h = harness();
    h.failures.push(...Array.from({ length: 8 }, () => ({ ok: false, reason: 'unavailable' }) as const));
    const similar = h.make();
    await settle(similar, 'ask');
    await similar.start();
    await settle(similar, 'ready');
    expect(h.calls.waits).toEqual([3000, 6000, 12000, 24000, 48000, 60000, 60000, 60000]);
    h.failures.push({ ok: false, reason: 'unavailable' });
    h.library.set(libraryOf([...defaultGlazes(), glaze({ id: 'g-new', images: [photo('red3')] })], defaultCombinations()));
    await vi.waitFor(() => expect(h.calls.waits).toHaveLength(9));
    expect(h.calls.waits[8]).toBe(3000);
  });

  it("waits at least a rate limit's Retry-After", async () => {
    const h = harness();
    h.failures.push({ ok: false, reason: 'unavailable', retryAfterMs: 20_000 });
    const similar = h.make();
    await settle(similar, 'ask');
    await similar.start();
    await settle(similar, 'ready');
    expect(h.calls.waits).toEqual([20_000]);
  });

  it('shows a failed request as waiting for the connection, and a server problem as still indexing', async () => {
    const h = harness();
    let release!: () => void;
    h.hooks.retry = () => new Promise<void>((resolve) => (release = resolve));
    h.failures.push({ ok: false, reason: 'unreachable' }, { ok: false, reason: 'unavailable' });
    const similar = h.make();
    await settle(similar, 'ask');
    await similar.start();
    await settle(similar, 'paused');
    expect(get(similar.state).paused).toBe('offline');
    release();
    await vi.waitFor(() => expect(h.calls.retry).toBe(2));
    expect(get(similar.state)).toMatchObject({ status: 'indexing', paused: null });
    h.hooks.retry = undefined;
    release();
    await settle(similar, 'ready');
  });

  it('stops at a 401 without giving the photo up and goes on after the next settled load', async () => {
    const h = harness();
    h.failures.push({ ok: false, reason: 'signed-out' });
    const similar = h.make();
    await settle(similar, 'ask');
    await similar.start();
    await vi.waitFor(() => expect(h.calls.fetch).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.calls.fetch).toHaveLength(1);
    expect(get(similar.state)).toMatchObject({ status: 'indexing', done: 0 });
    // A listing change or a condition change alone does not start it again: only a load that settled.
    for (const listener of h.listeners) listener();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.calls.fetch).toHaveLength(1);
    h.library.update((value) => ({ ...value, settled: false }));
    h.library.update((value) => ({ ...value, settled: true }));
    await settle(similar, 'ready');
    expect(get(similar.state)).toMatchObject({ done: 6, total: 6 });
    expect(h.calls.fetch.filter((id) => id === h.calls.fetch[0])).toHaveLength(2);
  });

  it('stops after three photos in a row are gone, never asks for them again, and goes on after the next settled load', async () => {
    const h = harness();
    for (const id of ['red1', 'blue1', 'blue2']) h.missing.add(id);
    const similar = h.make();
    await settle(similar, 'ask');
    await similar.start();
    await vi.waitFor(() => expect(h.calls.fetch).toHaveLength(3));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.calls.fetch).toEqual(['red1', 'blue1', 'blue2']);
    expect(get(similar.state).status).toBe('indexing');
    h.library.update((value) => ({ ...value, settled: false }));
    h.library.update((value) => ({ ...value, settled: true }));
    await settle(similar, 'ready');
    expect(get(similar.state)).toMatchObject({ done: 3, total: 6 });
    expect(h.calls.fetch.slice(3).sort()).toEqual(['piece1', 'piece2', 'red2']);
  });

  it('indexes nothing before a load of the account has settled (the snapshot may name photos that are gone)', async () => {
    const h = harness({ library: libraryOf(defaultGlazes(), defaultCombinations(), { settled: false }) });
    await store.writeMeta('acc-1', { consent: 'on', model: 'model-a', dimension: 3 });
    const similar = h.make();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.calls.fetch).toEqual([]);
    h.library.update((value) => ({ ...value, settled: true }));
    await settle(similar, 'ready');
  });

  it('starts the model for the indexing when it is not running (after a reload) and waits when it cannot', async () => {
    const h = harness();
    h.modelState.update((value) => ({ ...value, status: 'idle' }));
    await store.writeMeta('acc-1', { consent: 'on', model: null, dimension: null });
    const similar = h.make();
    await settle(similar, 'ready');
    expect(h.calls.resume).toBeGreaterThan(0);

    await store.clearAll();
    const blocked = harness();
    blocked.modelState.update((value) => ({ ...value, status: 'failed' }));
    const waiting = blocked.make();
    await settle(waiting, 'ask');
    await waiting.start();
    await settle(waiting, 'paused');
    expect(get(waiting.state).paused).toBe('model');
  });
});

describe('what leaves with the listings, the account and the model', () => {
  async function indexed() {
    const h = harness();
    const similar = h.make();
    await settle(similar, 'ask');
    await similar.start();
    await settle(similar, 'ready');
    return { h, similar };
  }

  it('drops the vectors of photos the settled listings no longer show, and not while a load runs', async () => {
    const { h, similar } = await indexed();
    h.library.set(libraryOf([glaze({ id: 'g-red', images: [photo('red1')] })], [], { settled: false }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await store.readAll('acc-1')).size).toBe(6);
    h.library.set(libraryOf([glaze({ id: 'g-red', images: [photo('red1')] })], [], { settled: true }));
    await vi.waitFor(async () => expect([...(await store.readAll('acc-1')).keys()]).toEqual(['red1']));
    expect(get(similar.state)).toMatchObject({ done: 1, total: 1 });
    expect(similar.forPhoto('red1')).toEqual([]);
  });

  it("forgets everything in memory when the account changes and reads the new account's own choice", async () => {
    const { h, similar } = await indexed();
    h.library.set(libraryOf(defaultGlazes(), defaultCombinations(), { accountId: 'acc-2' }));
    await settle(similar, 'ask');
    expect(similar.forItem('glaze', 'g-red')).toEqual([]);
    expect(get(similar.state).done).toBe(0);
    h.library.set(libraryOf([], [], { accountId: null }));
    expect(get(similar.state).status).toBe('off');
    // The first account's vectors stay in storage until its sign-out removes them (`clearPrivateCache`), and are its own.
    expect((await store.readAll('acc-1')).size).toBe(6);
    expect((await store.readAll('acc-2')).size).toBe(0);
  });

  it('removes the database and the choice when the model is turned off, and offers nothing', async () => {
    const { h, similar } = await indexed();
    h.modelState.set({ preference: 'off', status: 'off', progress: 0, checkMs: null, bytes: 1 });
    await vi.waitFor(async () => expect(await databases()).toEqual([]));
    expect(get(similar.state).status).toBe('off');
    expect(similar.forItem('glaze', 'g-red')).toEqual([]);
    // Turning the model on again asks again: nothing of the old choice is left.
    h.modelState.set({ preference: 'on', status: 'ready', progress: 0, checkMs: null, bytes: 1 });
    await settle(similar, 'ask');
  });

  it('forget deletes the vectors and leaves the choice at off', async () => {
    const { similar } = await indexed();
    await similar.forget();
    expect(get(similar.state)).toMatchObject({ status: 'declined', done: 0 });
    expect((await store.readAll('acc-1')).size).toBe(0);
    expect(await store.readMeta('acc-1')).toEqual({ consent: 'off', model: null, dimension: null });
  });

  it('forget while a photo is being indexed leaves no vector behind', async () => {
    const h = harness();
    const similar = h.make();
    await settle(similar, 'ask');
    h.hooks.onFetch = () => {
      h.hooks.onFetch = undefined;
      void similar.forget();
    };
    await similar.start();
    await vi.waitFor(async () => expect(await store.readMeta('acc-1')).toEqual({ consent: 'off', model: null, dimension: null }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await store.readAll('acc-1')).size).toBe(0);
    expect(get(similar.state).status).toBe('declined');
  });

  it('a photo the listings dropped while it was being embedded is never stored', async () => {
    const h = harness();
    const similar = h.make();
    await settle(similar, 'ask');
    const remaining = defaultGlazes().filter((item) => item.id !== 'g-red');
    h.hooks.onFetch = (id) => {
      if (id !== 'red1') return;
      h.hooks.onFetch = undefined;
      h.library.set(libraryOf(remaining, defaultCombinations()));
    };
    await similar.start();
    await settle(similar, 'ready');
    expect(h.calls.fetch).toContain('red1');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect([...(await store.readAll('acc-1')).keys()].sort()).toEqual(['blue1', 'blue2', 'piece1', 'piece2', 'red2']);
  });

  it('starts over when the model is another one', async () => {
    const h = harness();
    await store.writeMeta('acc-1', { consent: 'on', model: 'older-model', dimension: 3 });
    await store.put('acc-1', 'red1', (await import('../../lib/vision/embeddings')).quantize([0, 1, 0]));
    const similar = h.make();
    await settle(similar, 'ready');
    // red1 was embedded again under the current model.
    expect(h.calls.fetch).toContain('red1');
    expect((await store.readMeta('acc-1'))?.model).toBe('model-a');
    expect(similar.forItem('glaze', 'g-red')[0].hits[0].photo.id).toBe('red2');
  });
});

describe('a fresh photo', () => {
  it('is searched by its embedding against the library, kind apart', async () => {
    const h = harness();
    const similar = h.make();
    await settle(similar, 'ask');
    await similar.start();
    await settle(similar, 'ready');
    expect(similar.forVector([1, 0.02, 0], 'TEST_TILE').map((hit) => hit.photo.id)).toEqual(['red1', 'red2', 'blue2']);
    expect(similar.forVector([1, 0, 0], 'FINISHED').map((hit) => hit.photo.id)).toEqual(['piece1', 'piece2']);
    expect(similar.forVector([1, 0], 'FINISHED')).toEqual([]);
  });
});
