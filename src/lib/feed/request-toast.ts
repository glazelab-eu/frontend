/**
 * The toast for a new buddy request (FEED-2; frontend guide "Activity feed"): what one answer of the badge poll
 * (`GET /api/feed/unread`) means for it. The server names the newest waiting request addressed to the account that is later than
 * the seen position (`requesterId`, `requesterName`, `requestedAt`) and how many such wait (`requests`); this decides whether the
 * device announces it. Pure: the memory lives in the poll (per account, never in storage).
 */
import type { FeedBadge } from '../api/models';
import type { Route } from '../routing/routes';

/** A shown toast: the newest request's asking account and how many more unseen requests wait. */
export interface RequestToast {
  id: string;
  name: string;
  others: number;
}

/**
 * What the device knows: `ready` once the first answer set the baseline, `through` the time of the newest request known or announced
 * (epoch ms, null with none), so a request is announced at most once and never one from before the baseline.
 */
export interface RequestMemory {
  ready: boolean;
  through: number | null;
}

export const freshRequestMemory = (): RequestMemory => ({ ready: false, through: null });

/** The pages that show the request themselves: the activity page (its "N new") and the buddy link dialog. */
export function requestShownBy(route: Route): boolean {
  return route.name === 'activity' || route.name === 'buddy';
}

/**
 * One poll answer: the next memory and the toast (a new one to show, `null` to close a shown one because nothing unseen waits any more or its request is gone,
 * `undefined` to leave things as they are). An answer without the fields (an API from before FEED-2) changes nothing. The first answer
 * only sets the baseline, except for a request whose asking account the loaded incoming list (`known`) does not hold yet: that one
 * arrived after the load. `quiet` (the page shows it already) records the request without a toast.
 */
export function requestNews(
  memory: RequestMemory,
  badge: Partial<Pick<FeedBadge, 'requesterId' | 'requesterName' | 'requestedAt' | 'requests'>>,
  { known, quiet }: { known: readonly string[]; quiet: boolean },
): { memory: RequestMemory; toast: RequestToast | null | undefined } {
  if (badge.requesterId === undefined) return { memory, toast: undefined };
  const at = badge.requestedAt ? Date.parse(badge.requestedAt) : NaN;
  if (!badge.requesterId || !badge.requesterName || Number.isNaN(at)) return { memory: { ready: true, through: memory.through }, toast: null };
  const toast = { id: badge.requesterId, name: badge.requesterName, others: Math.max((badge.requests ?? 1) - 1, 0) };
  if (!memory.ready) {
    return { memory: { ready: true, through: at }, toast: quiet || known.includes(toast.id) ? undefined : toast };
  }
  // The newest known request still waits: nothing new. An older one is the newest now: the request a shown toast names is gone
  // (withdrawn, answered elsewhere, its account deleted), and the rest were known or counted already, so the toast closes.
  if (memory.through !== null && at === memory.through) return { memory, toast: undefined };
  if (memory.through !== null && at < memory.through) return { memory, toast: null };
  return { memory: { ready: true, through: at }, toast: quiet ? undefined : toast };
}
