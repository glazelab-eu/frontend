import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetCache, VisionAssetFiles } from './assets';
import { createVisionClient } from './client';
import type { FromWorker, ToWorker } from './worker-protocol';

const labelsJson = JSON.stringify({
  model: { id: 'm', source: 's', input: 2, mean: [0, 0, 0], std: [1, 1, 1], scale: 50, dimension: 2 },
  thresholds: { minProbability: 0.15, minCosine: 0.3, maxSuggestions: 3 },
  labels: [{ id: 'mug', tags: { en: 'mug', de: 'becher', 'pt-PT': 'caneca', it: 'mug', es: 'mug' }, embedding: [1, 0] }],
});
const labelBytes = new TextEncoder().encode(labelsJson);
const assets: VisionAssetFiles = {
  base: '/assets/vision-0123456789abcdef/',
  files: { 'model.onnx': 4, 'ort-wasm-simd-threaded.wasm': 4, 'labels.json': labelBytes.length },
};
const body = (name: string) => (name === 'labels.json' ? labelBytes.slice() : new Uint8Array(4));
const fetcher = (async (input: RequestInfo | URL) => new Response(body(String(input).split('/').pop()!))) as typeof fetch;
const memory = (): AssetCache => {
  const store = new Map<string, Uint8Array>();
  return {
    match: async (key) => (store.has(key) ? new Response(store.get(key)!.slice()) : undefined),
    put: async (key, response) => void store.set(key, new Uint8Array(await response.arrayBuffer())),
    keys: async () => [...store.keys()],
    delete: async (key) => store.delete(key),
  };
};

/** A worker that answers like the real one, under the test's control. */
class FakeWorker {
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  terminated = false;
  received: ToWorker[] = [];
  held: ToWorker[] = [];
  hold = false;
  failInit = false;
  crashOnRun = false;
  postMessage(message: ToWorker) {
    this.received.push(message);
    if (message.type === 'init') return void queueMicrotask(() => this.reply(this.failInit ? { type: 'failed', message: 'wasm' } : { type: 'ready' }));
    if (this.hold) return void this.held.push(message);
    if (this.crashOnRun) return void queueMicrotask(() => this.onerror?.({ preventDefault() {} } as ErrorEvent));
    this.answer(message);
  }
  answer(message: ToWorker) {
    if (message.type === 'run') queueMicrotask(() => this.reply({ type: 'result', id: message.id, embedding: new Float32Array([message.pixels[0], 0]) }));
  }
  reply(message: FromWorker) {
    this.onmessage?.({ data: message } as MessageEvent<FromWorker>);
  }
  terminate() {
    this.terminated = true;
  }
}

const make = (worker = new FakeWorker(), extra: Parameters<typeof createVisionClient>[0] = {}) => ({
  worker,
  client: createVisionClient({ assets, cache: memory(), fetcher, spawn: () => worker as unknown as Worker, ...extra }),
});

