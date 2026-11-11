import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import type { VisionAssetFiles } from '../../lib/vision/assets';
import type { EmbedOutcome, LoadOutcome, VisionClient } from '../../lib/vision/client';
import type { VisionLabels } from '../../lib/vision/labels';
import { PREFERENCE_KEY, SLOW_MS } from '../../lib/vision/preference';
import { createPhotoSuggestions, type PhotoSuggestions } from './photo-suggestions';

const labels: VisionLabels = {
  model: { id: 'm', source: 's', input: 2, mean: [0, 0, 0], std: [1, 1, 1], scale: 50, dimension: 2 },
  thresholds: { minProbability: 0.3, minCosine: 0.5, maxSuggestions: 2 },
  labels: [
    { id: 'mug', tags: { en: 'mug', de: 'becher', 'pt-PT': 'caneca', it: 'mug', es: 'mug' }, embedding: [1, 0] },
    { id: 'vase', tags: { en: 'vase', de: 'vase', 'pt-PT': 'vaso', it: 'vaso', es: 'jarrón' }, embedding: [0, 1] },
    { id: 'other-person', tags: null, embedding: [-1, 0] },
  ],
};
const assets: VisionAssetFiles = {
  base: '/assets/vision-0123456789abcdef/',
  files: { 'model.onnx': 9_000_000, 'ort-wasm-simd-threaded.wasm': 15_000_000, 'labels.json': 90_000 },
};

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => void (data[key] = value),
    removeItem: (key: string) => void delete data[key],
  } as unknown as Storage & {
    data: Record<string, string>;
  };
}

/** A client that records what it was asked and answers as told. */
function fakeClient(options: { load?: LoadOutcome; embedding?: () => EmbedOutcome; delay?: () => void } = {}) {
  const calls = { load: 0, embed: 0, dispose: 0 };
  const client: VisionClient = {
    get ready() {
      return calls.load > 0;
    },
    async load(onProgress) {
      calls.load++;
      onProgress?.(0.5);
      onProgress?.(1);
      return options.load ?? { ok: true, labels };
    },
    async embed() {
      calls.embed++;
      options.delay?.();
      return options.embedding?.() ?? { ok: true, embedding: new Float32Array([1, 0]) };
    },
    dispose() {
      calls.dispose++;
    },
  };
  return { client, calls };
}

function build(
  setup: {
    storage?: ReturnType<typeof memoryStorage>;
    client?: ReturnType<typeof fakeClient>;
    cached?: boolean;
    online?: boolean;
    metered?: boolean;
    clock?: () => number;
  } = {},
) {
  const storage = setup.storage ?? memoryStorage();
  const fake = setup.client ?? fakeClient();
  let removed = 0;
  const suggestions: PhotoSuggestions = createPhotoSuggestions({
    client: fake.client,
    assets,
    storage,
    cached: async () => setup.cached ?? false,
    removeFiles: async () => void removed++,
    online: () => setup.online ?? true,
    metered: () => setup.metered ?? false,
    now: setup.clock,
    prepare: async () => new Float32Array(12),
  });
  return { suggestions, storage, calls: fake.calls, removed: () => removed, state: () => get(suggestions.state) };
}

