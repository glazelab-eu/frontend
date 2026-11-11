import { describe, expect, it, vi } from 'vitest';
import type { ImageUploadInput } from '../../lib/api/inputs';
import type { HeicResult } from '../../lib/images/heic';
import type { UploadResult } from '../../lib/images/upload-queue';
import { createUploadSession } from './upload-session.svelte';

const png = (name: string, size = 5, type = 'image/png') => new File([new Uint8Array(size)], name, { type });
const tick = () => new Promise((resolve) => setTimeout(resolve));

function setup(
  target: { type: 'glaze' | 'combination'; kind?: 'TEST_TILE' | 'FINISHED' | 'PACKAGING' } = { type: 'combination' },
  convert: (file: File) => Promise<HeicResult> = () => Promise.reject(new Error('no HEIC expected')),
) {
  let counter = 0;
  const live = new Set<string>();
  const createUrl = vi.fn(() => {
    const url = `blob:${++counter}`;
    live.add(url);
    return url;
  });
  const revokeUrl = vi.fn((url: string) => {
    expect(live.delete(url), `revoked twice or never created: ${url}`).toBe(true);
  });
  const sent: ImageUploadInput[] = [];
  const pending: ((result: UploadResult) => void)[] = [];
  const settled: { done: number; failed: number; allDone: boolean }[] = [];
  let choices: { visibility: 'PUBLIC' | 'CLUB' | 'PRIVATE'; clubId: string } = { visibility: 'PUBLIC', clubId: '' };
  const session = createUploadSession({
    target: { ...target, id: 't1', title: 'Blue over cream' },
    upload: (input) => {
      sent.push(input);
      return new Promise<UploadResult>((resolve) => pending.push(resolve));
    },
    common: () => choices,
    onSettled: (outcome) => settled.push(outcome),
    convert,
    createUrl,
    revokeUrl,
  });
  return {
    session,
    sent,
    settled,
    live,
    createUrl,
    revokeUrl,
    /** Answers the oldest request and lets the loop go on. */
    async answer(result: UploadResult = { ok: true }) {
      pending.shift()!(result);
      await tick();
    },
    pending: () => pending.length,
    choose: (value: typeof choices) => (choices = value),
  };
}

