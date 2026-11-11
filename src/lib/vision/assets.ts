import { parseLabels, type VisionLabels } from './labels';

/** Cache Storage of the model files; deleting it is "remove the model" (the HTTP cache never keeps them: `no-store`). */
export const CACHE_NAME = 'vision-model';

/** Where the files are and how big (`virtual:vision-assets`, see `scripts/vision-assets.ts`). */
export interface VisionAssetFiles {
  base: string;
  files: { 'model.onnx': number; 'labels.json': number; 'ort-wasm-simd-threaded.wasm': number };
}

/** `offline`: the files are not on the device and could not be fetched (no connection); `failed`: anything else (a bad answer, a wrong size, a bad file). */
export class VisionLoadError extends Error {
  constructor(public problem: 'offline' | 'failed') {
    super(problem);
  }
}

export interface AssetCache {
  match(url: string): Promise<Response | undefined>;
  put(url: string, response: Response): Promise<void>;
  /** The cached URLs. */
  keys(): Promise<string[]>;
  delete(url: string): Promise<boolean>;
}

export interface LoadedAssets {
  model: ArrayBuffer;
  wasm: ArrayBuffer;
  labels: VisionLabels;
}

const names = ['model.onnx', 'ort-wasm-simd-threaded.wasm', 'labels.json'] as const;

/** Total bytes of the files the app downloads (what "About NN MB" says). */
export const totalBytes = (assets: Pick<VisionAssetFiles, 'files'>) => names.reduce((sum, name) => sum + assets.files[name], 0);

/** The size notice's whole megabytes, rounded up (never "0 MB"). */
export const megabytes = (bytes: number) => Math.max(1, Math.ceil(bytes / 1_000_000));

const urlOf = (assets: VisionAssetFiles, name: string) => new URL(assets.base + name, globalThis.location?.href ?? 'http://localhost/').href;

/** Cache Storage as an `AssetCache`, or null where the browser has none (a private mode that refuses it). */
export function browserCache(): AssetCache | null {
  if (typeof caches === 'undefined') return null;
  const open = () => caches.open(CACHE_NAME);
  // Reading never creates the cache: a device that never downloaded the model has no trace of it.
  const exists = () => caches.has(CACHE_NAME);
  return {
    match: async (url) => ((await exists()) ? (await open()).match(url) : undefined),
    put: async (url, response) => (await open()).put(url, response),
    keys: async () => ((await exists()) ? (await (await open()).keys()).map((request) => request.url) : []),
    delete: async (url) => ((await exists()) ? (await open()).delete(url) : false),
  };
}

/** True when every file is on the device with its expected size, so the feature works offline. */
export async function isCached(assets: VisionAssetFiles, cache: AssetCache | null = browserCache()): Promise<boolean> {
  if (!cache) return false;
  try {
    for (const name of names) {
      const hit = await cache.match(urlOf(assets, name));
      // The Blob's size, never a copy of the bytes: browsers can answer it without reading about 60 MB into memory.
      if (!hit || (await hit.blob()).size !== assets.files[name]) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function readAll(response: Response, expected: number, report: (bytes: number) => void, signal?: AbortSignal): Promise<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = response.body?.getReader();
  if (!reader) {
    const whole = await response.arrayBuffer();
    if (expected && whole.byteLength !== expected) throw new VisionLoadError('failed');
    report(whole.byteLength);
    return whole;
  }
  for (;;) {
    signal?.throwIfAborted();
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    report(value.length);
  }
  const whole = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    whole.set(chunk, offset);
    offset += chunk.length;
  }
  if (expected && received !== expected) throw new VisionLoadError('failed');
  return whole.buffer;
}

/**
 * The model files, from this device's cache when they are all there, else downloaded (reporting 0..1 progress by bytes) and
 * kept for offline use; files of older versions are dropped. Throws `VisionLoadError` (never half-cached: a file is stored
 * only after its size matched). Aborting throws the signal's reason.
 */
export async function loadAssets(
  assets: VisionAssetFiles,
  options: { cache?: AssetCache | null; fetcher?: typeof fetch; onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<LoadedAssets> {
  const { cache = browserCache(), fetcher = (input, init) => fetch(input, init), onProgress = () => {}, signal } = options;
  const total = totalBytes(assets);
  let done = 0;
  const report = (bytes: number) => {
    done += bytes;
    onProgress(Math.min(1, done / total));
  };
  const buffers = new Map<string, ArrayBuffer>();
  for (const name of names) {
    signal?.throwIfAborted();
    const url = urlOf(assets, name);
    const expected = assets.files[name];
    let cached: Response | undefined;
    try {
      cached = await cache?.match(url);
    } catch {
      cached = undefined;
    }
    if (cached) {
      const whole = await cached.arrayBuffer();
      if (whole.byteLength === expected) {
        buffers.set(name, whole);
        report(expected);
        continue;
      }
    }
    let response: Response;
    try {
      response = await fetcher(url, { cache: 'no-store', signal });
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      throw new VisionLoadError(error instanceof TypeError ? 'offline' : 'failed');
    }
    if (!response.ok) throw new VisionLoadError('failed');
    const whole = await readAll(response, expected, report, signal);
    buffers.set(name, whole);
    signal?.throwIfAborted();
    try {
      await cache?.put(url, new Response(whole.slice(0)));
    } catch {
      // Storage full or refused: it works this time, and asks again next time.
    }
  }
  let labels: VisionLabels;
  try {
    labels = parseLabels(JSON.parse(new TextDecoder().decode(buffers.get('labels.json'))));
  } catch {
    // A bad file must not stay cached.
    await cache?.delete(urlOf(assets, 'labels.json')).catch(() => false);
    throw new VisionLoadError('failed');
  }
  if (cache) {
    const current = new Set(names.map((name) => urlOf(assets, name)));
    try {
      for (const url of await cache.keys()) if (!current.has(url) && /\/assets\/vision-[0-9a-f]{16}\//.test(url)) await cache.delete(url);
    } catch {
      // Old files linger until the next load or "Turn off".
    }
  }
  return { model: buffers.get('model.onnx')!, wasm: buffers.get('ort-wasm-simd-threaded.wasm')!, labels };
}

/** Deletes every cached file (and the cache itself): "Turn off and remove the model". */
export async function removeAssets(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    await caches.delete(CACHE_NAME);
  } catch {
    // Nothing more can be done; the files stay until the browser's site data is cleared.
  }
}
