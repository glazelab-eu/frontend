import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UPLOAD_VISIBILITY,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_FILES,
  addFiles,
  allDone,
  canFocus,
  converted,
  defaultKind,
  editItem,
  emptyQueue,
  fileSizeLabel,
  focused,
  kindsFor,
  markDone,
  markFailed,
  markUploading,
  nextToUpload,
  rejectionOf,
  removeItem,
  retryItem,
  sendable,
  settle,
  start,
  startVisibility,
  stop,
  summary,
  uploadProgress,
  type UploadQueue,
} from './upload-queue';
import { MAX_HEIC_BYTES } from './heic';
import type { Club } from '../api/models';
import { club } from '../../test/fixtures';

const kiln = club();

const png = (name = 'tile.png', size = 5) => new File([new Uint8Array(size)], name, { type: 'image/png' });
const queueOf = (...names: string[]): UploadQueue =>
  addFiles(
    emptyQueue,
    names.map((name) => png(name)),
    'TEST_TILE',
  ).queue;
const statuses = (queue: UploadQueue) => queue.items.map((item) => item.status);

describe('kinds and visibility', () => {
  it('offers Packaging to glazes only and Work in progress to combinations only', () => {
    expect(kindsFor({ type: 'glaze' })).toEqual(['TEST_TILE', 'FINISHED', 'PACKAGING']);
    expect(kindsFor({ type: 'combination' })).toEqual(['TEST_TILE', 'FINISHED', 'IN_PROGRESS']);
  });

  it('starts with the opener’s kind when the target allows it, else Test tile', () => {
    expect(defaultKind({ type: 'combination' })).toBe('TEST_TILE');
    expect(defaultKind({ type: 'combination', kind: 'FINISHED' })).toBe('FINISHED');
    expect(defaultKind({ type: 'glaze', kind: 'PACKAGING' })).toBe('PACKAGING');
    expect(defaultKind({ type: 'combination', kind: 'PACKAGING' })).toBe('TEST_TILE');
  });

  it('starts at Everyone and, for a remembered Club without a club, at the narrower Only me', () => {
    expect(DEFAULT_UPLOAD_VISIBILITY).toBe('PUBLIC');
    const own = (clubs: Club[]) => ({ private: true, clubs });
    expect(startVisibility('PUBLIC', own([]))).toBe('PUBLIC');
    expect(startVisibility('PRIVATE', own([]))).toBe('PRIVATE');
    // The writer chose club-only: leaving the last club must not widen the next upload to everyone.
    expect(startVisibility('CLUB', own([]))).toBe('PRIVATE');
    expect(startVisibility('CLUB', own([kiln]))).toBe('CLUB');
  });

  it("on someone else's combination falls back from Only me to a shared club, else to Everyone", () => {
    const foreign = (clubs: Club[]) => ({ private: false, clubs });
    expect(startVisibility('PRIVATE', foreign([kiln]))).toBe('CLUB');
    expect(startVisibility('PRIVATE', foreign([]))).toBe('PUBLIC');
    expect(startVisibility('CLUB', foreign([]))).toBe('PUBLIC');
    expect(startVisibility('CLUB', foreign([kiln]))).toBe('CLUB');
    expect(startVisibility('PUBLIC', foreign([kiln]))).toBe('PUBLIC');
  });
});

