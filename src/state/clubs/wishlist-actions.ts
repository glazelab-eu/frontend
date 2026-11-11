import { ApiError, api } from '../../lib/api/client';
import type { ClubWishlist } from '../../lib/api/models';
import type { WishlistInput } from '../../lib/api/inputs';
import { withWishlistEntry } from '../../lib/clubs/wishlist';
import type { AppContext } from '../app/context';

/** Statuses after which the shown wishlist is read again before the refusal shows (an entry gone, the limit, a duplicate, the rights). */
const STALE = [403, 404, 409];

/**
 * A club's wishlist (`AppState.clubWishlists`): read when its club page opens (online only, memory only, never in the snapshot) and
 * patched in place with what each write answers. Writes need a connection; a refusal that means the shown list is stale reads it again
 * before the refusal shows, and a 403 also reloads the clubs (the account may have left the club). Keeps no state of its own: the
 * account change clears `clubWishlists` with the rest of the account data.
 */
export function createWishlistActions(ctx: Pick<AppContext, 'read' | 'patch' | 'stale' | 'query' | 'mutate' | 'mutateFor'>) {
  /** Stores a club's list unless the account changed or left the club meanwhile. */
  function store(clubId: string, list: ClubWishlist, actor: string | undefined) {
    if (ctx.stale(actor) || !ctx.read().clubs.some((club) => club.id === clubId)) return;
    ctx.patch({ clubWishlists: { ...ctx.read().clubWishlists, [clubId]: list } });
  }

  function update(clubId: string, change: (list: ClubWishlist) => ClubWishlist) {
    const list = ctx.read().clubWishlists[clubId];
    if (list) ctx.patch({ clubWishlists: { ...ctx.read().clubWishlists, [clubId]: change(list) } });
  }

  /** Reads the club's wishlist; answers whether it arrived (a failure shows at the section, form `wishlist-load`). */
  async function loadWishlist(clubId: string): Promise<boolean> {
    const actor = ctx.read().user?.id;
    const list = await ctx.query(() => api.clubWishlist(clubId), 'wishlist-load');
    if (!list) return false;
    store(clubId, list, actor);
    return true;
  }

  /** The write; when the API refuses it because the shown list is stale, the list is read again (quietly) before the refusal shows. */
  async function refreshingOnRefusal<T>(clubId: string, request: () => Promise<T>): Promise<T> {
    const actor = ctx.read().user?.id;
    try {
      return await request();
    } catch (error) {
      if (error instanceof ApiError && STALE.includes(error.status)) {
        const list = await api.clubWishlist(clubId).catch(() => null);
        if (list) store(clubId, list, actor);
      }
      throw error;
    }
  }

  /** Adds a glaze or an item; answers whether it was added (the dialog then closes). */
  async function addWishlistEntry(clubId: string, input: WishlistInput): Promise<boolean> {
    const added = await ctx.mutateFor({
      request: () => refreshingOnRefusal(clubId, () => api.addWishlistEntry(clubId, input)),
      apply: async (entry) => {
        update(clubId, (list) => ({ ...list, entries: withWishlistEntry(list.entries, entry) }));
        return true;
      },
      notice: 'notices.wishlistAdded',
      form: 'wishlist-add',
      requireOnline: true,
      reloadOn: [403],
      busy: `wishlist-add:${clubId}`,
    });
    return added === true;
  }

  /** Removes an entry (its adder or a club admin); the failure shows at the wishlist (form `wishlist-remove`). */
  function removeWishlistEntry(clubId: string, entryId: string): Promise<boolean> {
    return ctx.mutate({
      request: () => refreshingOnRefusal(clubId, () => api.removeWishlistEntry(clubId, entryId)),
      apply: async () => update(clubId, (list) => ({ ...list, entries: list.entries.filter((entry) => entry.id !== entryId) })),
      notice: 'notices.wishlistRemoved',
      form: 'wishlist-remove',
      requireOnline: true,
      reloadOn: [403],
      busy: `wishlist-entry:${entryId}`,
    });
  }

  /** Marks an entry acquired, or wanted again; the list takes the answered entry (form `wishlist-acquired`). */
  function setWishlistAcquired(clubId: string, entryId: string, acquired: boolean): Promise<boolean> {
    return ctx.mutate({
      request: () => refreshingOnRefusal(clubId, () => api.setWishlistAcquired(clubId, entryId, acquired)),
      apply: async (entry) => update(clubId, (list) => ({ ...list, entries: withWishlistEntry(list.entries, entry) })),
      notice: acquired ? 'notices.wishlistAcquired' : 'notices.wishlistWanted',
      form: 'wishlist-acquired',
      requireOnline: true,
      reloadOn: [403],
      busy: `wishlist-entry:${entryId}`,
    });
  }

  return { loadWishlist, addWishlistEntry, removeWishlistEntry, setWishlistAcquired };
}
