import assetFiles from 'virtual:vision-assets';
import { loadAssets, VisionLoadError, type AssetCache, type VisionAssetFiles } from './assets';
import type { VisionLabels } from './labels';
import type { FromWorker, ToWorker } from './worker-protocol';

/** `offline`: the model is not on this device yet and there is no connection; `unavailable`: it cannot run here (no WebAssembly, no memory, a bad file). */
export type VisionProblem = 'offline' | 'unavailable';
export type LoadOutcome = { ok: true; labels: VisionLabels } | { ok: false; problem: VisionProblem };
export type EmbedOutcome = { ok: true; embedding: Float32Array } | { ok: false; problem: 'cancelled' | 'unavailable' };

export interface VisionClient {
  /** True once `load` succeeded and the model can be used: the worker is alive or only asleep (idle stop, 33-5), which `embed` wakes. */
  readonly ready: boolean;
  /** Fetches (or takes from the device cache) and starts the model; a second call while one runs shares it. Never throws. */
  load(onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<LoadOutcome>;
  /** The embedding of one prepared image, one at a time in call order. A failed or cancelled run never throws. */
  embed(pixels: Float32Array, size: number, signal?: AbortSignal): Promise<EmbedOutcome>;
  /** Stops the worker for good and ends pending calls (no restart on demand); `load` can be called again. */
  dispose(): void;
}

type WorkerLike = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'>;

interface Options {
  assets?: VisionAssetFiles;
  cache?: AssetCache | null;
  fetcher?: typeof fetch;
  spawn?: () => WorkerLike;
  /** How long the worker may take to start, and for one image (the speed check judges the second). */
  timeoutMs?: number;
  /** How long the idle worker lives after its last request (33-5); it is started again by the next `embed`. */
  idleMs?: number;
}

const defaultSpawn = (): WorkerLike => new Worker(new URL('./vision-worker.ts', import.meta.url), { type: 'module' });

/** The typed client of the vision worker (33-1): load progress, one run at a time, every failure an outcome. */
export function createVisionClient({
  assets = assetFiles,
  cache,
  fetcher,
  spawn = defaultSpawn,
  timeoutMs = 60_000,
  idleMs = 60_000,
}: Options = {}): VisionClient {
  let worker: WorkerLike | null = null;
  let labels: VisionLabels | null = null;
  let loading: Promise<LoadOutcome> | null = null;
  let serial = 0;
  let tail: Promise<unknown> = Promise.resolve();
  /** Ends the pending call with this outcome (set while a call waits for the worker). */
  let settle: ((message: FromWorker | 'lost') => void) | null = null;
  /** `embed` calls queued or running: the worker never sleeps while one is open. */
  let busy = 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped by `dispose`, so a restart that finishes after it is dropped. */
  let epoch = 0;

  const stopWorker = () => {
    clearTimeout(idleTimer);
    worker?.terminate();
    worker = null;
    labels = null;
    settle?.('lost');
  };

  /** (Re)starts the idle countdown; the worker, not the labels, goes away: `embed` starts it again from the device cache. */
  const armIdle = () => {
    clearTimeout(idleTimer);
    if (!worker || idleMs <= 0) return;
    idleTimer = setTimeout(() => {
      if (busy > 0 || loading || !worker) return;
      worker.terminate();
      worker = null;
    }, idleMs);
  };

  /** Posts one message and waits for the worker's answer (or its loss, or the deadline). */
  const exchange = (message: ToWorker, transfer: Transferable[], accept: (answer: FromWorker) => boolean): Promise<FromWorker | 'lost'> =>
    new Promise((resolve) => {
      const current = worker;
      if (!current) return resolve('lost');
      const timer = setTimeout(() => finish('lost', true), timeoutMs);
      const finish = (answer: FromWorker | 'lost', stop = false) => {
        clearTimeout(timer);
        if (settle === listener) settle = null;
        if (stop) stopWorker();
        resolve(answer);
      };
      const listener = (answer: FromWorker | 'lost') => {
        if (answer === 'lost' || accept(answer)) finish(answer);
      };
      settle = listener;
      current.onmessage = ({ data }: MessageEvent<FromWorker>) => listener(data);
      current.onerror = (event) => {
        event.preventDefault?.();
        finish('lost', true);
      };
      current.onmessageerror = () => finish('lost', true);
      try {
        current.postMessage(message, transfer);
      } catch {
        finish('lost', true);
      }
    });

  async function start(onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<LoadOutcome> {
    const mine = epoch;
    let loaded;
    try {
      loaded = await loadAssets(assets, { cache, fetcher, onProgress, signal });
    } catch (error) {
      if (error instanceof VisionLoadError) return { ok: false, problem: error.problem === 'offline' ? 'offline' : 'unavailable' };
      return { ok: false, problem: 'unavailable' };
    }
    if (signal?.aborted || mine !== epoch) return { ok: false, problem: 'unavailable' };
    try {
      worker = spawn();
    } catch {
      return { ok: false, problem: 'unavailable' };
    }
    const answer = await exchange(
      { type: 'init', wasm: loaded.wasm, model: loaded.model },
      [loaded.wasm, loaded.model],
      (message) => message.type !== 'result',
    );
    if (answer === 'lost' || answer.type !== 'ready') {
      stopWorker();
      return { ok: false, problem: 'unavailable' };
    }
    labels = loaded.labels;
    armIdle();
    return { ok: true, labels: loaded.labels };
  }

  return {
    get ready() {
      return labels !== null;
    },
    load(onProgress = () => {}, signal) {
      if (worker && labels) {
        armIdle();
        return Promise.resolve({ ok: true, labels });
      }
      loading ??= start(onProgress, signal).finally(() => {
        loading = null;
      });
      return loading;
    },
    embed(pixels, size, signal) {
      const run = async (): Promise<EmbedOutcome> => {
        if (signal?.aborted) return { ok: false, problem: 'cancelled' };
        if (!worker) {
          // Asleep after the idle stop: start again from the device cache (no progress UI); a disposed client stays stopped.
          if (!labels) return { ok: false, problem: 'unavailable' };
          loading ??= start(() => {}).finally(() => {
            loading = null;
          });
          if (!(await loading).ok) return { ok: false, problem: 'unavailable' };
          if (signal?.aborted) return { ok: false, problem: 'cancelled' };
        }
        const id = ++serial;
        const answer = await exchange({ type: 'run', id, pixels, size }, [pixels.buffer], (message) => message.type !== 'ready' && message.id === id);
        if (signal?.aborted) return { ok: false, problem: 'cancelled' };
        return answer !== 'lost' && answer.type === 'result' ? { ok: true, embedding: answer.embedding } : { ok: false, problem: 'unavailable' };
      };
      busy++;
      clearTimeout(idleTimer);
      const result = tail.then(run, run).finally(() => {
        busy--;
        if (busy === 0) armIdle();
      });
      tail = result.catch(() => undefined);
      return result;
    },
    dispose() {
      epoch++;
      stopWorker();
    },
  };
}
