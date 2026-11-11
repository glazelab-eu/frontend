import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { createPagedList, type ListPage } from './paged-list.svelte';
import { nextReportPage } from '../../lib/admin/image-reports';
import type { Glaze } from '../../lib/api/models';
import { glaze } from '../../test/fixtures';

const entry = (id: string) => glaze({ id });
const page = (...ids: string[]): ListPage<Glaze> => ({ entries: ids.map(entry), hasMore: true });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
function setup(nextPage?: (shown: number) => number) {
  const request = vi.fn<(page: number) => Promise<ListPage<Glaze> | null>>();
  const list = createPagedList({ request, key: (row: Glaze) => row.id, nextPage });
  return { list, request, ids: () => list.rows.map((row) => row.id) };
}

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
});

describe('page-owned server listings', () => {
  it('starts empty and distinguishes loading, loaded empty and failed', async () => {
    const { list, request } = setup();
    expect(list.loaded).toBe(false);
    expect(list.nextPage).toBe(0);
    request.mockResolvedValueOnce(null);
    const loading = list.load(0);
    expect(list.busy).toBe(true);
    await loading;
    expect(list.loaded).toBe(false);
    expect(list.loadFailed).toBe(true);
    expect(list.busy).toBe(false);
    request.mockResolvedValueOnce({ entries: [], hasMore: false });
    await list.load(list.nextPage);
    expect(list.loaded).toBe(true);
    expect(list.loadFailed).toBe(false);
    expect(list.hasMore).toBe(false);
  });

  it('appends unique entries in order and replaces the list on a first-page reload', async () => {
    const { list, request, ids } = setup();
    request.mockResolvedValueOnce(page('a', 'b')).mockResolvedValueOnce(page('b', 'c', 'c'));
    await list.load(0);
    await list.load(list.nextPage);
    expect(ids()).toEqual(['a', 'b', 'c']);
    expect(request.mock.calls).toEqual([[0], [1]]);
    request.mockResolvedValueOnce(page('d'));
    await list.load(0);
    expect(ids()).toEqual(['d']);
    expect(list.nextPage).toBe(1);
  });

  it('keeps loaded rows after a failure and retries the exact failed page', async () => {
    const { list, request, ids } = setup();
    request.mockResolvedValueOnce(page('a')).mockResolvedValueOnce(null).mockResolvedValueOnce(page('b'));
    await list.load(0);
    await list.load(list.nextPage);
    expect(ids()).toEqual(['a']);
    expect(list.hasMore).toBe(true);
    expect(list.loaded).toBe(true);
    expect(list.loadFailed).toBe(true);
    expect(list.nextPage).toBe(1);
    const retry = list.load(list.nextPage);
    expect(list.loadFailed).toBe(false);
    await retry;
    expect(ids()).toEqual(['a', 'b']);
    expect(request.mock.calls).toEqual([[0], [1], [1]]);
  });

  it('re-reads the shifted page after deletions from a mutable queue', async () => {
    const { list, request, ids } = setup(nextReportPage);
    const first = Array.from({ length: 50 }, (_, index) => String(index));
    request.mockResolvedValueOnce(page(...first));
    await list.load(0);
    expect(list.nextPage).toBe(1);
    list.rows = list.rows.filter((row) => row.id !== '0');
    expect(list.nextPage).toBe(0);
    request.mockResolvedValueOnce(page(...first.slice(1), '50'));
    await list.load(list.nextPage);
    expect(ids()).toEqual([...first.slice(1), '50']);
    expect(list.nextPage).toBe(1);
  });

  it('deduplicates a partially overlapping later page after a deletion', async () => {
    const { list, request, ids } = setup(nextReportPage);
    request.mockResolvedValueOnce(page(...Array.from({ length: 50 }, (_, i) => String(i))));
    await list.load(0);
    request.mockResolvedValueOnce(page(...Array.from({ length: 50 }, (_, i) => String(i + 50))));
    await list.load(list.nextPage);
    list.rows = list.rows.filter((row) => row.id !== '0');
    expect(list.nextPage).toBe(1);
    request.mockResolvedValueOnce(page(...Array.from({ length: 50 }, (_, i) => String(i + 51))));
    await list.load(list.nextPage);
    expect(ids()).toEqual(Array.from({ length: 100 }, (_, i) => String(i + 1)));
  });

  it('recalculates a mutable queue retry if a dismissal shifted the failed page', async () => {
    const { list, request } = setup(nextReportPage);
    request.mockResolvedValueOnce(page(...Array.from({ length: 50 }, (_, i) => String(i)))).mockResolvedValueOnce(null);
    await list.load(0);
    await list.load(list.nextPage);
    expect(list.loadFailed).toBe(true);
    expect(list.nextPage).toBe(1);
    list.rows = list.rows.slice(1);
    expect(list.nextPage).toBe(0);
    request.mockResolvedValueOnce(page(...Array.from({ length: 50 }, (_, i) => String(i + 1))));
    await list.load(list.nextPage);
    expect(request.mock.calls).toEqual([[0], [1], [0]]);
    expect(list.rows).toHaveLength(50);
  });

  it('supports a different page size for nested lists', async () => {
    const { list, request } = setup((shown) => Math.floor(shown / 20));
    request.mockResolvedValueOnce(page(...Array.from({ length: 20 }, (_, i) => String(i))));
    await list.load(0);
    expect(list.nextPage).toBe(1);
    list.rows = list.rows.slice(1);
    expect(list.nextPage).toBe(0);
  });

  it('ignores a slower old answer after a newer request completes', async () => {
    const { list, request, ids } = setup();
    const old = deferred<ListPage<Glaze> | null>();
    request.mockReturnValueOnce(old.promise).mockResolvedValueOnce(page('new'));
    const pending = list.load(0);
    await list.load(0);
    old.resolve(page('old'));
    await pending;
    expect(ids()).toEqual(['new']);
    expect(list.loadFailed).toBe(false);
  });

  it('does not let an old failure clear the loading flag of a newer request', async () => {
    const { list, request } = setup();
    const old = deferred<ListPage<Glaze> | null>();
    const recent = deferred<ListPage<Glaze> | null>();
    request.mockReturnValueOnce(old.promise).mockReturnValueOnce(recent.promise);
    const first = list.load(0);
    const second = list.load(1);
    old.resolve(null);
    await first;
    expect(list.busy).toBe(true);
    expect(list.loadFailed).toBe(false);
    recent.resolve(page('new'));
    await second;
    expect(list.busy).toBe(false);
  });

  it('clears all list state on reset and drops an answer from the previous account/filter', async () => {
    const { list, request, ids } = setup();
    request.mockResolvedValueOnce(page('private'));
    await list.load(0);
    const old = deferred<ListPage<Glaze> | null>();
    request.mockReturnValueOnce(old.promise);
    const pending = list.load(1);
    list.reset();
    expect(ids()).toEqual([]);
    expect(list.busy).toBe(false);
    expect(list.hasMore).toBe(false);
    expect(list.loaded).toBe(false);
    expect(list.loadFailed).toBe(false);
    expect(list.nextPage).toBe(0);
    old.resolve(page('private-old'));
    await pending;
    expect(ids()).toEqual([]);
  });

  it('invalidates mutation continuations on reload, reset and teardown', async () => {
    const { list, request } = setup();
    const beforeLoad = list.current();
    request.mockResolvedValueOnce(page('a'));
    await list.load(0);
    expect(beforeLoad()).toBe(false);
    const afterLoad = list.current();
    list.rows = [];
    expect(afterLoad()).toBe(true);
    list.reset();
    expect(afterLoad()).toBe(false);
    const beforeTeardown = list.current();
    list.invalidate();
    expect(beforeTeardown()).toBe(false);
  });

  it('releases busy even if a request unexpectedly throws', async () => {
    const { list, request } = setup();
    request.mockRejectedValueOnce(new Error('Unexpected'));
    await expect(list.load(0)).rejects.toThrow('Unexpected');
    expect(list.busy).toBe(false);
  });

  it('follows the host identity and filters without refetching when rows change', async () => {
    let account = $state<{ id: string } | null>({ id: 'admin' });
    let online = $state(true);
    let filter = $state('OPEN');
    let actor = $derived(online ? account?.id : undefined);
    const request = vi.fn(async (_page: number, status: string) => page(status));
    const list = createPagedList({ request: (next) => request(next, filter), key: (row: Glaze) => row.id });
    stop = $effect.root(() => {
      $effect(() => {
        filter;
        list.reset();
        if (actor) void list.load(0);
        return list.invalidate;
      });
    });
    await tick();
    await tick();
    expect(list.rows.map((row) => row.id)).toEqual(['OPEN']);
    list.rows = [];
    account = { id: 'admin' };
    await tick();
    expect(request).toHaveBeenCalledTimes(1);
    filter = 'CLOSED';
    await tick();
    await tick();
    expect(request).toHaveBeenLastCalledWith(0, 'CLOSED');
    expect(list.rows.map((row) => row.id)).toEqual(['CLOSED']);
    online = false;
    await tick();
    expect(list.rows).toEqual([]);
    expect(request).toHaveBeenCalledTimes(2);
    online = true;
    await tick();
    await tick();
    expect(request).toHaveBeenCalledTimes(3);
    account = { id: 'another-admin' };
    await tick();
    await tick();
    expect(request).toHaveBeenCalledTimes(4);
    account = null;
    await tick();
    expect(list.rows).toEqual([]);
    expect(request).toHaveBeenCalledTimes(4);
  });

  it('drops pending responses when its host effect is destroyed', async () => {
    const { list, request } = setup();
    const result = deferred<ListPage<Glaze> | null>();
    request.mockReturnValueOnce(result.promise);
    let pending!: Promise<void>;
    stop = $effect.root(() => {
      $effect(() => {
        pending = list.load(0);
        return list.invalidate;
      });
    });
    await tick();
    stop();
    result.resolve(page('private'));
    await pending;
    expect(list.rows).toEqual([]);
  });
});
