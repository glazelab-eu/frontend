import { get, writable, type Readable } from 'svelte/store';
import assetFiles from 'virtual:vision-assets';
import { isCached, removeAssets, totalBytes, type VisionAssetFiles } from '../../lib/vision/assets';
import { createVisionClient, type VisionClient } from '../../lib/vision/client';
import { photoTensor, type InputSpec } from '../../lib/vision/image';
import type { VisionLabels } from '../../lib/vision/labels';
import { isMetered, isSlow, readPreference, writePreference, type Preference } from '../../lib/vision/preference';
import { pickSuggestions, scoreLabels, normalize, type Scored } from '../../lib/vision/scoring';

/**
 * `off`: nothing downloaded or running and not wanted (never asked, "Not now", or turned off); `idle`: switched on, not started in this
 * session; `confirm`: switched on but the model is not on
 * the device and the connection looks metered, so it asks before downloading; `loading`/`checking`: downloading and starting /
 * the one timed speed check; `ready`; `slow`: ready, but the speed check was slow; `offline`: switched on, not on the device
 * yet and no connection (it needs one online use); `failed`: it cannot run here.
 */
export type SuggestionStatus = 'off' | 'idle' | 'confirm' | 'loading' | 'checking' | 'ready' | 'slow' | 'offline' | 'failed';

export interface PhotoSuggestionsState {
  preference: Preference;
  status: SuggestionStatus;
  /** Download progress 0..1 while `loading`. */
  progress: number;
  /** The speed check's time in milliseconds once it ran. */
  checkMs: number | null;
  /** Megabytes the download is, for the notices. */
  bytes: number;
}

/** The embedding of one photo (a unit vector, 33-2), or why there is none. */
export type EmbeddingOutcome = { ok: true; embedding: Float32Array } | { ok: false; problem: 'cancelled' | 'unavailable' };

export type AnalysisOutcome = { ok: true; picked: Scored[]; labels: VisionLabels } | { ok: false; problem: 'cancelled' | 'unavailable' };

interface Options {
  client?: VisionClient;
  assets?: VisionAssetFiles;
  /** Whether the files are all on the device (default: Cache Storage). */
  cached?: () => Promise<boolean>;
  removeFiles?: () => Promise<void>;
  online?: () => boolean;
  metered?: () => boolean;
  now?: () => number;
  /** Prepares a photo for the model (default: the canvas pipeline). */
  prepare?: typeof photoTensor;
  storage?: Storage;
}

export interface PhotoSuggestions {
  state: Readable<PhotoSuggestionsState>;
  /** The writer agreed (the consent text, or the setting): remembers it and starts the download. */
  enable(): Promise<void>;
  /** "Not now": remembers it, so nothing asks again until the setting is opened. */
  decline(): void;
  /** Starts the model when the writer has agreed and it is not running (after a reload, a failure or a lost connection). */
  resume(): Promise<void>;
  /** The writer agreed to the download on a metered connection. */
  confirmDownload(): Promise<void>;
  /** Turns it off: stops the worker, deletes the model, the label data and the preference's `on`. */
  disable(): Promise<void>;
  /** Keeps a slow model switched on (the notice goes away). */
  keepSlow(): void;
  /** What a photo shows: the labels that pass the thresholds. Never throws. */
  analyse(file: Blob, signal?: AbortSignal): Promise<AnalysisOutcome>;
  /** The embedding of a photo for the similar looks (33-2), by the same worker, one image at a time. Never throws; needs the model to be ready. */
  embed(file: Blob, signal?: AbortSignal): Promise<EmbeddingOutcome>;
  /** The loaded model's ID and vector length, once it runs (the stored vectors belong to one model). */
  modelInfo(): { id: string; dimension: number } | null;
}

