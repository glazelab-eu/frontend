import { api } from '../../lib/api/client';
import type { Combination } from '../../lib/api/models';
import type { SyncView } from '../../lib/generated/types.gen';
import { readFirstSync, saveFirstSyncPage, type FirstSync } from '../../lib/offline/snapshots';
import { listingOf, PAGE_SIZE, pointOf, type Listings, type SyncPoint } from '../../lib/sync/sync';
import type { AppContext } from './context';
import type { createSnapshot } from './snapshot';
import { isLoading } from '../../lib/sync/lifecycle';

/** Listings read in full, at the sync point taken before them; `resumed` when saved pages of an earlier load (of any age) are among them. */
type FullListings = Listings & { kind: 'full'; point: SyncPoint; resumed: boolean };
/** What a load reads for the glaze and combination listings: a delta to apply to the listings shown at `base`, or the full listings. */
type Listed = { kind: 'delta'; base: SyncPoint; listings: Listings; answer: SyncView } | FullListings;

/**
 * What a load reads for the glaze and combination listings (`listingsOf`) and the full read with its saved pages (`fullListings`), as
 * functions of the account and the load's version (`ticket`). The load keeps what it does with them (`settle`, the `touched` re-ask
 * and the patch that shows them) in one unit of its own.
 */
export function createListingSync(
  ctx: Pick<AppContext, 'read' | 'step' | 'storage' | 'ticket'>,
  { snapshot }: { snapshot: ReturnType<typeof createSnapshot> },
) {
  const { ownerOf } = snapshot;

  /**
   * The glaze and combination listings of a load. An unfinished paged load of this account continues where it stopped;
   * shown listings with a sync point ask for the changes since it; anything else (no point, or a resync answer) loads in
   * full from the sync answer's own start point, which the server took before the listings are read.
   */
  async function listingsOf(userId: string | null | undefined, version: number): Promise<Listed | null> {
    const resumed = await ctx.storage(() => readFirstSync(userId));
    if (!ctx.ticket.isCurrent(version)) return null;
    const owner = ownerOf(userId);
    // Pages of the load whose listings are already shown (only their snapshot failed to save) are older than the state: skip them.
    // (Pages that are older still, after a delta whose snapshot failed to save too, are resumed and then caught up by the load's follow-up delta.)
    const shownAlready = !isLoading(ctx.read().sync) && snapshot.synced?.owner === owner && snapshot.synced.point?.cursor === resumed?.progress.point.cursor;
    if (resumed && !shownAlready) return fullListings(userId, resumed.progress.point, resumed.progress.total, version, resumed);
    const base = !isLoading(ctx.read().sync) && snapshot.synced?.owner === owner ? snapshot.synced.point : null;
    // The listings at `base`, as the request leaves: the delta applies to them, not to writes patched in while it travels.
    const listings = { glazes: ctx.read().glazes, combinations: ctx.read().combinations };
    const answer = await api.sync(base ?? undefined);
    if (!ctx.ticket.isCurrent(version)) return null;
    if (base && !answer.resync) return { kind: 'delta', base, listings, answer };
    return fullListings(userId, pointOf(answer), answer.visibleCombinations, version);
  }

  /**
   * Reads the listings in full: the glazes in one request, the combinations in pages by ID, each page saved with the
   * progress as it arrives, so a dropped connection or a reload continues after the last saved page (`resumed`). While
   * nothing is shown, the loading state counts the combinations (the `progress` event). Null when a newer load took over.
   */
  async function fullListings(
    userId: string | null | undefined,
    start: SyncPoint,
    total: number,
    version: number,
    resumed?: { progress: FirstSync; combinations: Combination[] },
  ): Promise<FullListings | null> {
    const glazesRead = api.glazes();
    // Awaited after the pages; a failure there must not surface as unhandled while they load.
    glazesRead.catch(() => {});
    let progress: FirstSync = resumed?.progress ?? { point: start, total, next: null, pages: 0 };
    const combinations = resumed?.combinations ?? [];
    let saving = true;
    // Counts only while nothing is shown (`progress` changes nothing otherwise) and only for the newest load (`step`).
    const show = () => ctx.step(version, { type: 'progress', progress: { done: combinations.length, total: Math.max(progress.total, combinations.length) } });
    show();
    while (progress.pages === 0 || progress.next !== null) {
      const page = await api.combinationPage(progress.next, PAGE_SIZE);
      if (!ctx.ticket.isCurrent(version)) return null;
      combinations.push(...page.combinations);
      progress = { ...progress, next: page.next, pages: progress.pages + 1 };
      const saved = progress;
      // One failed save ends saving for this load: a later page alone could not be resumed from.
      if (saving) saving = (await ctx.storage(() => saveFirstSyncPage(userId, saved, saved.pages - 1, page.combinations).then(() => true))) ?? false;
      if (!ctx.ticket.isCurrent(version)) return null;
      show();
    }
    const glazes = await glazesRead;
    return { kind: 'full', glazes, combinations: listingOf(combinations), point: progress.point, resumed: !!resumed };
  }

  return { listingsOf, fullListings };
}
