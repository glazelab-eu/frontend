import { describe, expect, it, vi } from 'vitest';
import type { ImageUploadInput } from '../../lib/api/inputs';
import type { HeicResult } from '../../lib/images/heic';
import type { UploadResult } from '../../lib/images/upload-queue';
import { createStudioPhotos } from './studio-photos.svelte';

const png = (name: string) => new File([new Uint8Array(5)], name, { type: 'image/png' });
const heic = (name: string) => new File([new Uint8Array(5)], name, { type: 'image/heic' });
const tick = () => new Promise((resolve) => setTimeout(resolve));

function setup(convert: (file: File) => Promise<HeicResult> = () => Promise.reject(new Error('no HEIC expected'))) {
  const live = new Set<string>();
  let counter = 0;
  const sent: ImageUploadInput[] = [];
  const pending: ((result: UploadResult) => void)[] = [];
  const onDone = vi.fn();
  const onDropped = vi.fn();
  const photos = createStudioPhotos({
    upload: (input) => {
      sent.push(input);
      return new Promise<UploadResult>((resolve) => pending.push(resolve));
    },
    common: () => ({ visibility: 'PRIVATE', clubId: '' }),
    onDone,
    onDropped,
    convert,
    createUrl: () => {
      const url = `blob:${++counter}`;
      live.add(url);
      return url;
    },
    revokeUrl: (url) => live.delete(url),
  });
  /** A save the test answers itself. */
  let answerSave!: (id: string | null) => void;
  const save = vi.fn(() => new Promise<string | null>((resolve) => (answerSave = resolve)));
  return {
    photos,
    sent,
    live,
    onDone,
    onDropped,
    save,
    async saved(id: string | null) {
      answerSave(id);
      await tick();
    },
    async answer(result: UploadResult = { ok: true }) {
      pending.shift()!(result);
      await tick();
    },
    pending: () => pending.length,
  };
}

