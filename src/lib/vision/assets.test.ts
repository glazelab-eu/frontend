import { describe, expect, it } from 'vitest';
import { isCached, loadAssets, megabytes, totalBytes, VisionLoadError, type AssetCache, type VisionAssetFiles } from './assets';
import type { VisionLabels } from './labels';

const labels: VisionLabels = {
  model: { id: 'm', source: 's', input: 224, mean: [0, 0, 0], std: [1, 1, 1], scale: 50, dimension: 2 },
  thresholds: { minProbability: 0.15, minCosine: 0.3, maxSuggestions: 3 },
  labels: [{ id: 'mug', tags: { en: 'mug', de: 'becher', 'pt-PT': 'caneca', it: 'mug', es: 'mug' }, embedding: [1, 0] }],
};
const labelBytes = new TextEncoder().encode(JSON.stringify(labels));
const bytes = { 'model.onnx': new Uint8Array(3000).fill(1), 'ort-wasm-simd-threaded.wasm': new Uint8Array(5000).fill(2), 'labels.json': labelBytes };
const assets: VisionAssetFiles = {
  base: '/assets/vision-0123456789abcdef/',
  files: { 'model.onnx': 3000, 'ort-wasm-simd-threaded.wasm': 5000, 'labels.json': labelBytes.length },
};
const url = (name: string) => `http://localhost${assets.base}${name}`;

function fakeCache(initial: Record<string, Uint8Array> = {}) {
  const store = new Map(Object.entries(initial));
  const cache: AssetCache = {
    match: async (key) => (store.has(key) ? new Response(store.get(key)!.slice()) : undefined),
    put: async (key, response) => void store.set(key, new Uint8Array(await response.arrayBuffer())),
    keys: async () => [...store.keys()],
    delete: async (key) => store.delete(key),
  };
  return { cache, store };
}

function fakeFetch(overrides: Record<string, () => Response | Promise<Response>> = {}) {
  const requested: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = String(input);
    requested.push({ url: key, init });
    const name = key.split('/').pop() as keyof typeof bytes;
    if (overrides[name]) return overrides[name]();
    return new Response(bytes[name].slice(), { status: 200 });
  }) as typeof fetch;
  return { fetcher, requested };
}

describe('sizes', () => {
  it('adds up the downloaded files and rounds the notice up to whole megabytes', () => {
    expect(totalBytes(assets)).toBe(8000 + labelBytes.length);
    expect(megabytes(24_300_000)).toBe(25);
    expect(megabytes(24_000_000)).toBe(24);
    expect(megabytes(10)).toBe(1);
  });
});

