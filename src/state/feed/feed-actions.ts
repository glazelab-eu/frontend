import { api } from '../../lib/api/client';
import type { FeedPage, User } from '../../lib/api/models';
import { saveLastUser } from '../../lib/offline/offline';
import type { AppContext } from '../app/context';

/**
 * The activity feed (backend guide "Activity feed"): its pages (online only, page memory, never in the snapshot), the seen position and
 * the two sources. The badge's count is `User.feedUnread`, which every load reads with `/me`; these actions only keep it current after a
 * look or a switch, and save the account so an offline start shows the same badge.
 */
export function createFeedActions(ctx: Pick<AppContext, 'read' | 'patch' | 'stale' | 'mutate' | 'query' | 'storage'>) {
  async function setUser(change: Partial<User>, actor: string | undefined) {
    const user = ctx.read().user;
    if (!user || ctx.stale(actor)) return;
    const updated = { ...user, ...change };
    ctx.patch({ user: updated });
    await ctx.storage(() => saveLastUser(updated));
  }

  /** One page, newest first; null after a failure (shown at the page's form) or an account change. */
  function loadFeed(before?: string): Promise<FeedPage | null> {
    return ctx.query(() => api.feed(before), 'feed');
  }

  /**
   * The page showed entries up to `through`: the server moves the seen position (never back) and the badge goes. Never awaited by the
   * page and silent on failure: the badge then stays until the next look.
   */
  async function markFeedSeen(through: string): Promise<boolean> {
    const actor = ctx.read().user?.id;
    if (!actor) return false;
    try {
      await api.markFeedSeen(through);
    } catch {
      return false;
    }
    await setUser({ feedUnread: 0 }, actor);
    return true;
  }

  /** The account's two sources, for every device; the badge is read again with the new choice. */
  function chooseFeed(buddies: boolean, clubs: boolean) {
    return ctx.mutate({
      request: async () => {
        await api.chooseFeed(buddies, clubs);
        return api.me().catch(() => null);
      },
      apply: async (fresh, actor) => {
        const unread = fresh && fresh.id === actor ? { feedUnread: fresh.feedUnread } : {};
        await setUser({ feedBuddies: buddies, feedClubs: clubs, ...unread }, actor);
      },
      notice: 'notices.feedSaved',
      form: 'feed-settings',
      requireOnline: true,
      busy: 'feed-settings',
    });
  }

  /** Closes the new-request toast (FEED-2): Dismiss, Escape or its Answer button. */
  function dismissRequestToast() {
    if (ctx.read().requestToast) ctx.patch({ requestToast: null });
  }

  return { loadFeed, markFeedSeen, chooseFeed, dismissRequestToast };
}