describe('consent gating: nothing is downloaded or run before an explicit yes', () => {
  it('starts off and never touches the model by itself, whatever else is called', async () => {
    const { suggestions, calls, state, storage } = build();
    expect(state()).toMatchObject({ preference: null, status: 'off' });
    suggestions.decline();
    await suggestions.resume();
    await suggestions.confirmDownload();
    suggestions.keepSlow();
    expect(await suggestions.analyse(new Blob(['x']))).toEqual({ ok: false, problem: 'unavailable' });
    expect(calls).toEqual({ load: 0, embed: 0, dispose: 0 });
    expect(storage.data).toEqual({ [PREFERENCE_KEY]: 'off' });
    expect(state()).toMatchObject({ preference: 'off', status: 'off' });
  });

  it('"Not now" leaves only the off choice: no load, no model, nothing to analyse with', async () => {
    const { suggestions, calls, state } = build();
    suggestions.decline();
    expect(state().status).toBe('off');
    expect(calls.load).toBe(0);
    await suggestions.resume();
    expect(calls.load).toBe(0);
  });

  it('a stored off never starts the model on a later visit', async () => {
    const { suggestions, calls, state } = build({ storage: memoryStorage({ [PREFERENCE_KEY]: 'off' }) });
    await suggestions.resume();
    expect(calls.load).toBe(0);
    expect(state()).toMatchObject({ preference: 'off', status: 'off' });
  });

  it('a stored yes waits (idle) until something asks for the model', async () => {
    const { suggestions, calls, state } = build({ storage: memoryStorage({ [PREFERENCE_KEY]: 'on' }), cached: true });
    expect(state()).toMatchObject({ preference: 'on', status: 'idle' });
    expect(calls.load).toBe(0);
    await suggestions.resume();
    expect(calls.load).toBe(1);
    expect(state().status).toBe('ready');
  });
});

describe('the embedding for the similar looks (33-2)', () => {
  it('gives no embedding and no model info before the model runs, whatever is asked', async () => {
    const { suggestions, calls } = build();
    expect(await suggestions.embed(new Blob(['x']))).toEqual({ ok: false, problem: 'unavailable' });
    expect(suggestions.modelInfo()).toBeNull();
    expect(calls.embed).toBe(0);
  });

  it('answers the photo as a unit vector once the model is ready, and says which model it is', async () => {
    const fake = fakeClient({ embedding: () => ({ ok: true, embedding: new Float32Array([3, 4]) }) });
    const { suggestions } = build({ client: fake });
    await suggestions.enable();
    expect(suggestions.modelInfo()).toEqual({ id: 'm', dimension: 2 });
    const outcome = await suggestions.embed(new Blob(['x']));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect([...outcome.embedding].map((value) => Math.round(value * 10) / 10)).toEqual([0.6, 0.8]);
  });

  it('loses the model info when the model is turned off and gives up for a worker that failed', async () => {
    const fake = fakeClient();
    const { suggestions, state } = build({ client: fake });
    await suggestions.enable();
    fake.client.embed = async () => ({ ok: false, problem: 'unavailable' });
    expect(await suggestions.embed(new Blob(['x']))).toEqual({ ok: false, problem: 'unavailable' });
    expect(state().status).toBe('failed');
    expect(suggestions.modelInfo()).toBeNull();
  });
});

