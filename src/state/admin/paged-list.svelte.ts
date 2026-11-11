import { appendPage } from '../../lib/paging/paging';

export interface ListPage<T> {
  entries: T[];
  hasMore: boolean;
}

interface Options<T> {
  request: (page: number) => Promise<ListPage<T> | null>;
  key: (row: T) => string;
  /** Mutable offset queues derive the next page from the remaining rows; logs advance by page. */
  nextPage?: (shown: number) => number;
}

/**
 * Page-owned server listing. The host resets it when the account, connectivity or filters change
 * and invalidates it on effect cleanup. Errors stay with the controller's query/form lifecycle.
 * Nothing is cached or shared between pages. Callbacks are read at request time.
 */
export function createPagedList<T>({ request, key, nextPage }: Options<T>) {
  let rows = $state<T[]>([]);
  let hasMore = $state(false);
  let busy = $state(false);
  let loaded = $state(false);
  let failedPage = $state<number | null>(null);
  let page = $state(-1);
  let version = 0;

  function invalidate() {
    version++;
  }

  function reset() {
    invalidate();
    rows = [];
    hasMore = false;
    busy = false;
    loaded = false;
    failedPage = null;
    page = -1;
  }

  async function load(next: number) {
    const started = ++version;
    busy = true;
    failedPage = null;
    try {
      const result = await request(next);
      if (started !== version) return;
      if (result) {
        rows = appendPage(next === 0 ? [] : rows, result.entries, key);
        hasMore = result.hasMore;
        page = next;
        loaded = true;
      } else failedPage = next;
    } finally {
      if (started === version) busy = false;
    }
  }

  return {
    get rows() {
      return rows;
    },
    set rows(value: T[]) {
      rows = value;
    },
    get hasMore() {
      return hasMore;
    },
    get busy() {
      return busy;
    },
    get loaded() {
      return loaded;
    },
    get loadFailed() {
      return failedPage !== null;
    },
    get nextPage() {
      return nextPage ? nextPage(rows.length) : (failedPage ?? page + 1);
    },
    /** Capture before a mutation; ignore its page-local result after a reload or cleanup. */
    current() {
      const started = version;
      return () => started === version;
    },
    load,
    reset,
    invalidate,
  };
}
