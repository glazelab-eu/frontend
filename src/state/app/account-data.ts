import { ApiError, api } from '../../lib/api/client';
import type { BuddyAvailability, Club, ClubMember } from '../../lib/api/models';
import type { AppContext } from './context';

/**
 * The account data a load reads in full besides the listings (member lists, buddy availability, authors' profile pictures). The
 * availability and the pictures are a convenience: a failure other than a 401 keeps what is shown.
 */
export function createAccountData(ctx: Pick<AppContext, 'read'>) {
  /**
   * The member list of each club, by club ID. A 403 means the account left that club after the clubs were
   * read: its list is left out (the club page says it is unavailable) instead of failing the whole load.
   */
  async function membersOf(clubs: Club[]): Promise<Record<string, ClubMember[]>> {
    const lists = await Promise.all(
      clubs.map((club) =>
        api.clubMembers(club.id).catch((error: unknown) => {
          if (error instanceof ApiError && error.status === 403) return null;
          throw error;
        }),
      ),
    );
    return Object.fromEntries(clubs.flatMap((club, index) => (lists[index] ? [[club.id, lists[index]]] : [])));
  }

  /**
   * Which buddies have which glaze, read now (a full fetch: availability is not in the sync log). A failure other than a 401
   * keeps what is shown, with its old time: it is a convenience, and its endpoint must not cost the library.
   */
  async function availabilityOf(): Promise<BuddyAvailability> {
    try {
      return { glazes: await api.buddyAvailability(), asOf: Date.now() };
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw error;
      return ctx.read().buddyAvailability;
    }
  }

  /**
   * The profile picture of each author of a published combination (31-3: one full fetch per load, like the member lists; combination
   * views never carry pictures). A failure other than a 401 keeps what is shown: pictures are a convenience.
   */
  async function authorAvatarsOf(): Promise<Record<string, string>> {
    try {
      return Object.fromEntries((await api.authorAvatars()).map((entry) => [entry.userId, entry.avatarId]));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw error;
      return ctx.read().authorAvatars;
    }
  }

  return { membersOf, availabilityOf, authorAvatarsOf };
}
