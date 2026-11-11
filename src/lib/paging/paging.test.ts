import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendPage, nextPage, packInRows, pageSize, restoredScrollY, rowSpan, savedPosition, shownCount, withPosition } from './paging';

describe('row packing', () => {
  it('spans the rows an item covers, rounding up', () => {
    expect(rowSpan(80, 4)).toBe(20);
    expect(rowSpan(81, 4)).toBe(21);
    expect(rowSpan(0, 4)).toBe(1);
    expect(rowSpan(80, 0)).toBe(1);
  });

  it('sets the span of an item from its height and follows resizes', () => {
    let height = 42;
    const item = {
      parentElement: {},
      style: { gridRowEnd: '' },
      get offsetHeight() {
        return height;
      },
    } as unknown as HTMLElement;
    let resize: () => void = () => {};
    vi.stubGlobal('getComputedStyle', () => ({ gridAutoRows: '4px' }));
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const stop = packInRows(item);
    expect(item.style.gridRowEnd).toBe('span 11');
    height = 100;
    resize();
    expect(item.style.gridRowEnd).toBe('span 25');
    stop();
    vi.unstubAllGlobals();
  });

  it('observes the item for size changes and stops observing on cleanup', () => {
    const log: string[] = [];
    const item = { parentElement: null, style: { gridRowEnd: '' } } as unknown as HTMLElement;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(node: unknown) {
          log.push(node === item ? 'observe item' : 'observe other');
        }
        disconnect() {
          log.push('disconnect');
        }
      },
    );
    const stop = packInRows(item);
    expect(log).toEqual(['observe item']);
    stop();
    expect(log).toEqual(['observe item', 'disconnect']);
    vi.unstubAllGlobals();
  });
});

describe('paging', () => {
  it('shows one page at first and never more than the list', () => {
    expect(shownCount({ key: 'a', limit: pageSize }, 'a', 80)).toBe(pageSize);
    expect(shownCount({ key: 'a', limit: pageSize }, 'a', 5)).toBe(5);
  });

  it('grows by a page per step', () => {
    const second = nextPage({ key: 'a', limit: pageSize }, 'a', 80);
    expect(second).toEqual({ key: 'a', limit: 2 * pageSize });
    expect(shownCount(nextPage(second, 'a', 80), 'a', 80)).toBe(3 * pageSize);
    expect(shownCount(nextPage(second, 'a', 30), 'a', 30)).toBe(30);
  });

  it('starts again at the first page when the filters change', () => {
    const paging = { key: 'all', limit: 5 * pageSize };
    expect(shownCount(paging, 'favorites', 80)).toBe(pageSize);
    expect(nextPage(paging, 'favorites', 80)).toEqual({ key: 'favorites', limit: 2 * pageSize });
  });
});

describe('list positions in history state', () => {
  it('keeps other state and other lists', () => {
    const state = withPosition({ other: 1 }, 'glazes', { limit: 24, scrollY: 900 });
    const both = withPosition(state, 'combinations', { limit: 36, scrollY: 50, focus: '#/x' });
    expect(both).toMatchObject({ other: 1 });
    expect(savedPosition(both, 'glazes')).toEqual({ limit: 24, scrollY: 900 });
    expect(savedPosition(both, 'combinations')).toEqual({ limit: 36, scrollY: 50, focus: '#/x' });
  });

  it('keeps where the list started and ignores a malformed start', () => {
    const state = withPosition(null, 'glazes', { limit: 24, scrollY: 900, top: 600 });
    expect(savedPosition(state, 'glazes')).toEqual({ limit: 24, scrollY: 900, top: 600 });
    expect(savedPosition(withPosition(null, 'glazes', { limit: 24, scrollY: 9, top: NaN }), 'glazes')).toBeNull();
  });

  it('ignores a missing or malformed entry', () => {
    expect(savedPosition(null, 'glazes')).toBeNull();
    expect(savedPosition({}, 'glazes')).toBeNull();
    expect(savedPosition({ glazelabLists: { glazes: { limit: 'x' } } }, 'glazes')).toBeNull();
    expect(withPosition(null, 'glazes', { limit: 12, scrollY: 0 })).toEqual({
      glazelabLists: { glazes: { limit: 12, scrollY: 0 } },
    });
  });
});

