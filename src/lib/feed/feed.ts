/**
 * The activity feed's view rules (backend guide "Activity feed"): where an entry links, whether it is new, the badge's text
 * and the sentence key of each type. The server decides what the viewer may see; nothing here filters.
 */
import type { FeedEntry, User } from '../api/models';
import type { MessageKey } from '../i18n/messages';
import { glazeTitle } from '../glazes/glazes';
import type { Route } from '../routing/routes';

/** The server counts up to this many new entries (`FeedService.BADGE_CAP`); the badge shows "99+" from there. */
export const BADGE_CAP = 100;

/** The badge's text: nothing at 0, the number up to 99, then "99+". */
export function badgeText(count: number): string {
  if (count <= 0) return '';
  return count >= BADGE_CAP ? '99+' : String(count);
}

/** The count the badge's sentences take (`feed.openUnread`, `feed.showNew`): their `=100` form says "99+". */
export function badgeCount(count: number): number {
  return Math.min(Math.max(count, 0), BADGE_CAP);
}

/** Whether an entry came after the account's seen position (every entry is new before the first look). */
export function isNew(entry: Pick<FeedEntry, 'at'>, seenAt: string | null | undefined): boolean {
  if (!seenAt) return true;
  return Date.parse(entry.at) > Date.parse(seenAt);
}

/** The page of the item an entry names: the combination, the glaze, the club's shelf, the club or the Buddies section. */
export function entryRoute(entry: FeedEntry): Route {
  switch (entry.type) {
    case 'BUDDY_COMBINATION':
    case 'CLUB_COMBINATION':
      return { name: 'combination', id: entry.itemId };
    case 'BUDDY_GLAZE':
      return { name: 'glaze', id: entry.itemId };
    case 'CLUB_GLAZE':
      // The club's shelf, never the add form (`glaze` would open it with the quantity field focused and the phone keyboard up).
      return entry.clubId ? { name: 'stock', shelf: entry.clubId } : { name: 'glaze', id: entry.itemId };
    case 'CLUB_MEMBER':
      return entry.clubId ? { name: 'club', id: entry.clubId } : { name: 'clubs' };
    case 'NEW_BUDDY':
    case 'BUDDY_REQUEST':
      // The account page's Buddies section lists buddies and answers requests.
      return { name: 'account' };
  }
}

const sentences: Record<FeedEntry['type'], MessageKey> = {
  BUDDY_COMBINATION: 'feed.entry.buddyCombination',
  BUDDY_GLAZE: 'feed.entry.buddyGlaze',
  NEW_BUDDY: 'feed.entry.newBuddy',
  BUDDY_REQUEST: 'feed.entry.buddyRequest',
  CLUB_COMBINATION: 'feed.entry.clubCombination',
  CLUB_MEMBER: 'feed.entry.clubMember',
  CLUB_GLAZE: 'feed.entry.clubGlaze',
};

/** The sentence of an entry and its values (the combination's `title`, the `glaze` as everywhere else, the `club`). */
export function entrySentence(entry: FeedEntry): { key: MessageKey; values: Record<string, string> } {
  const glaze = entry.glazeName ? glazeTitle({ manufacturer: { name: entry.manufacturer ?? '' }, code: entry.glazeCode ?? '', name: entry.glazeName }) : '';
  return {
    key: sentences[entry.type],
    values: { name: entry.actorName, title: entry.title ?? '', glaze, club: entry.clubName ?? '' },
  };
}

/** Both sources are off: the page says so and links to the switches (a saved account from before the feed has neither field: on). */
export function sourcesOff(user: Partial<Pick<User, 'feedBuddies' | 'feedClubs'>>): boolean {
  return user.feedBuddies === false && user.feedClubs === false;
}