describe('validation', () => {
  it('accepts images up to the API limit and names why others fail', () => {
    expect(rejectionOf({ type: 'image/jpeg', size: MAX_UPLOAD_BYTES })).toBeNull();
    expect(rejectionOf({ type: 'image/heic', size: 10 })).toBeNull();
    expect(rejectionOf({ type: '', name: 'IMG_1.HEIC', size: MAX_UPLOAD_BYTES + 1 })).toBeNull();
    expect(rejectionOf({ type: 'image/heic', size: MAX_HEIC_BYTES + 1 })).toBe('tooLarge');
    expect(rejectionOf({ type: 'application/octet-stream', name: 'IMG_1.heif', size: 10 })).toBeNull();
    expect(rejectionOf({ type: '', size: 10 })).toBeNull();
    expect(rejectionOf({ type: 'image/png', size: MAX_UPLOAD_BYTES + 1 })).toBe('tooLarge');
    expect(rejectionOf({ type: 'application/pdf', size: 10 })).toBe('notImage');
    expect(rejectionOf({ type: 'image/png', size: 0 })).toBe('empty');
  });

  it('adds the good files in order and names the others', () => {
    const files = [png('a.png'), new File(['x'], 'notes.txt', { type: 'text/plain' }), png('b.png'), png('big.png', MAX_UPLOAD_BYTES + 1)];
    const { queue, rejected } = addFiles(emptyQueue, files, 'FINISHED');
    expect(queue.items.map((item) => [item.file.name, item.kind, item.status])).toEqual([
      ['a.png', 'FINISHED', 'idle'],
      ['b.png', 'FINISHED', 'idle'],
    ]);
    expect(rejected).toEqual([
      { name: 'notes.txt', reason: 'notImage' },
      { name: 'big.png', reason: 'tooLarge' },
    ]);
  });

  it('queues HEIC photos as converting, by type or by extension in any case, and other images as idle', () => {
    const files = [
      new File(['x'], 'a.png', { type: 'image/png' }),
      new File(['x'], 'b.HEIC', { type: '' }),
      new File(['x'], 'c', { type: 'image/heif' }),
      new File(['x'], 'd.jpg', { type: 'image/jpeg' }),
    ];
    const { queue, rejected } = addFiles(emptyQueue, files, 'TEST_TILE');
    expect(rejected).toEqual([]);
    expect(statuses(queue)).toEqual(['idle', 'converting', 'converting', 'idle']);
    // Not sendable until converted; a converted photo takes the JPEG's place; a removed one stays gone.
    expect(sendable(queue)).toBe(2);
    expect(start(queue).items.map((item) => item.status)).toEqual(['queued', 'converting', 'converting', 'queued']);
    const jpeg = new File(['y'], 'b.jpg', { type: 'image/jpeg' });
    const key = queue.items[1].key;
    const next = converted(queue, key, jpeg);
    expect(next.items[1]).toMatchObject({ status: 'idle', file: jpeg });
    expect(sendable(next)).toBe(3);
    expect(converted(removeItem(queue, key), key, jpeg).items).toHaveLength(3);
    expect(converted(next, key, png('z.png')).items[1].file).toBe(jpeg);
  });

  it('keeps the queue to the limit and keys stable across removals', () => {
    const many = Array.from({ length: MAX_UPLOAD_FILES + 2 }, (_, index) => png(`${index}.png`));
    const { queue, rejected } = addFiles(emptyQueue, many, 'TEST_TILE');
    expect(queue.items).toHaveLength(MAX_UPLOAD_FILES);
    expect(rejected.map((item) => item.reason)).toEqual(['tooMany', 'tooMany']);
    const removed = removeItem(queue, queue.items[0].key);
    const again = addFiles(removed, [png('new.png')], 'TEST_TILE').queue;
    expect(new Set(again.items.map((item) => item.key)).size).toBe(again.items.length);
  });

  it.each([
    [999_000, '999 KB'],
    [1_000_000, '1 MB'],
  ])('shows %j bytes as %s: megabytes start at 1 MB', (bytes, label) => {
    expect(fileSizeLabel(bytes, 'en')).toBe(label);
  });

  it('formats sizes in decimal units like the limit', () => {
    expect(fileSizeLabel(10, 'en')).toBe('1 KB');
    expect(fileSizeLabel(340_000, 'en')).toBe('340 KB');
    expect(fileSizeLabel(2_400_000, 'en')).toBe('2.4 MB');
    expect(fileSizeLabel(MAX_UPLOAD_BYTES, 'en')).toBe('12 MB');
  });
});