export function createPhotoSuggestions(options: Options = {}): PhotoSuggestions {
  const assets = options.assets ?? assetFiles;
  const client = options.client ?? createVisionClient({ assets });
  const cached = options.cached ?? (() => isCached(assets));
  const removeFiles = options.removeFiles ?? removeAssets;
  const online = options.online ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const metered = options.metered ?? (() => isMetered((navigator as Navigator & { connection?: { saveData?: boolean; type?: string } }).connection));
  const now = options.now ?? (() => performance.now());
  const prepare = options.prepare ?? photoTensor;
  const preference = readPreference(options.storage);
  const store = writable<PhotoSuggestionsState>({
    preference,
    status: preference === 'on' ? 'idle' : 'off',
    progress: 0,
    checkMs: null,
    bytes: totalBytes(assets),
  });
  const patch = (changes: Partial<PhotoSuggestionsState>) => store.update((value) => ({ ...value, ...changes }));
  let labels: VisionLabels | null = null;
  let starting: Promise<void> | null = null;
  /** Bumped by `disable`, so a start that finishes after it is dropped. */
  let generation = 0;
  /** Aborted by `disable`, so a download or start that is still running neither caches the files again nor leaves a worker behind. */
  let loadAbort = new AbortController();

  async function speedCheck(loaded: VisionLabels, mine: number) {
    patch({ status: 'checking' });
    const size = loaded.model.input;
    const began = now();
    const outcome = await client.embed(new Float32Array(3 * size * size), size);
    if (mine !== generation) return;
    if (!outcome.ok) {
      client.dispose();
      return patch({ status: 'failed' });
    }
    const checkMs = Math.round(now() - began);
    patch({ checkMs, status: isSlow(checkMs) ? 'slow' : 'ready' });
  }

  async function run(confirmed: boolean) {
    const mine = generation;
    if (!(await cached())) {
      if (!online()) return patch({ status: 'offline' });
      if (!confirmed && metered()) return patch({ status: 'confirm' });
    }
    patch({ status: 'loading', progress: 0 });
    const outcome = await client.load((progress) => mine === generation && patch({ progress }), loadAbort.signal);
    if (mine !== generation) return;
    if (!outcome.ok) {
      client.dispose();
      return patch({ status: outcome.problem === 'offline' ? 'offline' : 'failed' });
    }
    labels = outcome.labels;
    await speedCheck(outcome.labels, mine);
  }

  function start(confirmed: boolean) {
    if (starting) return starting;
    const status = get(store).status;
    if (status === 'ready' || status === 'slow') return Promise.resolve();
    const current: Promise<void> = run(confirmed).finally(() => {
      if (starting === current) starting = null;
    });
    starting = current;
    return current;
  }

  const ready = () => {
    const status = get(store).status;
    return status === 'ready' || status === 'slow';
  };

  /** The decode queue: one full-size photo in memory at a time, like the worker runs one inference at a time. */
  let decoding: Promise<unknown> = Promise.resolve();
  function decode(file: Blob, model: InputSpec, signal?: AbortSignal): Promise<Float32Array> {
    const next = decoding.then(() => {
      signal?.throwIfAborted();
      return prepare(file, model, signal);
    });
    decoding = next.catch(() => undefined);
    return next;
  }

  /** The unit embedding of a photo: prepared on the canvas, run in the worker. A photo that cannot be decoded is `unavailable`, nothing broken. */
  async function embedPhoto(file: Blob, signal?: AbortSignal): Promise<EmbeddingOutcome> {
    const loaded = labels;
    if (!loaded || !ready()) return { ok: false, problem: 'unavailable' };
    const mine = generation;
    try {
      const pixels = await decode(file, loaded.model, signal);
      const outcome = await client.embed(pixels, loaded.model.input, signal);
      if (!outcome.ok) {
        if (outcome.problem === 'unavailable' && mine === generation) {
          client.dispose();
          patch({ status: 'failed' });
        }
        return outcome;
      }
      return { ok: true, embedding: normalize(outcome.embedding) };
    } catch {
      // The photo could not be decoded (or the browser could not draw it): no embedding, nothing broken.
      return { ok: false, problem: signal?.aborted ? 'cancelled' : 'unavailable' };
    }
  }

  return {
    state: { subscribe: store.subscribe },
    async enable() {
      writePreference('on', options.storage);
      patch({ preference: 'on' });
      await start(false);
    },
    decline() {
      writePreference('off', options.storage);
      patch({ preference: 'off' });
    },
    async resume() {
      if (get(store).preference !== 'on') return;
      await start(false);
    },
    async confirmDownload() {
      if (get(store).preference === 'on') await start(true);
    },
    async disable() {
      generation++;
      loadAbort.abort();
      loadAbort = new AbortController();
      client.dispose();
      labels = null;
      starting = null;
      await removeFiles();
      writePreference('off', options.storage);
      store.set({ preference: 'off', status: 'off', progress: 0, checkMs: null, bytes: totalBytes(assets) });
    },
    keepSlow() {
      if (get(store).status === 'slow') patch({ status: 'ready' });
    },
    async analyse(file, signal) {
      const loaded = labels;
      const outcome = await embedPhoto(file, signal);
      if (!outcome.ok || !loaded) return outcome.ok ? { ok: false, problem: 'unavailable' } : outcome;
      const scored = scoreLabels(outcome.embedding, loaded.labels, loaded.model.scale);
      const eligible = new Set(loaded.labels.filter((label) => label.tags).map((label) => label.id));
      return { ok: true, picked: pickSuggestions(scored, loaded.thresholds, (id) => eligible.has(id)), labels: loaded };
    },
    embed: (file, signal) => embedPhoto(file, signal),
    modelInfo: () => (labels && ready() ? { id: labels.model.id, dimension: labels.model.dimension } : null),
  };
}