describe('restored scroll offset', () => {
  const saved = { limit: 48, scrollY: 2500, top: 669 };

  it('is the saved offset while the page above the list is unchanged', () => {
    expect(restoredScrollY(saved, 669)).toBe(2500);
  });

  it('follows the list when the page above it is taller or shorter now', () => {
    expect(restoredScrollY(saved, 513)).toBe(2344);
    expect(restoredScrollY(saved, 825)).toBe(2656);
  });

  it('keeps an offset above the list, and entries without a start, as saved', () => {
    expect(restoredScrollY({ limit: 12, scrollY: 300, top: 669 }, 825)).toBe(300);
    expect(restoredScrollY({ limit: 12, scrollY: 669, top: 669 }, 825)).toBe(825);
    expect(restoredScrollY({ limit: 48, scrollY: 2500 }, 825)).toBe(2500);
  });
});

describe('whenNearView', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('runs at once without IntersectionObserver', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const { canObserve, whenNearView } = await import('./paging');
    const onNear = vi.fn();
    whenNearView({} as Element, onNear);
    expect(canObserve()).toBe(false);
    expect(onNear).toHaveBeenCalledOnce();
  });

  it('shares one observer and fires once per node when it comes near', async () => {
    const observers: FakeObserver[] = [];
    class FakeObserver {
      observed = new Set<Element>();
      constructor(
        public callback: (entries: Partial<IntersectionObserverEntry>[]) => void,
        public options: IntersectionObserverInit,
      ) {
        observers.push(this);
      }
      observe(node: Element) {
        this.observed.add(node);
      }
      unobserve(node: Element) {
        this.observed.delete(node);
      }
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const { whenNearView } = await import('./paging');
    const [a, b] = [{} as Element, {} as Element];
    const nearA = vi.fn();
    const nearB = vi.fn();
    whenNearView(a, nearA);
    const stopB = whenNearView(b, nearB);
    expect(observers).toHaveLength(1);
    expect(observers[0].options.rootMargin).toBe('50% 0px');
    const observer = observers[0];

    observer.callback([{ target: a, isIntersecting: false }]);
    expect(nearA).not.toHaveBeenCalled();
    observer.callback([{ target: a, isIntersecting: true }]);
    observer.callback([{ target: a, isIntersecting: true }]);
    expect(nearA).toHaveBeenCalledOnce();
    expect(observer.observed.has(a)).toBe(false);

    stopB();
    expect(observer.observed.has(b)).toBe(false);
    observer.callback([{ target: b, isIntersecting: true }]);
    expect(nearB).not.toHaveBeenCalled();

    // Re-arming a node (the list sentinel after each page) observes it again.
    whenNearView(a, nearA);
    expect(observer.observed.has(a)).toBe(true);
    observer.callback([{ target: a, isIntersecting: true }]);
    expect(nearA).toHaveBeenCalledTimes(2);

    // Another margin gets its own observer.
    whenNearView(b, nearB, '200% 0px');
    expect(observers).toHaveLength(2);
    expect(observers[1].options.rootMargin).toBe('200% 0px');
    expect(observers[1].observed.has(b)).toBe(true);
  });

  it('observes a node afresh each time it is armed, so one still in view fires again', async () => {
    const log: string[] = [];
    class FakeObserver {
      observe() {
        log.push('observe');
      }
      unobserve() {
        log.push('unobserve');
      }
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const { whenNearView } = await import('./paging');
    const sentinel = {} as Element;
    whenNearView(sentinel, vi.fn());
    log.length = 0;
    whenNearView(sentinel, vi.fn());
    expect(log).toEqual(['unobserve', 'observe']);
  });
});

describe('appendPage', () => {
  const keyOf = (row: { id: string }) => row.id;
  // A newest-first offset listing like GET /api/admin/image-deletions (pages of 50).
  const log = Array.from({ length: 120 }, (_, i) => ({ id: `d${120 - i}` }));
  const serve = (page: number) => ({
    entries: log.slice(page * 50, page * 50 + 50),
    hasMore: log.length > page * 50 + 50,
  });

  it('keeps every row once when a newer entry shifts the next page', () => {
    let rows = appendPage([], serve(0).entries, keyOf);
    expect(rows).toHaveLength(50);
    log.unshift({ id: 'd121' });
    const second = serve(1);
    expect(second.entries[0]).toEqual(rows[49]);
    rows = appendPage(rows, second.entries, keyOf);
    const third = serve(2);
    rows = appendPage(rows, third.entries, keyOf);
    expect(third.hasMore).toBe(false);
    expect(new Set(rows.map(keyOf)).size).toBe(rows.length);
    expect(rows.map(keyOf)).toEqual(Array.from({ length: 120 }, (_, i) => `d${120 - i}`));
  });

  it('skips repeats within one page and keeps an empty overlap page harmless', () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    expect(appendPage(rows, [{ id: 'b' }, { id: 'c' }, { id: 'c' }], keyOf)).toEqual([...rows, { id: 'c' }]);
    expect(appendPage(rows, rows, keyOf)).toEqual(rows);
  });
});