describe('the queue', () => {
  it('uploads one file at a time in list order and ends when all are done', () => {
    let queue = start(queueOf('a', 'b', 'c'));
    expect(queue.running).toBe(true);
    expect(statuses(queue)).toEqual(['queued', 'queued', 'queued']);
    const order: string[] = [];
    for (let item = nextToUpload(queue); item; item = nextToUpload(queue)) {
      queue = markUploading(queue, item.key);
      // While one is being sent, none is offered.
      expect(nextToUpload(queue)).toBeNull();
      order.push(item.file.name);
      queue = markDone(queue, item.key);
    }
    expect(order).toEqual(['a', 'b', 'c']);
    queue = settle(queue);
    expect(queue.running).toBe(false);
    expect(allDone(queue)).toBe(true);
    expect(summary(queue)).toMatchObject({ total: 3, done: 3, failed: 0, pending: 0 });
  });

  it('goes on after a failed file, keeps its message and retries it alone', () => {
    let queue = start(queueOf('a', 'b', 'c'));
    const [a, b, c] = queue.items.map((item) => item.key);
    queue = markDone(markUploading(queue, a), a);
    queue = markFailed(markUploading(queue, b), b, 'Unsupported image');
    expect(nextToUpload(queue)?.key).toBe(c);
    queue = markDone(markUploading(queue, c), c);
    queue = settle(queue);
    expect(statuses(queue)).toEqual(['done', 'failed', 'done']);
    expect(queue.items[1].error).toBe('Unsupported image');
    expect(allDone(queue)).toBe(false);
    expect(summary(queue)).toMatchObject({ done: 2, failed: 1, pending: 0 });
    expect(sendable(queue)).toBe(1);

    queue = retryItem(queue, b);
    expect(queue.running).toBe(true);
    expect(queue.items[1]).toMatchObject({ status: 'queued', error: '' });
    expect(nextToUpload(queue)?.key).toBe(b);
    queue = settle(markDone(markUploading(queue, b), b));
    expect(allDone(queue)).toBe(true);
  });

  it('retries only failed files', () => {
    const queue = queueOf('a');
    expect(retryItem(queue, queue.items[0].key)).toBe(queue);
    expect(retryItem(queue, 99)).toBe(queue);
  });

  it('start sends idle and failed files, never twice at once and never when nothing is left', () => {
    expect(start(emptyQueue)).toBe(emptyQueue);
    let queue = start(queueOf('a', 'b'));
    expect(start(queue)).toBe(queue);
    const [a, b] = queue.items.map((item) => item.key);
    queue = markDone(markUploading(queue, a), a);
    queue = settle(markFailed(markUploading(queue, b), b, 'x'));
    queue = start(queue);
    expect(statuses(queue)).toEqual(['done', 'queued']);
    expect(start(settle(markDone(markUploading(queue, b), b)))).toMatchObject({ running: false });
  });

  it('cancel stops further uploads: waiting files go back to idle and the one being sent finishes', () => {
    let queue = start(queueOf('a', 'b', 'c'));
    const [a] = queue.items.map((item) => item.key);
    queue = markUploading(queue, a);
    queue = stop(queue);
    expect(queue.running).toBe(false);
    expect(statuses(queue)).toEqual(['uploading', 'idle', 'idle']);
    expect(nextToUpload(queue)).toBeNull();
    queue = markDone(queue, a);
    expect(nextToUpload(queue)).toBeNull();
    expect(summary(queue)).toMatchObject({ done: 1, idle: 2, pending: 0 });
    expect(sendable(queue)).toBe(2);
    expect(allDone(queue)).toBe(false);
    // Uploading again sends the rest only.
    expect(statuses(start(queue))).toEqual(['done', 'queued', 'queued']);
  });

  it('edits and removes unsent files only', () => {
    let queue = start(queueOf('a', 'b'));
    const [a, b] = queue.items.map((item) => item.key);
    queue = markUploading(queue, a);
    expect(editItem(queue, a, { caption: 'x' }).items[0].caption).toBe('');
    expect(editItem(queue, b, { caption: 'Top shelf', kind: 'FINISHED', firedOn: '2026-10-14' }).items[1]).toMatchObject({
      caption: 'Top shelf',
      kind: 'FINISHED',
      firedOn: '2026-10-14',
    });
    expect(removeItem(queue, a)).toBe(queue);
    expect(removeItem(queue, b).items.map((item) => item.key)).toEqual([a]);
    queue = markDone(queue, a);
    expect(editItem(queue, a, { kind: 'FINISHED' }).items[0].kind).toBe('TEST_TILE');
  });

  it('numbers the file being sent within the batch', () => {
    let queue = start(queueOf('a', 'b', 'c'));
    const [a, b] = queue.items.map((item) => item.key);
    queue = markDone(markUploading(queue, a), a);
    queue = markUploading(queue, b);
    expect(summary(queue)).toMatchObject({ position: 2, batch: 3 });
  });

  it('is done for a queue of one finished file', () => {
    const queue = queueOf('a');
    expect(allDone(markDone(markUploading(start(queue), queue.items[0].key), queue.items[0].key))).toBe(true);
  });

  it('ends the batch only when no file is waiting or being sent', () => {
    const waiting = start(queueOf('a', 'b'));
    const [a, b] = waiting.items.map((item) => item.key);
    const sending = markUploading(waiting, a);
    const firstDone = markDone(sending, a);
    for (const running of [waiting, sending, firstDone]) expect(settle(running)).toBe(running);
    expect(settle(markUploading(firstDone, b)).running).toBe(true);
    expect(settle(markDone(markUploading(firstDone, b), b)).running).toBe(false);
  });

  it('leaves a queue that is not running as it is', () => {
    const idle = queueOf('a');
    expect(settle(idle)).toBe(idle);
  });

  it('an empty queue is not done', () => {
    expect(allDone(emptyQueue)).toBe(false);
  });
});

