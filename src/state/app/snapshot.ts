import { avatarIdsConfirmed } from '../../lib/offline/offline';
import { readSaved, saveSnapshot, saveSyncPoint } from '../../lib/offline/snapshots';
import type { SyncPoint } from '../../lib/sync/sync';
import type { Combination, Glaze, Snapshot } from '../../lib/api/models';
import { availabilityDay, ofAcceptedBuddies } from '../../lib/stock/buddy-shelf';
import type { AppContext } from './context';
import { isLoading } from '../../lib/sync/lifecycle';

/**
 * The offline snapshot of the shown data: saving it (`persist`, `saveCurrent`), showing it while nothing of the account is shown
 * (`restore`), and the memory of what the device holds. Owns the sync point of the shown listings (`synced`, which a finished load
 * sets) and the memory of the saved snapshot (`persisted`); both are dropped on an account change (`onAccountChange`), since they
 * belong to the previous account's listings.
 */
export function createSnapshot(ctx: Pick<AppContext, 'read' | 'step' | 'stale' | 'storage' | 'ticket' | 'onAccountChange'>) {
  /** Whose listings a sync point or snapshot belongs to: the account ID, or the guest. */
  const ownerOf = (userId: string | null | undefined) => userId || 'guest';
  /** The sync point of the shown listings and their owner; null until a snapshot or load showed them (reset with the account). */
  let synced: { owner: string; point: SyncPoint | null } | null = null;
  /**
   * What the snapshot on the device holds: the listings by identity, the rest as JSON and the sync point it was saved
   * at, so a delta that changed none of it moves only the sync point instead of writing the whole library again.
   * Null when unknown.
   */
  let persisted: { owner: string; glazes: Glaze[]; combinations: Combination[]; rest: string; point: SyncPoint | null } | null = null;
  // The sync point and the saved-snapshot memory belong to the previous account's listings.
  ctx.onAccountChange(() => {
    synced = null;
    persisted = null;
  });

  // The availability's time counts by day: an unchanged availability read again today moves only the sync point, so an open does not rewrite the library.
  const restOf = (data: Snapshot) =>
    JSON.stringify([
      data.stock,
      data.clubs,
      data.clubMembers,
      data.buddies,
      data.buddyAvailability.glazes,
      availabilityDay(data.buddyAvailability),
      data.authorAvatars,
      data.favorites,
      data.favoriteCounts,
    ]);

  /**
   * Saves the snapshot of `userId` with the sync point its listings are at. When this tab saved exactly these listings
   * and the rest is unchanged, only the point moves (`saveSyncPoint` checks in the same transaction that no other tab
   * saved since). `loaded` (a finished load) drops any pages of a paged load in the same transaction: the listings
   * are at least as new as they are. Answers whether it was saved.
   */
  async function persist(userId: string | null | undefined, shown: Snapshot, point: SyncPoint | null, loaded = false): Promise<boolean> {
    // Never a removed buddy's name and glazes on the device, even when the availability could not be read again after the removal.
    const data = { ...shown, buddyAvailability: ofAcceptedBuddies(shown.buddyAvailability, shown.buddies) };
    const owner = ownerOf(userId);
    const rest = restOf(data);
    const known = persisted;
    const unchanged = known?.owner === owner && known.glazes === data.glazes && known.combinations === data.combinations && known.rest === rest;
    const done = await ctx.storage(async () => {
      if (unchanged && point && known.point) await saveSyncPoint(userId, known.point, point, data, loaded);
      else await saveSnapshot(userId, data, point, loaded);
      return true;
    });
    persisted = done ? { owner, glazes: data.glazes, combinations: data.combinations, rest, point } : null;
    return !!done;
  }

  /**
   * Shows the saved snapshot of `userId` while nothing of that account is shown yet (the instant start, and the saved
   * data after a failed load), with its sync point. Loading ends with the data: cards that wait for it (guest welcome,
   * intro) must appear in the list's own render. Never shows it for another account than the signed-in one. `continues`: the
   * load goes on over the snapshot (it shows refreshing in the same patch, so no update sees it settled), else it ends with it.
   */
  async function restore(userId: string | null | undefined, version: number, continues: boolean) {
    if (!isLoading(ctx.read().sync)) return;
    const saved = await ctx.storage(() => readSaved(userId));
    if (!saved || !ctx.ticket.isCurrent(version) || !isLoading(ctx.read().sync) || ownerOf(ctx.read().user?.id) !== ownerOf(userId)) return;
    const owner = ownerOf(userId);
    // Its profile picture IDs may name pictures replaced elsewhere: only saved copies show until a load confirmed them.
    avatarIdsConfirmed.set(false);
    ctx.step(version, { type: 'restored', continues }, saved.snapshot);
    synced = { owner, point: saved.point };
    persisted = { owner, glazes: saved.snapshot.glazes, combinations: saved.snapshot.combinations, rest: restOf(saved.snapshot), point: saved.point };
  }

  /** Saves the shown data as the account's offline snapshot after a small in-place change. */
  async function saveCurrent(actor: string | undefined) {
    // While nothing of the account is shown (a first load runs), the listings are not its own yet.
    if (!actor || ctx.stale(actor) || isLoading(ctx.read().sync)) return;
    const { glazes, combinations, stock, clubs, clubMembers, buddies, buddyAvailability, authorAvatars, favorites, favoriteCounts } = ctx.read();
    await persist(
      actor,
      { glazes, combinations, stock, clubs, clubMembers, buddies, buddyAvailability, authorAvatars, favorites, favoriteCounts },
      synced?.owner === ownerOf(actor) ? synced.point : null,
    );
  }

  return {
    ownerOf,
    persist,
    restore,
    saveCurrent,
    /** The sync point of the shown listings and their owner (`synced` above): the load reads it and sets it when it finished. */
    get synced() {
      return synced;
    },
    set synced(value: { owner: string; point: SyncPoint | null } | null) {
      synced = value;
    },
  };
}
