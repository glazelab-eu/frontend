import { describe, expect, it } from 'vitest';
import { withNewImage } from '../../state/app/app-state';
import { combination, glaze, imageInfo } from '../../test/fixtures';
import { explore, isWaiting } from '../explore/explore';
import { buildTagIndex } from '../tags/tags';
import { WAITING_LIMIT, focusAfterRow, waitingList } from './waiting';

const own = (id: string, overrides: Parameters<typeof combination>[0] = {}) => combination({ id, title: id, own: true, ...overrides });
const ids = (list: { items: { id: string }[] }) => list.items.map((item) => item.id);

describe('waitingList', () => {
  it('includes shared glazes without result photos, newest first, with glaze upload targets', () => {
    const glazes = [
      glaze({ id: 'empty', createdAt: '2026-11-01T00:00:00Z' }),
      glaze({ id: 'jar', images: [imageInfo({ kind: 'PACKAGING' })], createdAt: '2026-10-01T00:00:00Z' }),
      glaze({ id: 'tile', images: [imageInfo({ kind: 'TEST_TILE' })] }),
      glaze({ id: 'piece', images: [imageInfo({ kind: 'FINISHED' })] }),
    ];
    const list = waitingList([own('combination', { createdAt: '2026-10-15T00:00:00Z' })], true, 5, glazes);
    expect(list.items.map(({ type, id }) => `${type}:${id}`)).toEqual(['glaze:empty', 'combination:combination', 'glaze:jar']);
    expect(list.total).toBe(3);
    expect(waitingList([], false, 5, glazes).total).toBe(0);
  });
  it('lists the own published combinations without a result photo, and only those', () => {
    const list = waitingList(
      [
        own('none'),
        own('tile', { images: [imageInfo({ kind: 'TEST_TILE' })] }),
        own('finished', { images: [imageInfo({ kind: 'FINISHED' })] }),
        // A packaging photo shows no result: the combination still waits (Explore's rule).
        own('packaging', { images: [imageInfo({ kind: 'PACKAGING' })] }),
        combination({ id: 'theirs', own: false }),
        own('draft', { draft: true }),
      ],
      true,
    );
    expect(ids(list).sort()).toEqual(['none', 'packaging']);
    expect(list.total).toBe(2);
  });

  it('is exactly what Explore counts as waiting', () => {
    const all = [own('a'), own('b', { draft: true }), own('c', { images: [imageInfo()] }), combination({ id: 'd' })];
    expect(ids(waitingList(all, true)).sort()).toEqual(all.filter(isWaiting).map((c) => c.id));
  });

  it('is empty for a guest (nothing is own), for nothing waiting and while offline', () => {
    expect(waitingList([combination({ id: 'x' }), combination({ id: 'y' })], true)).toEqual({
      items: [],
      total: 0,
    });
    expect(waitingList([own('a', { images: [imageInfo()] })], true)).toEqual({
      items: [],
      total: 0,
    });
    expect(waitingList([], true)).toEqual({ items: [], total: 0 });
    expect(waitingList([own('a'), own('b')], false)).toEqual({ items: [], total: 0 });
  });

  it('shows the newest five and counts all of them', () => {
    const seven = Array.from({ length: 7 }, (_, index) => own(`c${index}`, { createdAt: `2026-10-0${index + 1}T10:00:00Z` }));
    const list = waitingList(seven, true);
    expect(WAITING_LIMIT).toBe(5);
    expect(ids(list)).toEqual(['c6', 'c5', 'c4', 'c3', 'c2']);
    expect(list.total).toBe(7);
    expect(waitingList(seven, true, 2).items).toHaveLength(2);
    const five = waitingList(seven.slice(0, 5), true);
    expect(five.items).toHaveLength(5);
    expect(five.total).toBe(5);
  });

  it('orders by publication, else creation, as Explore does', () => {
    const list = waitingList(
      [
        // Created first, published last: newest.
        own('late-published', {
          createdAt: '2026-01-01T00:00:00Z',
          publishedAt: '2026-10-20T00:00:00Z',
        }),
        own('recent', { createdAt: '2026-10-10T00:00:00Z' }),
        own('old-published', {
          createdAt: '2026-10-15T00:00:00Z',
          publishedAt: '2026-02-01T00:00:00Z',
        }),
        own('unknown', { createdAt: '', publishedAt: null }),
      ],
      true,
    );
    expect(ids(list)).toEqual(['late-published', 'recent', 'old-published', 'unknown']);
  });

  it('drops a combination once its uploaded photo is patched in, and keeps it without one', () => {
    const state = { glazes: [], combinations: [own('a'), own('b'), own('c')] };
    expect(ids(waitingList(state.combinations, true))).toEqual(['a', 'b', 'c']);
    const patched = withNewImage(state, { type: 'combination', id: 'b' }, imageInfo({ id: 'new' }));
    expect(ids(waitingList(patched.combinations, true))).toEqual(['a', 'c']);
    // A failed upload patches nothing.
    expect(ids(waitingList(state.combinations, true))).toEqual(['a', 'b', 'c']);
  });

  it('lets the next combination take the place of one that left a full list', () => {
    const seven = Array.from({ length: 7 }, (_, index) => own(`c${index}`, { createdAt: `2026-10-0${index + 1}T10:00:00Z` }));
    const patched = withNewImage({ glazes: [], combinations: seven }, { type: 'combination', id: 'c6' }, imageInfo({ id: 'new' }));
    const list = waitingList(patched.combinations, true);
    expect(ids(list)).toEqual(['c5', 'c4', 'c3', 'c2', 'c1']);
    expect(list.total).toBe(6);
  });

  it('counts and lists what the "See all" link (Explore\'s Waiting for photos) shows', () => {
    const all = [
      ...Array.from({ length: 7 }, (_, index) => own(`w${index}`, { createdAt: `2026-10-0${index + 1}T10:00:00Z` })),
      own('packaging', { images: [imageInfo({ kind: 'PACKAGING' })] }),
      own('by-someone-else', { images: [imageInfo({ kind: 'FINISHED', own: false })] }),
      own('private-tile', { images: [imageInfo({ kind: 'TEST_TILE', visibility: 'PRIVATE' })] }),
      own('draft', { draft: true }),
      combination({ id: 'theirs', own: false }),
    ];
    const listed = explore({
      glazes: [],
      combinations: all,
      glazeIndex: buildTagIndex([]),
      combinationIndex: buildTagIndex(all),
      filters: { quick: 'waiting' },
      favorites: { glazeIds: [], combinationIds: [] },
      stock: [],
    }).items.map((entry) => entry.item.id);
    const list = waitingList(all, true);
    expect(list.total).toBe(listed.length);
    expect(listed.slice(0, list.items.length)).toEqual(ids(list));
    expect([...listed].sort()).toEqual(['packaging', 'w0', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6'].sort());
  });
});

describe('focusAfterRow', () => {
  it('takes the row now at the place of the one that left, the last one when it was the last', () => {
    expect(focusAfterRow(0, 4, 4)).toEqual({ to: 'row', index: 0 });
    expect(focusAfterRow(2, 4, 4)).toEqual({ to: 'row', index: 2 });
    expect(focusAfterRow(4, 4, 4)).toEqual({ to: 'row', index: 3 });
  });

  it('takes the toggle while the rows are folded away, and the title once none is left', () => {
    expect(focusAfterRow(1, 0, 3)).toEqual({ to: 'fold' });
    expect(focusAfterRow(0, 0, 0)).toEqual({ to: 'title' });
  });
});
