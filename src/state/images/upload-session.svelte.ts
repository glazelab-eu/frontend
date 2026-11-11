import type { UploadTarget } from '../../lib/api/models';
import { convertHeic, type HeicResult } from '../../lib/images/heic';
import type { ImageUploadInput } from '../../lib/api/inputs';
import type { Focus } from '../../lib/images/photo-focus';
import {
  addFiles,
  MAX_UPLOAD_BYTES,
  allDone,
  converted,
  defaultKind,
  editItem,
  emptyQueue,
  focused,
  markDone,
  markFailed,
  markUploading,
  nextToUpload,
  removeItem,
  retryItem,
  sendable,
  settle,
  start,
  stop,
  summary,
  type Rejected,
  type UploadItem,
  type UploadResult,
  type UploadVisibility,
} from '../../lib/images/upload-queue';

interface Options {
  target: UploadTarget;
  /** Sends one file and patches the answer into the listings; never throws for a failed upload. */
  upload: (input: ImageUploadInput) => Promise<UploadResult>;
  /** Read when a file goes out, so the choices made meanwhile apply. */
  common: () => { visibility: UploadVisibility; clubId: string };
  /** A batch ended: how many files are done and how many failed (not after `dispose`). */
  onSettled: (outcome: { done: number; failed: number; allDone: boolean }) => void;
  /** Turns a HEIC/HEIF photo into a JPEG (`convertHeic`); a failure is named in `rejected` and the photo never goes out. */
  convert?: (file: File) => Promise<HeicResult>;
  createUrl?: (file: File) => string;
  revokeUrl?: (url: string) => void;
}

/**
 * The state of one upload dialog over the pure queue of `lib/images/upload-queue.ts`: the chosen files,
 * their previews (one object URL each, revoked when a file is removed, has been sent or the session
 * is disposed) and the loop that sends them one at a time. A failed file does not stop the batch;
 * `stop` results (offline, signed out, terms, rate limit) and `cancel` do, and the file being sent
 * always finishes (no abort: the server may already have stored it). `dispose` ends it quietly:
 * nothing is reported afterwards.
 */
export function createUploadSession({
  target,
  upload,
  common,
  onSettled,
  convert = (file) => convertHeic(file, MAX_UPLOAD_BYTES),
  createUrl = URL.createObjectURL,
  revokeUrl = URL.revokeObjectURL,
}: Options) {
  let queue = $state.raw(emptyQueue);
  let rejected = $state.raw<Rejected[]>([]);
  let previews = $state.raw<Record<number, string>>({});
  let disposed = false;
  let looping = false;
  let converting = false;

  function dropPreview(key: number) {
    const url = previews[key];
    if (url === undefined) return;
    revokeUrl(url);
    const { [key]: _removed, ...rest } = previews;
    previews = rest;
  }

  /** Converts the HEIC photos one at a time (a decoded photo is large); the conversions run beside a batch. */
  async function convertPending() {
    if (converting) return;
    converting = true;
    try {
      for (;;) {
        const item = queue.items.find((candidate) => candidate.status === 'converting');
        if (!item || disposed) return;
        let result: HeicResult;
        try {
          result = await convert(item.file);
        } catch {
          result = { ok: false, reason: 'unsupported' };
        }
        if (disposed) return;
        if (!queue.items.some((candidate) => candidate.key === item.key && candidate.status === 'converting')) continue; // removed meanwhile
        if (result.ok) {
          queue = converted(queue, item.key, result.file);
          previews = { ...previews, [item.key]: createUrl(result.file) };
        } else {
          queue = removeItem(queue, item.key);
          rejected = [...rejected, { name: item.file.name, reason: result.reason === 'tooLarge' ? 'tooLarge' : 'heic' }];
        }
      }
    } finally {
      converting = false;
    }
  }

  async function run() {
    if (looping) return;
    looping = true;
    let sent = false;
    try {
      for (;;) {
        const item = nextToUpload(queue);
        if (!item || disposed) break;
        sent = true;
        queue = markUploading(queue, item.key);
        let result: UploadResult;
        try {
          result = await upload({
            target: { type: target.type, id: target.id },
            ...common(),
            file: item.file,
            kind: item.kind,
            caption: item.caption,
            firedOn: item.firedOn,
            focus: item.focus,
          });
        } catch {
          result = { ok: false, message: 'errors.generic', stop: false };
        }
        if (disposed) return;
        if (result.ok) {
          queue = markDone(queue, item.key);
          dropPreview(item.key);
        } else {
          queue = markFailed(queue, item.key, result.message);
          if (result.stop) queue = stop(queue);
        }
      }
    } finally {
      looping = false;
    }
    queue = settle(queue);
    if (sent && !disposed) {
      const counts = summary(queue);
      onSettled({ done: counts.done, failed: counts.failed, allDone: allDone(queue) });
    }
  }

  return {
    get items(): UploadItem[] {
      return queue.items;
    },
    get running() {
      return queue.running;
    },
    get summary() {
      return summary(queue);
    },
    /** Files "Upload" would send: not yet sent, or failed. */
    get sendable() {
      return sendable(queue);
    },
    get rejected() {
      return rejected;
    },
    previewOf: (key: number): string | undefined => previews[key],
    /** Adds chosen files with the target's default kind; the others are named in `rejected` until the next choice. */
    add(files: File[]) {
      const added = addFiles(queue, files, defaultKind(target));
      const first = queue.nextKey;
      queue = added.queue;
      rejected = added.rejected;
      const urls = { ...previews };
      // A HEIC photo gets its preview from the JPEG made of it (most browsers cannot show HEIC).
      for (const item of queue.items) if (item.key >= first && item.status !== 'converting') urls[item.key] = createUrl(item.file);
      previews = urls;
      void convertPending();
    },
    edit(key: number, fields: Parameters<typeof editItem>[2]) {
      queue = editItem(queue, key, fields);
    },
    /** The focus the photo goes with (null: the centre); the photo itself is sent whole. */
    focus(key: number, focus: Focus | null) {
      if (!disposed) queue = focused(queue, key, focus);
    },
    remove(key: number) {
      const next = removeItem(queue, key);
      if (next === queue) return;
      queue = next;
      dropPreview(key);
    },
    /** Sends every file not yet sent, and those that failed. */
    send() {
      const next = start(queue);
      if (next === queue) return;
      queue = next;
      void run();
    },
    retry(key: number) {
      const next = retryItem(queue, key);
      if (next === queue) return;
      queue = next;
      void run();
    },
    /** No further file starts; the one being sent finishes. */
    cancel() {
      queue = stop(queue);
    },
    /** Drops every file, its preview and the rejections; a file being sent still finishes, but nothing waits behind it. */
    clear() {
      queue = { ...emptyQueue, nextKey: queue.nextKey };
      rejected = [];
      for (const url of Object.values(previews)) revokeUrl(url);
      previews = {};
    },
    dispose() {
      disposed = true;
      for (const url of Object.values(previews)) revokeUrl(url);
      previews = {};
    },
  };
}

export type UploadSession = ReturnType<typeof createUploadSession>;
