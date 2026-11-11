import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { quantize } from './embeddings';
import { createEmbeddingStore, DATABASE, type EmbeddingStore } from './embedding-store';

let factory: IDBFactory;
let store: EmbeddingStore;

const names = async () => (await factory.databases()).map((database) => database.name);
const meta = { consent: 'on', model: 'm', dimension: 2 } as const;

beforeEach(() => {
  factory = new IDBFactory();
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  store = createEmbeddingStore(() => factory);
});

describe('the embedding store', () => {
  it('creates no database by being read: before the person agreed there is no trace', async () => {
    expect(await store.readMeta('a')).toBeNull();
    expect((await store.readAll('a')).size).toBe(0);
    expect(await store.prune('a', new Set())).toEqual([]);
    await store.clearOwner('a');
    await store.clearVectors('a');
    expect(await names()).toEqual([]);
  });

  it('keeps the choice and the vectors per account, vectors by image ID', async () => {
    await store.writeMeta('a', meta);
    await store.put('a', 'i1', quantize([1, 0]));
    await store.put('a', 'i2', quantize([0, 1]));
    await store.put('b', 'i1', quantize([1, 1]));
    expect(await names()).toEqual([DATABASE]);
    expect(await store.readMeta('a')).toEqual(meta);
    expect(await store.readMeta('b')).toBeNull();
    const stored = await store.readAll('a');
    expect([...stored.keys()].sort()).toEqual(['i1', 'i2']);
    expect(stored.get('i1')!.q).toBeInstanceOf(Int8Array);
    expect([...stored.get('i1')!.q]).toEqual([127, 0]);
    expect((await store.readAll('b')).size).toBe(1);
  });

  it('survives a new store on the same database (a reload)', async () => {
    await store.writeMeta('a', meta);
    await store.put('a', 'i1', quantize([1, 0]));
    const again = createEmbeddingStore(() => factory);
    expect(await again.readMeta('a')).toEqual(meta);
    expect((await again.readAll('a')).size).toBe(1);
  });

  it('prunes to the photos still listed and says which went', async () => {
    await store.writeMeta('a', meta);
    for (const id of ['i1', 'i2', 'i3']) await store.put('a', id, quantize([1, 0]));
    await store.put('b', 'i2', quantize([1, 0]));
    expect((await store.prune('a', new Set(['i2']))).sort()).toEqual(['i1', 'i3']);
    expect([...(await store.readAll('a')).keys()]).toEqual(['i2']);
    expect((await store.readAll('b')).size).toBe(1);
    expect(await store.readMeta('a')).toEqual(meta);
  });

  it('clears the vectors but keeps the choice, or everything of one account only', async () => {
    await store.writeMeta('a', meta);
    await store.writeMeta('b', meta);
    await store.put('a', 'i1', quantize([1, 0]));
    await store.put('b', 'i1', quantize([1, 0]));
    await store.clearVectors('a');
    expect((await store.readAll('a')).size).toBe(0);
    expect(await store.readMeta('a')).toEqual(meta);
    await store.put('a', 'i1', quantize([1, 0]));
    await store.clearOwner('a');
    expect(await store.readMeta('a')).toBeNull();
    expect((await store.readAll('a')).size).toBe(0);
    expect(await store.readMeta('b')).toEqual(meta);
    expect((await store.readAll('b')).size).toBe(1);
  });

  it('deletes the whole database, also with a connection open, and can start again', async () => {
    await store.writeMeta('a', meta);
    await store.put('a', 'i1', quantize([1, 0]));
    await store.clearAll();
    expect(await names()).toEqual([]);
    expect(await store.readMeta('a')).toBeNull();
    await store.writeMeta('a', { ...meta, consent: 'off' });
    expect((await store.readMeta('a'))?.consent).toBe('off');
  });

  it('runs a deletion after the writes queued before it', async () => {
    await store.writeMeta('a', meta);
    const writes = [1, 2, 3, 4, 5].map((n) => store.put('a', `i${n}`, quantize([1, 0])));
    const cleared = store.clearOwner('a');
    await Promise.all([...writes, cleared]);
    expect((await store.readAll('a')).size).toBe(0);
  });

  it('answers as if empty where the browser has no IndexedDB', async () => {
    const none = createEmbeddingStore(() => undefined);
    expect(await none.readMeta('a')).toBeNull();
    await expect(none.writeMeta('a', meta)).resolves.toBeUndefined();
    await none.clearAll();
  });
});
