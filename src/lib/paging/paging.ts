/**
 * Incremental rendering of card lists. The listings stay fully loaded (offline snapshot, client
 * filtering); only how many cards are rendered grows, and images load as they come near the view.
 */

export const pageSize = 12;

/** How many cards a list shows for one combination of filters. */
export interface Paging {
  key: string;
  limit: number;
}

/** Cards to render: a changed filter key starts again at the first page. */
export function shownCount(paging: Paging, key: string, total: number): number {
  return Math.min(total, paging.key === key ? paging.limit : pageSize);
}

export function nextPage(paging: Paging, key: string, total: number): Paging {
  return { key, limit: shownCount(paging, key, total) + pageSize };
}

/** Where a list was left, kept in its history entry so back navigation returns there. */
export interface ListPosition {
  limit: number;
  scrollY: number;
  /** Where the list started in the document when `scrollY` was taken. */
  top?: number;
  /** href of the focused card link. */
  focus?: string;
}

const stateKey = 'glazelabLists';

export function savedPosition(state: unknown, name: string): ListPosition | null {
  const lists = (state as Record<string, unknown> | null)?.[stateKey] as Record<string, ListPosition> | undefined;
  const position = lists?.[name];
  return position && Number.isFinite(position.limit) && Number.isFinite(position.scrollY) && (position.top === undefined || Number.isFinite(position.top))
    ? position
    : null;
}

/** Where `node` starts in the document, whatever the scroll position. */
export function documentTop(node: Element): number {
  return node.getBoundingClientRect().top + window.scrollY;
}

/**
 * The scroll offset that shows again what the saved one showed. Once the viewport had reached the
 * list, the offset follows the list's start, so the page above it (an intro card now shown or
 * gone, a notice) may differ in height; above the list it stays as it was.
 */
export function restoredScrollY(position: ListPosition, listTop: number): number {
  const shift = position.top !== undefined && position.scrollY >= position.top ? listTop - position.top : 0;
  return position.scrollY + shift;
}

export function withPosition(state: unknown, name: string, position: ListPosition): object {
  const current = state && typeof state === 'object' ? (state as Record<string, unknown>) : {};
  const lists = (current[stateKey] as Record<string, ListPosition> | undefined) ?? {};
  return { ...current, [stateKey]: { ...lists, [name]: position } };
}

/** Grid rows an item of this height covers, where the grid's rows are `unit` pixels high. */
export function rowSpan(height: number, unit: number): number {
  return unit > 0 && height > 0 ? Math.ceil(height / unit) : 1;
}

/**
 * Masonry-style packing for a grid with small fixed rows: keeps `item` spanning exactly its content
 * height, so the next item in DOM order moves into the first free place and no tall neighbour
 * leaves a gap. Measures at once (so scroll restoration sees the final height) and follows size
 * changes. Returns a cleanup.
 */
export function packInRows(item: HTMLElement): () => void {
  const apply = () => {
    const parent = item.parentElement;
    if (!parent) return;
    const unit = parseFloat(getComputedStyle(parent).gridAutoRows);
    item.style.gridRowEnd = `span ${rowSpan(item.offsetHeight, unit)}`;
  };
  apply();
  if (typeof ResizeObserver === 'undefined') return () => {};
  const observer = new ResizeObserver(apply);
  observer.observe(item);
  return () => observer.disconnect();
}

const observers = new Map<string, IntersectionObserver>();
const waiting = new Map<Element, () => void>();

export function canObserve(): boolean {
  return typeof IntersectionObserver !== 'undefined';
}

/**
 * Calls onNear once when node comes within `margin` of the viewport (by default half a screen), or
 * at once where IntersectionObserver is missing. One observer serves every node with the same
 * margin. Returns a cleanup.
 */
export function whenNearView(node: Element, onNear: () => void, margin = '50% 0px'): () => void {
  if (!canObserve()) {
    onNear();
    return () => {};
  }
  let shared = observers.get(margin);
  if (!shared) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const callback = entry.isIntersecting ? waiting.get(entry.target) : undefined;
          if (!callback) continue;
          waiting.delete(entry.target);
          observer.unobserve(entry.target);
          callback();
        }
      },
      { rootMargin: margin },
    );
    observers.set(margin, (shared = observer));
  }
  const current = shared;
  // Observing again delivers a fresh entry, so a node still in view fires again.
  current.unobserve(node);
  waiting.set(node, onNear);
  current.observe(node);
  return () => {
    if (waiting.delete(node)) current.unobserve(node);
  };
}

/**
 * Appends a page of a newest-first offset listing. Entries added after the first page shift the
 * offsets, so a later page may repeat rows already shown; those are skipped, keeping the order.
 */
export function appendPage<T>(rows: T[], entries: T[], keyOf: (row: T) => string): T[] {
  const seen = new Set(rows.map(keyOf));
  return [
    ...rows,
    ...entries.filter((entry) => {
      const key = keyOf(entry);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  ];
}
