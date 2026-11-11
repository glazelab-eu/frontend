import type { Combination, Glaze, UploadTarget } from '../api/models';
import { glazeTitle } from '../glazes/glazes';
import { isWaiting, isWaitingGlaze } from '../explore/explore';
import { newestFirst } from '../explore/listing';

/** How many waiting items Studio lists; Explore's "Waiting for photos" view has the rest. */
export const WAITING_LIMIT = 5;

type WaitingCombination = Pick<Combination, 'id' | 'title' | 'own' | 'images'> & {
  draft?: boolean;
  createdAt?: string | null;
  publishedAt?: string | null;
};

export interface WaitingList {
  /** The newest `limit` glazes and combinations waiting for a photo. */
  items: (UploadTarget & { createdAt?: string | null; publishedAt?: string | null })[];
  /** All items waiting, listed or not. */
  total: number;
}

/**
 * Shared glazes and the signed-in account's own published combinations without a visible result photo (Explore's `waiting`
 * rule, `isWaiting`: never drafts), newest first as in Explore's "Newest" order, cut to
 * `limit`. Offline the list is empty: adding a photo needs the connection.
 */
export function waitingList(combinations: readonly WaitingCombination[], online: boolean, limit = WAITING_LIMIT, glazes: readonly Glaze[] = []): WaitingList {
  if (!online) return { items: [], total: 0 };
  const waiting: WaitingList['items'] = [
    ...combinations
      .filter(isWaiting)
      .map((item) => ({ type: 'combination' as const, id: item.id, title: item.title, createdAt: item.createdAt, publishedAt: item.publishedAt })),
    ...glazes.filter(isWaitingGlaze).map((item) => ({ type: 'glaze' as const, id: item.id, title: glazeTitle(item), createdAt: item.createdAt })),
  ];
  waiting.sort(newestFirst);
  return { items: waiting.slice(0, limit), total: waiting.length };
}

/** Where focus goes once the upload dialog has closed and the row that opened it left: the row now at its place, else the folded list's toggle, else the page's title. */
export type FocusAfterRow = { to: 'row'; index: number } | { to: 'fold' } | { to: 'title' };

/** `rowButtons` are the rows in the page, `rows` the ones listed (they differ while the window is narrow and the list folded). */
export function focusAfterRow(index: number, rowButtons: number, rows: number): FocusAfterRow {
  if (rowButtons > 0) return { to: 'row', index: Math.min(index, rowButtons - 1) };
  return rows > 0 ? { to: 'fold' } : { to: 'title' };
}