describe('createStudioPhotos', () => {
  it('saves the combination first, then sends the photos one at a time to the saved ID with their own kinds', async () => {
    const s = setup();
    s.photos.session.add([png('tile.png'), png('bowl.png')]);
    const [, bowl] = s.photos.session.items.map((item) => item.key);
    s.photos.session.edit(bowl, { kind: 'FINISHED', caption: 'Bowl' });
    void s.photos.submit(s.save);
    expect(s.photos.phase).toBe('saving');
    expect(s.sent).toEqual([]);
    await s.saved('c1');
    expect(s.photos.phase).toBe('uploading');
    expect(s.pending()).toBe(1);
    expect(s.sent[0]).toMatchObject({ target: { type: 'combination', id: 'c1' }, kind: 'TEST_TILE', visibility: 'PRIVATE' });
    await s.answer();
    expect(s.sent[1]).toMatchObject({ target: { type: 'combination', id: 'c1' }, kind: 'FINISHED', caption: 'Bowl' });
    expect(s.onDone).not.toHaveBeenCalled();
    await s.answer();
    expect(s.photos.phase).toBe('done');
    expect(s.onDone).toHaveBeenCalledExactlyOnceWith('c1');
    expect(s.photos.attached).toBe(0);
    expect(s.live.size).toBe(0);
  });

  it('a refused save sends nothing and keeps the photos attached for the next try', async () => {
    const s = setup();
    s.photos.session.add([png('tile.png')]);
    void s.photos.submit(s.save);
    await s.saved(null);
    expect(s.photos.phase).toBe('editing');
    expect(s.photos.savedId).toBeNull();
    expect(s.sent).toEqual([]);
    expect(s.photos.attached).toBe(1);
  });

  it('does not start without photos, while a HEIC photo converts, or a second time while the first runs', async () => {
    const s = setup(() => new Promise(() => {}));
    expect(await s.photos.submit(s.save)).toBe(false);
    s.photos.session.add([heic('kiln.heic')]);
    expect(s.photos.converting).toBe(1);
    expect(await s.photos.submit(s.save)).toBe(false);
    expect(s.save).not.toHaveBeenCalled();

    const t = setup();
    t.photos.session.add([png('tile.png')]);
    void t.photos.submit(t.save);
    expect(await t.photos.submit(t.save)).toBe(false);
    expect(t.save).toHaveBeenCalledTimes(1);
  });

  it('a failed photo keeps the saved combination and its Retry; the retry finishes the job', async () => {
    const s = setup();
    s.photos.session.add([png('tile.png'), png('bowl.png')]);
    void s.photos.submit(s.save);
    await s.saved('c1');
    await s.answer();
    await s.answer({ ok: false, message: 'errors.imageTooBig', stop: false });
    expect(s.photos.phase).toBe('failed');
    expect(s.photos.savedId).toBe('c1');
    expect(s.photos.attached).toBe(1);
    expect(s.onDone).not.toHaveBeenCalled();
    const failed = s.photos.session.items.find((item) => item.status === 'failed')!;
    expect(failed.file.name).toBe('bowl.png');
    s.photos.retry(failed.key);
    expect(s.photos.phase).toBe('uploading');
    expect(s.sent.at(-1)).toMatchObject({ target: { id: 'c1' }, file: failed.file });
    await s.answer();
    expect(s.photos.phase).toBe('done');
    expect(s.onDone).toHaveBeenCalledExactlyOnceWith('c1');
    expect(s.save).toHaveBeenCalledTimes(1);
  });

  it('a stopping failure (the connection went) leaves the rest unsent; Retry all sends them and the failed one', async () => {
    const s = setup();
    s.photos.session.add([png('a.png'), png('b.png'), png('c.png')]);
    void s.photos.submit(s.save);
    await s.saved('c1');
    await s.answer({ ok: false, message: 'upload.notSent', stop: true });
    expect(s.photos.phase).toBe('failed');
    expect(s.photos.session.items.map((item) => item.status)).toEqual(['failed', 'idle', 'idle']);
    s.photos.retryAll();
    await s.answer();
    await s.answer();
    await s.answer();
    expect(s.sent.map((input) => input.file.name)).toEqual(['a.png', 'a.png', 'b.png', 'c.png']);
    expect(s.onDone).toHaveBeenCalledExactlyOnceWith('c1');
  });

  it('Retry all with every failed photo removed finishes instead of waiting forever', async () => {
    const s = setup();
    s.photos.session.add([png('a.png')]);
    void s.photos.submit(s.save);
    await s.saved('c1');
    await s.answer({ ok: false, message: 'errors.generic', stop: false });
    s.photos.session.remove(s.photos.session.items[0].key);
    s.photos.retryAll();
    expect(s.photos.phase).toBe('done');
    expect(s.onDone).toHaveBeenCalledExactlyOnceWith('c1');
  });

  it('Done drops the photos that did not go and leaves the saved state', async () => {
    const s = setup();
    s.photos.session.add([png('a.png')]);
    void s.photos.submit(s.save);
    await s.saved('c1');
    await s.answer({ ok: false, message: 'errors.generic', stop: false });
    s.photos.discard();
    expect(s.photos.attached).toBe(0);
    expect(s.photos.savedId).toBe('c1');
    expect(s.live.size).toBe(0);
  });

  it('leaving during the uploads lets the photo in flight finish, starts no other and says the rest were dropped', async () => {
    const s = setup();
    s.photos.session.add([png('a.png'), png('b.png')]);
    void s.photos.submit(s.save);
    await s.saved('c1');
    s.photos.dispose();
    expect(s.onDropped).toHaveBeenCalledOnce();
    await s.answer();
    expect(s.sent).toHaveLength(1);
    expect(s.pending()).toBe(0);
    expect(s.onDone).not.toHaveBeenCalled();
    expect(s.live.size).toBe(0);
  });

  it('leaving during the save sends no photo, and says so once the save went through', async () => {
    const s = setup();
    s.photos.session.add([png('a.png')]);
    void s.photos.submit(s.save);
    s.photos.dispose();
    expect(s.onDropped).not.toHaveBeenCalled();
    await s.saved('c1');
    expect(s.onDropped).toHaveBeenCalledOnce();
    expect(s.sent).toEqual([]);
  });

  it('an account change during the save drops every photo; the late answer sends nothing and reports nothing', async () => {
    const s = setup();
    s.photos.session.add([png('a.png'), png('b.png')]);
    void s.photos.submit(s.save);
    s.photos.reset();
    expect(s.photos.session.items).toEqual([]);
    expect(s.live.size).toBe(0);
    await s.saved('c1');
    expect(s.sent).toEqual([]);
    expect(s.photos.phase).toBe('editing');
    expect(s.photos.savedId).toBeNull();
    expect(s.onDropped).not.toHaveBeenCalled();
  });

  it('an account change during the uploads stops after the photo in flight and forgets the saved combination', async () => {
    const s = setup();
    s.photos.session.add([png('a.png'), png('b.png')]);
    void s.photos.submit(s.save);
    await s.saved('c1');
    s.photos.reset();
    await s.answer();
    expect(s.sent).toHaveLength(1);
    expect(s.photos.phase).toBe('editing');
    expect(s.onDone).not.toHaveBeenCalled();
  });
});