describe('createVisionClient', () => {
  it('loads the files, starts the worker with them and answers with the labels', async () => {
    const { client, worker } = make();
    const progress: number[] = [];
    expect(client.ready).toBe(false);
    const outcome = await client.load((fraction) => progress.push(fraction));
    expect(outcome).toMatchObject({ ok: true });
    expect(client.ready).toBe(true);
    expect(worker.received[0]).toMatchObject({ type: 'init' });
    expect(progress.at(-1)).toBe(1);
    expect(await client.load()).toMatchObject({ ok: true });
    expect(worker.received.filter((message) => message.type === 'init')).toHaveLength(1);
  });

  it('shares one load between callers', async () => {
    const { client, worker } = make();
    const [a, b] = await Promise.all([client.load(), client.load()]);
    expect(a).toMatchObject({ ok: true });
    expect(b).toMatchObject({ ok: true });
    expect(worker.received.filter((message) => message.type === 'init')).toHaveLength(1);
  });

  it('is unavailable, not an exception, when the worker cannot start or the files cannot be fetched', async () => {
    const failing = new FakeWorker();
    failing.failInit = true;
    const broken = make(failing);
    expect(await broken.client.load()).toEqual({ ok: false, problem: 'unavailable' });
    expect(failing.terminated).toBe(true);
    expect(broken.client.ready).toBe(false);

    const noWorker = createVisionClient({
      assets,
      cache: memory(),
      fetcher,
      spawn: () => {
        throw new Error('no Worker');
      },
    });
    expect(await noWorker.load()).toEqual({ ok: false, problem: 'unavailable' });

    const offline = createVisionClient({
      assets,
      cache: memory(),
      fetcher: (async () => {
        throw new TypeError('Failed to fetch');
      }) as typeof fetch,
      spawn: () => new FakeWorker() as unknown as Worker,
    });
    expect(await offline.load()).toEqual({ ok: false, problem: 'offline' });
  });

  it('can load again after a failure', async () => {
    let attempt = 0;
    const flaky = createVisionClient({
      assets,
      cache: memory(),
      fetcher: (async (input: RequestInfo | URL) => {
        if (attempt++ === 0) throw new TypeError('Failed to fetch');
        return new Response(body(String(input).split('/').pop()!));
      }) as typeof fetch,
      spawn: () => new FakeWorker() as unknown as Worker,
    });
    expect(await flaky.load()).toEqual({ ok: false, problem: 'offline' });
    expect(await flaky.load()).toMatchObject({ ok: true });
  });

  it('answers the embedding of an image, and refuses before it is loaded', async () => {
    const { client } = make();
    expect(await client.embed(new Float32Array(12), 2)).toEqual({ ok: false, problem: 'unavailable' });
    await client.load();
    const pixels = new Float32Array(12);
    pixels[0] = 0.5;
    expect(await client.embed(pixels, 2)).toEqual({ ok: true, embedding: new Float32Array([0.5, 0]) });
  });

  it('runs one image at a time, in call order', async () => {
    const { client, worker } = make();
    await client.load();
    worker.hold = true;
    const first = new Float32Array(12);
    first[0] = 1;
    const second = new Float32Array(12);
    second[0] = 2;
    const a = client.embed(first, 2);
    const b = client.embed(second, 2);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(worker.held).toHaveLength(1);
    const release = worker.held.shift()!;
    worker.hold = false;
    worker.answer(release);
    expect(await a).toEqual({ ok: true, embedding: new Float32Array([1, 0]) });
    expect(await b).toEqual({ ok: true, embedding: new Float32Array([2, 0]) });
    expect(worker.received.filter((message) => message.type === 'run')).toHaveLength(2);
  });

  it('cancels a call that has not started, and ignores the result of one that was aborted', async () => {
    const { client, worker } = make();
    await client.load();
    worker.hold = true;
    const controller = new AbortController();
    const a = client.embed(new Float32Array(12), 2);
    const b = client.embed(new Float32Array(12), 2, controller.signal);
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 5));
    worker.hold = false;
    worker.answer(worker.held.shift()!);
    expect((await a).ok).toBe(true);
    expect(await b).toEqual({ ok: false, problem: 'cancelled' });
    expect(worker.received.filter((message) => message.type === 'run')).toHaveLength(1);
  });

  it('becomes unavailable when the worker crashes (no memory), and can be started again', async () => {
    const { client, worker } = make();
    await client.load();
    worker.crashOnRun = true;
    expect(await client.embed(new Float32Array(12), 2)).toEqual({ ok: false, problem: 'unavailable' });
    expect(worker.terminated).toBe(true);
    expect(client.ready).toBe(false);
    expect(await client.embed(new Float32Array(12), 2)).toEqual({ ok: false, problem: 'unavailable' });
  });

  it('gives up on a worker that never answers', async () => {
    const worker = new FakeWorker();
    const { client } = make(worker, { timeoutMs: 20 });
    await client.load();
    worker.hold = true;
    expect(await client.embed(new Float32Array(12), 2)).toEqual({ ok: false, problem: 'unavailable' });
    expect(worker.terminated).toBe(true);
  });

  it('dispose stops the worker and ends a call in progress', async () => {
    const { client, worker } = make();
    await client.load();
    worker.hold = true;
    const pending = client.embed(new Float32Array(12), 2);
    await new Promise((resolve) => setTimeout(resolve, 5));
    client.dispose();
    expect(await pending).toEqual({ ok: false, problem: 'unavailable' });
    expect(worker.terminated).toBe(true);
    expect(client.ready).toBe(false);
  });
});

