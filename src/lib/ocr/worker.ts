import type { LabelText, LabelWord } from './label';

export class LabelReadError extends Error {
  constructor(public problem: 'failed' | 'timeout' | 'unsupported') {
    super(problem);
  }
}
type Packet = { jobId: string; status: string; data: unknown };
type WorkerLike = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'>;
type Block = { paragraphs: { lines: { words: LabelWord[] }[] }[] };

/**
 * Tesseract.js 7's pinned worker protocol. Own the Worker before initialization so cancellation,
 * language/core failures and deadlines terminate it even before createWorker could return a handle.
 * Keep this adapter and its protocol tests in step when upgrading Tesseract.
 */
export async function readLabelText(
  image: Uint8Array,
  base: string,
  signal: AbortSignal,
  spawn: (url: string) => WorkerLike = (url) => new Worker(url),
): Promise<LabelText> {
  signal.throwIfAborted();
  let worker: WorkerLike;
  try {
    worker = spawn(`${base}/worker.min.js`);
  } catch {
    throw new LabelReadError('unsupported');
  }
  let serial = 0;
  let stopped: unknown;
  let pending: {
    id: string;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
  } | null = null;
  const stop = (error: unknown) => {
    if (stopped) return;
    stopped = error;
    worker.terminate();
    pending?.reject(error);
    pending = null;
  };
  const abort = () => stop(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timeout = setTimeout(() => stop(new LabelReadError('timeout')), 120_000);
  worker.onerror = (event) => {
    event.preventDefault();
    stop(new LabelReadError('failed'));
  };
  worker.onmessageerror = () => stop(new LabelReadError('failed'));
  worker.onmessage = ({ data }: MessageEvent<Packet>) => {
    if (!pending || data.jobId !== pending.id) return;
    if (data.status === 'resolve') {
      const job = pending;
      pending = null;
      job.resolve(data.data);
    } else if (data.status === 'reject') stop(new LabelReadError('failed'));
  };
  const job = (action: string, payload: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      if (stopped) return reject(stopped);
      const id = String(++serial);
      pending = { id, resolve, reject };
      try {
        worker.postMessage({ workerId: 'jar-label', jobId: id, action, payload });
      } catch {
        stop(new LabelReadError('failed'));
      }
    });
  try {
    await job('load', {
      options: { lstmOnly: true, corePath: `${base}/tesseract-core-lstm.js`, logging: false },
    });
    await job('loadLanguage', {
      langs: 'eng',
      options: { langPath: base, cacheMethod: 'none', gzip: true, lstmOnly: true },
    });
    await job('initialize', { langs: 'eng', oem: 1, config: {} });
    await job('setParameters', { params: { tessedit_pageseg_mode: '11' } });
    const result = (await job('recognize', {
      image,
      options: {},
      output: { text: true, blocks: true },
    })) as { text: string; blocks?: Block[] };
    return {
      text: result.text,
      words: (result.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words))),
    };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
    stop(new DOMException('Finished', 'AbortError'));
    worker.onmessage = worker.onerror = worker.onmessageerror = null;
  }
}