describe('uploadProgress', () => {
  const counts = (fields: Partial<ReturnType<typeof summary>>) => ({ ...summary(emptyQueue), ...fields });

  it('names the file being sent among the batch, then the result', () => {
    expect(uploadProgress(counts({ position: 2, batch: 3, pending: 2, done: 1 }), true)).toEqual({
      key: 'upload.uploading',
      values: { position: 2, total: 3 },
    });
    expect(uploadProgress(counts({ done: 2, failed: 1 }), false)).toEqual({ key: 'upload.result', values: { done: 2, failed: 1 } });
  });

  it('says a stopped batch still finishes its file, and that HEIC photos convert while nothing is sent', () => {
    expect(uploadProgress(counts({ pending: 1 }), false)).toEqual({ key: 'upload.stopping' });
    expect(uploadProgress(counts({ converting: 1 }), false)).toEqual({ key: 'upload.converting' });
  });

  it('says nothing before anything was sent', () => {
    expect(uploadProgress(counts({ total: 2, idle: 2 }), false)).toBeNull();
  });
});

describe('focus', () => {
  it('starts every photo at the centre', () => {
    expect(queueOf('a').items[0].focus).toBeNull();
  });

  it('keeps the focus with the photo as it was chosen, and resets it to the centre', () => {
    let queue = queueOf('a');
    const [{ key, file }] = queue.items;
    queue = focused(queue, key, { x: 20, y: 80 });
    expect(queue.items[0]).toMatchObject({ file, focus: { x: 20, y: 80 } });
    expect(focused(queue, key, { x: 20, y: 80 })).toBe(queue);
    queue = focused(queue, key, null);
    expect(queue.items[0]).toMatchObject({ file, focus: null });
    expect(focused(queue, key, null)).toBe(queue);
  });

  it('sets a focus only on photos that are chosen or failed: never one converting, waiting, in flight or stored', () => {
    let queue = start(queueOf('a', 'b', 'c'));
    const [a, b, c] = queue.items.map((item) => item.key);
    expect(canFocus(queue.items[1])).toBe(false);
    expect(focused(queue, b, { x: 1, y: 1 })).toBe(queue);
    queue = markUploading(queue, a);
    expect(focused(queue, a, { x: 1, y: 1 })).toBe(queue);
    queue = markFailed(queue, a, 'errors.generic');
    expect(canFocus(queue.items[0])).toBe(true);
    expect(focused(queue, a, { x: 1, y: 1 }).items[0].focus).toEqual({ x: 1, y: 1 });
    queue = markDone(queue, c);
    expect(focused(queue, c, { x: 1, y: 1 })).toBe(queue);
    const heic = addFiles(emptyQueue, [new File([new Uint8Array(5)], 'pot.heic', { type: 'image/heic' })], 'TEST_TILE').queue;
    expect(focused(heic, heic.items[0].key, { x: 1, y: 1 })).toBe(heic);
    expect(focused(queue, 999, { x: 1, y: 1 })).toBe(queue);
  });
});
