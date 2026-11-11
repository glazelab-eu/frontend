import type { Buddies, Buddy } from '../api/models';
import type { BuddyRequestView } from '../generated/types.gen';

/** How an account stands to another one: what the API answers for a link or a request (`SELF`: the account's own link). */
export type BuddyRelation = BuddyRequestView['relation'];

/** Nothing known: a guest, a new account, or a snapshot saved before buddies (fresh lists each time, like `emptyAccountData`). */
export const emptyBuddies = (): Buddies => ({ buddies: [], incoming: [], outgoing: [], hasLink: false });

/** The relation of the signed-in account to another account, from the loaded lists (the lists hold nobody but accepted buddies and pending requests). */
export function buddyRelation(buddies: Buddies, userId: string, selfId: string): BuddyRelation {
  if (userId === selfId) return 'SELF';
  if (buddies.buddies.some((buddy) => buddy.id === userId)) return 'BUDDIES';
  if (buddies.outgoing.some((buddy) => buddy.id === userId)) return 'OUTGOING';
  if (buddies.incoming.some((buddy) => buddy.id === userId)) return 'INCOMING';
  return 'NONE';
}

/** The list as the section shows it: by name in the app's locale, then by ID so equal names keep a stable order. */
export function orderedBuddies(list: readonly Buddy[], collator: Intl.Collator): Buddy[] {
  return [...list].sort((a, b) => collator.compare(a.displayName, b.displayName) || a.id.localeCompare(b.id));
}

/**
 * Whether a buddy or club invite route's token has the shape the API accepts (`BuddyDtos.BuddyLinkInput`, `ClubDtos.InviteInput`:
 * 43 base64url characters). A link
 * pasted with a trailing full stop or cut short is then called invalid at once, not answered with the API's form-field
 * message, and costs no request of the link budget.
 */
export const isLinkToken = (token: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(token);

/** The pending requests other accounts made to this one: the number the account menu and the header mention. */
export const requestCount = (buddies: Buddies): number => buddies.incoming.length;

/**
 * What a buddy link's page offers for the relation the preview reports: ask (none), accept an incoming request (asking
 * back accepts it), or only say how things stand.
 */
export type RequestOffer = 'ask' | 'accept' | 'pending' | 'buddies' | 'own';

export function requestOffer(relation: BuddyRelation): RequestOffer {
  switch (relation) {
    case 'NONE':
      return 'ask';
    case 'INCOMING':
      return 'accept';
    case 'OUTGOING':
      return 'pending';
    case 'BUDDIES':
      return 'buddies';
    case 'SELF':
      return 'own';
  }
}