describe('createUploadSession', () => {
  it('sends the files one request at a time, each with its own kind, caption and date, and reports once', async () => {
    const s = setup();
    s.session.add([png('a.png'), png('b.png'), png('c.png')]);
    const [a, b, c] = s.session.items.map((item) => item.key);
    s.session.edit(a, { caption: 'Top shelf', firedOn: '2026-10-14' });
    s.session.edit(b, { kind: 'FINISHED' });
    s.choose({ visibility: 'PUBLIC', clubId: '' });
    s.session.send();
    expect(s.pending()).toBe(1);
    expect(s.session.running).toBe(true);
    expect(s.sent[0]).toMatchObject({
      target: { type: 'combination', id: 't1' },
      kind: 'TEST_TILE',
      caption: 'Top shelf',
      firedOn: '2026-10-14',
      visibility: 'PUBLIC',
    });
    expect(s.session.summary).toMatchObject({ position: 1, batch: 3 });
    await s.answer();
    expect(s.sent[1]).toMatchObject({ kind: 'FINISHED', caption: '' });
    expect(s.pending()).toBe(1);
    await s.answer();
    expect(s.sent[2].file.name).toBe('c.png');
    expect(s.settled).toEqual([]);
    await s.answer();
    expect(s.settled).toEqual([{ done: 3, failed: 0, allDone: true }]);
    expect(s.session.running).toBe(false);
    expect(s.session.items.map((item) => item.key)).toEqual([a, b, c]);
  });

  it('keeps going after a failure, shows it at its file and sends only that file again on retry', async () => {
    const s = setup();
    s.session.add([png('a.png'), png('b.png'), png('c.png')]);
    s.session.send();
    await s.answer();
    await s.answer({ ok: false, message: 'Unsupported image', stop: false });
    await s.answer();
    expect(s.session.items.map((item) => item.status)).toEqual(['done', 'failed', 'done']);
    expect(s.session.items[1].error).toBe('Unsupported image');
    expect(s.settled).toEqual([{ done: 2, failed: 1, allDone: false }]);
    const failed = s.session.items[1];
    s.session.retry(failed.key);
    expect(s.sent.map((input) => input.file.name)).toEqual(['a.png', 'b.png', 'c.png', 'b.png']);
    await s.answer();
    expect(s.settled.at(-1)).toEqual({ done: 3, failed: 0, allDone: true });
  });

  it('stops the batch on a stopping failure and leaves the rest unsent for another try', async () => {
    const s = setup();
    s.session.add([png('a.png'), png('b.png'), png('c.png')]);
    s.session.send();
    await s.answer({ ok: false, message: 'errors.termsRequired', stop: true });
    expect(s.pending()).toBe(0);
    expect(s.session.items.map((item) => item.status)).toEqual(['failed', 'idle', 'idle']);
    expect(s.session.running).toBe(false);
    expect(s.session.sendable).toBe(3);
    s.session.send();
    expect(s.session.items.map((item) => item.status)).toEqual(['uploading', 'queued', 'queued']);
  });

  it('cancel lets the file being sent finish and sends no further file', async () => {
    const s = setup();
    s.session.add([png('a.png'), png('b.png')]);
    s.session.send();
    s.session.cancel();
    expect(s.session.items.map((item) => item.status)).toEqual(['uploading', 'idle']);
    await s.answer();
    expect(s.session.items.map((item) => item.status)).toEqual(['done', 'idle']);
    expect(s.sent).toHaveLength(1);
    expect(s.settled).toEqual([{ done: 1, failed: 0, allDone: false }]);
  });

  it('answers a thrown upload as a failed file', async () => {
    const s = setup();
    const failing = createUploadSession({
      target: { type: 'glaze', id: 'g1', title: 'x' },
      upload: () => Promise.reject(new Error('boom')),
      common: () => ({ visibility: 'PRIVATE', clubId: '' }),
      onSettled: (outcome) => s.settled.push(outcome),
    });
    failing.add([png('a.png')]);
    failing.send();
    await tick();
    expect(failing.items[0]).toMatchObject({ status: 'failed', error: 'errors.generic' });
    failing.dispose();
  });

  it('guards a second start while a batch runs', async () => {
    const s = setup();
    s.session.add([png('a.png'), png('b.png')]);
    s.session.send();
    s.session.send();
    expect(s.pending()).toBe(1);
    await s.answer();
    await s.answer();
    expect(s.sent).toHaveLength(2);
  });

  it('starts every file with the target’s kind: Test tile, the opener’s kind, never Packaging on a combination', () => {
    for (const [target, kind] of [
      [{ type: 'combination' as const }, 'TEST_TILE'],
      [{ type: 'combination' as const, kind: 'FINISHED' as const }, 'FINISHED'],
      [{ type: 'combination' as const, kind: 'PACKAGING' as const }, 'TEST_TILE'],
      [{ type: 'glaze' as const, kind: 'PACKAGING' as const }, 'PACKAGING'],
    ] as const) {
      const s = setup(target);
      s.session.add([png('a.png')]);
      expect(s.session.items[0].kind).toBe(kind);
    }
  });

  it('names rejected files without queueing them or making a preview, and clears the names on the next choice', () => {
    const s = setup();
    s.session.add([png('big.png', 12_000_001), png('notes.txt', 5, 'text/plain'), png('ok.png')]);
    expect(s.session.items.map((item) => item.file.name)).toEqual(['ok.png']);
    expect(s.session.rejected).toEqual([
      { name: 'big.png', reason: 'tooLarge' },
      { name: 'notes.txt', reason: 'notImage' },
    ]);
    expect(s.createUrl).toHaveBeenCalledTimes(1);
    s.session.add([png('two.png')]);
    expect(s.session.rejected).toEqual([]);
    expect(s.sent).toEqual([]);
  });

  it('makes one preview URL per file and revokes each exactly once: on removal, after upload and on dispose', async () => {
    const s = setup();
    s.session.add([png('a.png'), png('b.png'), png('c.png')]);
    const [a, b, c] = s.session.items.map((item) => item.key);
    expect(s.createUrl).toHaveBeenCalledTimes(3);
    expect(s.session.previewOf(a)).toBe('blob:1');
    s.session.remove(b);
    expect(s.revokeUrl).toHaveBeenCalledWith('blob:2');
    expect(s.session.previewOf(b)).toBeUndefined();
    s.session.remove(b);
    s.session.send();
    // The file being sent cannot be removed and keeps its preview.
    s.session.remove(a);
    expect(s.session.items.map((item) => item.key)).toEqual([a, c]);
    expect(s.session.previewOf(a)).toBe('blob:1');
    await s.answer();
    expect(s.session.previewOf(a)).toBeUndefined();
    expect(s.live).toEqual(new Set(['blob:3']));
    s.session.dispose();
    expect(s.live.size).toBe(0);
    expect(s.createUrl).toHaveBeenCalledTimes(s.revokeUrl.mock.calls.length);
  });

  it('is quiet after dispose: the answer of the file in flight changes nothing and starts nothing', async () => {
    const s = setup();
    s.session.add([png('a.png'), png('b.png')]);
    s.session.send();
    s.session.dispose();
    await s.answer();
    expect(s.sent).toHaveLength(1);
    expect(s.settled).toEqual([]);
    expect(s.live.size).toBe(0);
    expect(s.createUrl).toHaveBeenCalledTimes(s.revokeUrl.mock.calls.length);
  });

  it('sends the choices of the moment: the visibility and club picked after the files were added', async () => {
    const s = setup();
    s.session.add([png('a.png')]);
    s.choose({ visibility: 'CLUB', clubId: 'c1' });
    s.session.send();
    expect(s.sent[0]).toMatchObject({ visibility: 'CLUB', clubId: 'c1' });
  });

  describe('HEIC photos', () => {
    const heic = (name = 'IMG_0001.HEIC', type = '') => png(name, 8, type);
    const jpeg = (name = 'IMG_0001.jpg') => new File([new Uint8Array(4)], name, { type: 'image/jpeg' });
    /** A conversion the test settles itself. */
    function manual() {
      const waiting: ((result: HeicResult) => void)[] = [];
      const convert = vi.fn((_file: File) => new Promise<HeicResult>((resolve) => waiting.push(resolve)));
      return {
        convert,
        async settle(result: HeicResult) {
          waiting.shift()!(result);
          await tick();
        },
      };
    }

    it('waits as converting without a preview or a request, then sends the JPEG and never the HEIC', async () => {
      const m = manual();
      const s = setup({ type: 'combination' }, m.convert);
      s.session.add([heic()]);
      const [item] = s.session.items;
      expect(item.status).toBe('converting');
      expect(s.session.previewOf(item.key)).toBeUndefined();
      expect(s.session.sendable).toBe(0);
      expect(s.session.summary).toMatchObject({ converting: 1, idle: 0 });
      s.session.send();
      expect(s.pending()).toBe(0);

      await m.settle({ ok: true, file: jpeg() });
      expect(s.session.items[0]).toMatchObject({ status: 'idle', file: expect.objectContaining({ name: 'IMG_0001.jpg', type: 'image/jpeg' }) });
      expect(s.session.previewOf(item.key)).toBeDefined();
      expect(s.session.sendable).toBe(1);
      s.session.send();
      expect(s.sent).toHaveLength(1);
      expect(s.sent[0].file).toMatchObject({ name: 'IMG_0001.jpg', type: 'image/jpeg' });
      await s.answer();
      expect(s.live.size).toBe(0);
    });

    it('names a photo that cannot be converted, drops it and never sends it', async () => {
      const s = setup({ type: 'combination' }, () => Promise.resolve({ ok: false, reason: 'unsupported' }));
      s.session.add([heic('IMG_0002.heic', 'image/heic')]);
      await tick();
      expect(s.session.items).toEqual([]);
      expect(s.session.rejected).toEqual([{ name: 'IMG_0002.heic', reason: 'heic' }]);
      expect(s.session.sendable).toBe(0);
      s.session.send();
      expect(s.sent).toEqual([]);
      expect(s.createUrl).not.toHaveBeenCalled();
    });

    it('treats a throwing conversion as a failed one and a too large result as too large', async () => {
      const results: (() => Promise<HeicResult>)[] = [() => Promise.reject(new Error('boom')), () => Promise.resolve({ ok: false, reason: 'tooLarge' })];
      const s = setup({ type: 'combination' }, () => results.shift()!());
      s.session.add([heic('a.heic'), heic('b.heif')]);
      await tick();
      expect(s.session.rejected).toEqual([
        { name: 'a.heic', reason: 'heic' },
        { name: 'b.heif', reason: 'tooLarge' },
      ]);
      expect(s.sent).toEqual([]);
    });

    it('converts one photo at a time and leaves other photos alone', async () => {
      const m = manual();
      const s = setup({ type: 'combination' }, m.convert);
      s.session.add([heic('a.heic'), png('b.png'), heic('c.heic')]);
      expect(s.session.items.map((item) => item.status)).toEqual(['converting', 'idle', 'converting']);
      expect(m.convert).toHaveBeenCalledTimes(1);
      await m.settle({ ok: true, file: jpeg('a.jpg') });
      expect(m.convert).toHaveBeenCalledTimes(2);
      await m.settle({ ok: true, file: jpeg('c.jpg') });
      expect(s.session.items.map((item) => item.file.name)).toEqual(['a.jpg', 'b.png', 'c.jpg']);
      expect(s.session.items.map((item) => item.status)).toEqual(['idle', 'idle', 'idle']);
    });

    it('ignores the result of a photo removed meanwhile, and of a disposed session', async () => {
      const m = manual();
      const s = setup({ type: 'combination' }, m.convert);
      s.session.add([heic('a.heic'), heic('b.heic')]);
      s.session.remove(s.session.items[0].key);
      await m.settle({ ok: true, file: jpeg('a.jpg') });
      expect(s.session.items.map((item) => item.file.name)).toEqual(['b.heic']);
      expect(s.session.rejected).toEqual([]);
      s.session.dispose();
      await m.settle({ ok: true, file: jpeg('b.jpg') });
      expect(s.session.items[0].status).toBe('converting');
      expect(s.live.size).toBe(0);
    });
  });

  it('clear drops every file and preview; the file being sent finishes and nothing starts behind it', async () => {
    const s = setup();
    s.session.add([png('a.png'), png('b.png'), png('nope.txt', 5, 'text/plain')]);
    s.session.send();
    s.session.clear();
    expect(s.session.items).toEqual([]);
    expect(s.session.rejected).toEqual([]);
    expect(s.live.size).toBe(0);
    await s.answer();
    expect(s.sent).toHaveLength(1);
    expect(s.session.items).toEqual([]);
    s.session.add([png('c.png')]);
    expect(s.session.items.map((item) => item.file.name)).toEqual(['c.png']);
  });

  it('sends a photo whole with its focus as it was set, and the centre without one', async () => {
    const s = setup();
    s.session.add([png('a.png'), png('b.png')]);
    const [{ key, file: chosen }] = s.session.items;
    const before = s.session.previewOf(key);
    s.session.focus(key, { x: 30, y: 70 });
    expect(s.session.previewOf(key)).toBe(before);
    expect(s.revokeUrl).not.toHaveBeenCalled();
    s.session.send();
    await s.answer();
    await s.answer();
    expect(s.sent[0]).toMatchObject({ file: chosen, focus: { x: 30, y: 70 } });
    expect(s.sent[1]).toMatchObject({ focus: null });
  });

  it('sets no focus once the photo is under way or the session is gone', () => {
    const s = setup();
    s.session.add([png('a.png')]);
    const [{ key }] = s.session.items;
    s.session.send();
    s.session.focus(key, { x: 1, y: 1 });
    expect(s.session.items[0].focus).toBeNull();
    s.session.dispose();
    s.session.focus(key, { x: 1, y: 1 });
    expect(s.session.items[0]?.focus ?? null).toBeNull();
  });
});