describe('createVisionClient idle stop (33-5)', () => {
  afterEach(() => vi.useRealTimers());

  const sleepy = (idleMs = 60_000) => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const client = createVisionClient({
      assets,
      cache: memory(),
      fetcher,
      idleMs,
      timeoutMs: 600_000,
      spawn: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker as unknown as Worker;
      },
    });
    return { client, workers };
  };
  const px = () => new Float32Array(12);

  it('stops the worker once, only after the idle time, and stays usable', async () => {
    const { client, workers } = sleepy();
    await client.load();
    await vi.advanceTimersByTimeAsync(59_000);
    expect(workers[0].terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(workers[0].terminated).toBe(true);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(workers).toHaveLength(1);
    expect(client.ready).toBe(true);
  });

  it('restarts every request from the last one', async () => {
    const { client, workers } = sleepy();
    await client.load();
    await vi.advanceTimersByTimeAsync(40_000);
    await client.embed(px(), 2);
    await vi.advanceTimersByTimeAsync(40_000);
    expect(workers[0].terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(21_000);
    expect(workers[0].terminated).toBe(true);
  });

  it('starts a new worker for the next request and answers it', async () => {
    const { client, workers } = sleepy();
    await client.load();
    await vi.advanceTimersByTimeAsync(61_000);
    const pixels = px();
    pixels[0] = 0.25;
    expect(await client.embed(pixels, 2)).toEqual({ ok: true, embedding: new Float32Array([0.25, 0]) });
    expect(workers).toHaveLength(2);
    expect(workers[1].received[0]).toMatchObject({ type: 'init' });
    await vi.advanceTimersByTimeAsync(61_000);
    expect(workers[1].terminated).toBe(true);
    expect((await client.embed(px(), 2)).ok).toBe(true);
    expect(workers).toHaveLength(3);
  });

  it('never stops the worker while a request is pending, and counts from its end', async () => {
    const { client, workers } = sleepy();
    await client.load();
    workers[0].hold = true;
    const pending = client.embed(px(), 2);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(workers[0].terminated).toBe(false);
    workers[0].hold = false;
    workers[0].answer(workers[0].held.shift()!);
    expect((await pending).ok).toBe(true);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(workers[0].terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(workers[0].terminated).toBe(true);
  });

  it('answers requests that arrive together while the worker sleeps with one restart', async () => {
    const { client, workers } = sleepy();
    await client.load();
    await vi.advanceTimersByTimeAsync(61_000);
    const results = await Promise.all([client.embed(px(), 2), client.embed(px(), 2), client.embed(px(), 2)]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(workers).toHaveLength(2);
  });

  it('does not start again after dispose (turned off), also while a restart is under way', async () => {
    const { client, workers } = sleepy();
    await client.load();
    await vi.advanceTimersByTimeAsync(61_000);
    const restarting = client.embed(px(), 2);
    client.dispose();
    expect(await restarting).toEqual({ ok: false, problem: 'unavailable' });
    expect(await client.embed(px(), 2)).toEqual({ ok: false, problem: 'unavailable' });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(workers.length).toBeLessThanOrEqual(2);
    expect(workers.slice(1).every((worker) => worker.terminated)).toBe(true);
    expect(client.ready).toBe(false);
  });

  it('is unavailable when the restart fails, and the next load starts fresh', async () => {
    const { client } = sleepy();
    await client.load();
    await vi.advanceTimersByTimeAsync(61_000);
    client.dispose();
    expect(await client.embed(px(), 2)).toEqual({ ok: false, problem: 'unavailable' });
    expect(await client.load()).toMatchObject({ ok: true });
  });
});