describe('turning on', () => {
  it('remembers the yes, loads, runs the one timed check and is ready when it is quick', async () => {
    let time = 0;
    const { suggestions, calls, state, storage } = build({ clock: () => (time += 400) });
    await suggestions.enable();
    expect(storage.data[PREFERENCE_KEY]).toBe('on');
    expect(calls).toMatchObject({ load: 1, embed: 1 });
    expect(state()).toMatchObject({ preference: 'on', status: 'ready', checkMs: 400 });
  });

  it('says slow when the check takes longer than the limit, and keeping it on clears the notice', async () => {
    let time = 0;
    const { suggestions, state } = build({ clock: () => (time += SLOW_MS + 1) });
    await suggestions.enable();
    expect(state().status).toBe('slow');
    expect(state().checkMs).toBe(SLOW_MS + 1);
    suggestions.keepSlow();
    expect(state().status).toBe('ready');
  });

  it('a check exactly at the limit is not slow', async () => {
    let time = 0;
    const { suggestions, state } = build({ clock: () => (time += SLOW_MS) });
    await suggestions.enable();
    expect(state().status).toBe('ready');
  });

  it('reports download progress while loading', async () => {
    const seen: number[] = [];
    const { suggestions } = build();
    suggestions.state.subscribe((value) => seen.push(value.progress));
    await suggestions.enable();
    expect(seen).toContain(0.5);
    expect(seen).toContain(1);
  });

  it('does not load twice when asked twice', async () => {
    const { suggestions, calls } = build();
    await Promise.all([suggestions.enable(), suggestions.resume()]);
    await suggestions.resume();
    expect(calls.load).toBe(1);
  });

  it('needs one online use: offline and not on the device says so, without trying', async () => {
    const { suggestions, calls, state } = build({ online: false, cached: false });
    await suggestions.enable();
    expect(state().status).toBe('offline');
    expect(calls.load).toBe(0);
  });

  it('works offline once the files are on the device', async () => {
    const { suggestions, calls, state } = build({ online: false, cached: true });
    await suggestions.enable();
    expect(calls.load).toBe(1);
    expect(state().status).toBe('ready');
  });

  it('asks again before downloading on a metered connection, and downloads after the yes', async () => {
    const { suggestions, calls, state } = build({ metered: true, cached: false });
    await suggestions.enable();
    expect(state().status).toBe('confirm');
    expect(calls.load).toBe(0);
    await suggestions.confirmDownload();
    expect(calls.load).toBe(1);
    expect(state().status).toBe('ready');
  });

  it('does not ask on a metered connection when the files are already on the device', async () => {
    const { suggestions, calls } = build({ metered: true, cached: true });
    await suggestions.enable();
    expect(calls.load).toBe(1);
  });

  it('falls back to failed or offline without throwing when the model cannot load', async () => {
    const failed = build({ client: fakeClient({ load: { ok: false, problem: 'unavailable' } }) });
    await failed.suggestions.enable();
    expect(failed.state().status).toBe('failed');
    expect(failed.calls.dispose).toBe(1);
    const offline = build({ client: fakeClient({ load: { ok: false, problem: 'offline' } }) });
    await offline.suggestions.enable();
    expect(offline.state().status).toBe('offline');
    expect(await offline.suggestions.analyse(new Blob(['x']))).toEqual({ ok: false, problem: 'unavailable' });
  });

  it('is failed when the speed check itself cannot run, and then analyses nothing', async () => {
    const { suggestions, state, calls } = build({ client: fakeClient({ embedding: () => ({ ok: false, problem: 'unavailable' }) }) });
    await suggestions.enable();
    expect(state().status).toBe('failed');
    expect(await suggestions.analyse(new Blob(['x']))).toEqual({ ok: false, problem: 'unavailable' });
    expect(calls.embed).toBe(1);
  });
});

describe('turning off', () => {
  it('stops the worker, deletes the files and leaves the choice at off', async () => {
    const { suggestions, calls, state, storage, removed } = build();
    await suggestions.enable();
    await suggestions.disable();
    expect(calls.dispose).toBe(1);
    expect(removed()).toBe(1);
    expect(storage.data[PREFERENCE_KEY]).toBe('off');
    expect(state()).toMatchObject({ preference: 'off', status: 'off', checkMs: null });
    expect(await suggestions.analyse(new Blob(['x']))).toEqual({ ok: false, problem: 'unavailable' });
  });

  it('passes the load an abort signal that turning off fires', async () => {
    let signal: AbortSignal | undefined;
    const fake = fakeClient();
    const watching: VisionClient = { ...fake.client, load: async (_progress, given) => ((signal = given), { ok: true, labels }) };
    const { suggestions } = build({ client: { client: watching, calls: fake.calls } });
    await suggestions.enable();
    expect(signal?.aborted).toBe(false);
    await suggestions.disable();
    expect(signal?.aborted).toBe(true);
  });

  it('does not mark a turned-off model failed when a running photo is lost', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fake = fakeClient();
    let armed = false;
    const lost: VisionClient = {
      ...fake.client,
      embed: async (pixels, size, signal) => (armed ? (await gate, { ok: false, problem: 'unavailable' }) : fake.client.embed(pixels, size, signal)),
    };
    const { suggestions, state } = build({ client: { client: lost, calls: fake.calls } });
    await suggestions.enable();
    armed = true;
    const running = suggestions.embed(new Blob(['x']));
    await suggestions.disable();
    release();
    await running;
    expect(state().status).toBe('off');
  });

  it('drops a load that finishes after it was turned off', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fake = fakeClient();
    const slow: VisionClient = { ...fake.client, load: async () => (await gate, { ok: true, labels }) };
    const { suggestions, state } = build({ client: { client: slow, calls: fake.calls } });
    const starting = suggestions.enable();
    await suggestions.disable();
    release();
    await starting;
    expect(state().status).toBe('off');
  });
});