describe('loadAssets', () => {
  it('downloads every file without the HTTP cache, reports progress up to 1 and keeps the files for offline use', async () => {
    const { cache, store } = fakeCache();
    const { fetcher, requested } = fakeFetch();
    const progress: number[] = [];
    const loaded = await loadAssets(assets, { cache, fetcher, onProgress: (fraction) => progress.push(fraction) });
    expect(loaded.labels.labels[0].id).toBe('mug');
    expect(loaded.model.byteLength).toBe(3000);
    expect(loaded.wasm.byteLength).toBe(5000);
    expect(requested.map((request) => request.url)).toEqual([url('model.onnx'), url('ort-wasm-simd-threaded.wasm'), url('labels.json')]);
    for (const request of requested) expect(request.init?.cache).toBe('no-store');
    expect([...store.keys()].sort()).toEqual(['labels.json', 'model.onnx', 'ort-wasm-simd-threaded.wasm'].map(url).sort());
    expect(progress.length).toBeGreaterThan(0);
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
    expect(progress.at(-1)).toBe(1);
  });

  it('uses the device cache without a single request when everything is there (offline use)', async () => {
    const { cache } = fakeCache({
      [url('model.onnx')]: bytes['model.onnx'],
      [url('ort-wasm-simd-threaded.wasm')]: bytes['ort-wasm-simd-threaded.wasm'],
      [url('labels.json')]: labelBytes,
    });
    const { fetcher, requested } = fakeFetch();
    const loaded = await loadAssets(assets, { cache, fetcher });
    expect(loaded.model.byteLength).toBe(3000);
    expect(requested).toEqual([]);
    expect(await isCached(assets, cache)).toBe(true);
  });

  it('fetches only what is missing or has the wrong size', async () => {
    const { cache } = fakeCache({ [url('model.onnx')]: new Uint8Array(10), [url('labels.json')]: labelBytes });
    const { fetcher, requested } = fakeFetch();
    await loadAssets(assets, { cache, fetcher });
    expect(requested.map((request) => request.url)).toEqual([url('model.onnx'), url('ort-wasm-simd-threaded.wasm')]);
  });

  it('says offline when the connection is down, and caches nothing it did not finish', async () => {
    const { cache, store } = fakeCache();
    const { fetcher } = fakeFetch({
      'ort-wasm-simd-threaded.wasm': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await expect(loadAssets(assets, { cache, fetcher })).rejects.toMatchObject({ problem: 'offline' });
    expect([...store.keys()]).toEqual([url('model.onnx')]);
    expect(await isCached(assets, cache)).toBe(false);
  });

  it('fails on an error answer, and on a body of the wrong size (a fallback page, a cut-off download), caching neither', async () => {
    const error = fakeCache();
    await expect(
      loadAssets(assets, { cache: error.cache, fetcher: fakeFetch({ 'model.onnx': () => new Response('nope', { status: 404 }) }).fetcher }),
    ).rejects.toBeInstanceOf(VisionLoadError);
    const wrong = fakeCache();
    await expect(
      loadAssets(assets, { cache: wrong.cache, fetcher: fakeFetch({ 'model.onnx': () => new Response('<!doctype html>', { status: 200 }) }).fetcher }),
    ).rejects.toMatchObject({ problem: 'failed' });
    expect(wrong.store.size).toBe(0);
  });

  it('fails on a label file that is not valid, and does not keep it', async () => {
    const { cache, store } = fakeCache();
    const bad = new TextEncoder().encode('{}');
    const sized: VisionAssetFiles = { ...assets, files: { ...assets.files, 'labels.json': bad.length } };
    await expect(loadAssets(sized, { cache, fetcher: fakeFetch({ 'labels.json': () => new Response(bad.slice()) }).fetcher })).rejects.toMatchObject({
      problem: 'failed',
    });
    expect(store.has(url('labels.json'))).toBe(false);
  });

  it('drops the files of an older version but leaves other assets alone', async () => {
    const old = 'http://localhost/assets/vision-fedcba9876543210/model.onnx';
    const worker = 'http://localhost/assets/vision-worker-abc.js';
    const { cache, store } = fakeCache({ [old]: new Uint8Array(2), [worker]: new Uint8Array(2) });
    await loadAssets(assets, { cache, fetcher: fakeFetch().fetcher });
    expect(store.has(old)).toBe(false);
    expect(store.has(worker)).toBe(true);
  });

  it('stops at once when aborted', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('stop', 'AbortError'));
    const { fetcher, requested } = fakeFetch();
    await expect(loadAssets(assets, { cache: fakeCache().cache, fetcher, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(requested).toEqual([]);
  });

  it('still works when the cache refuses to store (full storage)', async () => {
    const { cache } = fakeCache();
    const refusing: AssetCache = {
      ...cache,
      put: async () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
    };
    const loaded = await loadAssets(assets, { cache: refusing, fetcher: fakeFetch().fetcher });
    expect(loaded.labels.labels).toHaveLength(1);
  });
});

describe('isCached', () => {
  it('is false without a cache, with a missing file or with a file of the wrong size', async () => {
    expect(await isCached(assets, null)).toBe(false);
    const { cache } = fakeCache({ [url('model.onnx')]: bytes['model.onnx'] });
    expect(await isCached(assets, cache)).toBe(false);
    const wrongSize = fakeCache({
      [url('model.onnx')]: new Uint8Array(1),
      [url('ort-wasm-simd-threaded.wasm')]: bytes['ort-wasm-simd-threaded.wasm'],
      [url('labels.json')]: labelBytes,
    });
    expect(await isCached(assets, wrongSize.cache)).toBe(false);
  });
});