describe('analyse', () => {
  it('suggests the labels that pass both thresholds, never one without tags', async () => {
    const { suggestions } = build();
    await suggestions.enable();
    // The fake model embeds every photo as [1, 0]: cosine 1 with the mug, 0 with the vase, -1 with the other label.
    const outcome = await suggestions.analyse(new Blob(['x']));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.picked.map((item) => item.id)).toEqual(['mug']);
      expect(outcome.labels.labels).toHaveLength(3);
    }
  });

  it('suggests nothing when the score is low: a photo that is closest to a label that is never suggested', async () => {
    const { suggestions } = build({ client: fakeClient({ embedding: () => ({ ok: true, embedding: new Float32Array([-1, -0.2]) }) }) });
    await suggestions.enable();
    const outcome = await suggestions.analyse(new Blob(['x']));
    expect(outcome).toMatchObject({ ok: true, picked: [] });
  });

  it('suggests nothing when the cosine is under the floor even if the probability is high', async () => {
    const { suggestions } = build({ client: fakeClient({ embedding: () => ({ ok: true, embedding: new Float32Array([0.4, 1]) }) }) });
    await suggestions.enable();
    // vase: cosine 0.93 passes; mug: cosine 0.37 is under 0.5.
    const outcome = await suggestions.analyse(new Blob(['x']));
    expect(outcome.ok && outcome.picked.map((item) => item.id)).toEqual(['vase']);
  });

  it('is unavailable (never an exception) when the photo cannot be prepared, and the feature stays ready', async () => {
    const storage = memoryStorage();
    const fake = fakeClient();
    const suggestions = createPhotoSuggestions({
      client: fake.client,
      assets,
      storage,
      cached: async () => false,
      removeFiles: async () => {},
      online: () => true,
      metered: () => false,
      prepare: async () => {
        throw new Error('cannot decode');
      },
    });
    await suggestions.enable();
    expect(await suggestions.analyse(new Blob(['x']))).toEqual({ ok: false, problem: 'unavailable' });
    expect(get(suggestions.state).status).toBe('ready');
  });

  it('decodes one photo at a time, however many are asked for at once, and a failed one does not stop the next', async () => {
    let decoding = 0;
    let most = 0;
    let calls = 0;
    const suggestions = createPhotoSuggestions({
      client: fakeClient().client,
      assets,
      storage: memoryStorage(),
      cached: async () => false,
      removeFiles: async () => {},
      online: () => true,
      metered: () => false,
      prepare: async () => {
        decoding++;
        most = Math.max(most, decoding);
        await new Promise((resolve) => setTimeout(resolve, 5));
        decoding--;
        if (calls++ === 0) throw new Error('cannot decode');
        return new Float32Array(12);
      },
    });
    await suggestions.enable();
    const outcomes = await Promise.all([1, 2, 3].map(() => suggestions.analyse(new Blob(['x']))));
    expect(most).toBe(1);
    expect(outcomes.map((outcome) => outcome.ok)).toEqual([false, true, true]);
  });

  it('turns to failed when the model stops working during a run', async () => {
    let runs = 0;
    const { suggestions, state } = build({
      client: fakeClient({ embedding: () => (runs++ === 0 ? { ok: true, embedding: new Float32Array([1, 0]) } : { ok: false, problem: 'unavailable' }) }),
    });
    await suggestions.enable();
    expect(await suggestions.analyse(new Blob(['x']))).toEqual({ ok: false, problem: 'unavailable' });
    expect(state().status).toBe('failed');
  });
});
