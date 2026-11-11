import type { Club, ClubMember, Combination, StockItem } from '../api/models';
import { published } from '../explore/explore';
import { newestFirst } from '../explore/listing';
import { filterByOwner, isUsedUp } from '../stock/shelf';

/**
 * A club's combinations: the published ones whose author is a current member, newest first (as
 * Explore's Newest). The listing is already what the viewer may see; drafts never count, and a
 * former member (or a deleted account, with no author) has no place in the list.
 */
export function memberCombinations(combinations: readonly Combination[], members: readonly ClubMember[]): Combination[] {
  const ids = new Set(members.map((member) => member.id));
  return published(combinations)
    .filter((combination) => !!combination.authorId && ids.has(combination.authorId))
    .sort(newestFirst);
}

/** The only admin of the club: demoting them must fail on the server, so the control is not offered. */
export function isLastAdmin(members: readonly ClubMember[], member: ClubMember): boolean {
  return member.role === 'ADMIN' && members.filter((other) => other.role === 'ADMIN').length <= 1;
}

/**
 * Why the account cannot leave a club, from its loaded member list: the only member (the club would be left without
 * anyone; deleting the account removes it) or the only admin (someone else must be made admin first). Null when it
 * may leave, or when the list is not loaded: the server's last-admin guard stays authoritative.
 */
export function leaveRefusal(members: readonly ClubMember[] | undefined, userId: string): 'onlyMember' | 'lastAdmin' | null {
  const me = members?.find((member) => member.id === userId);
  if (!members || !me) return null;
  if (members.length === 1) return 'onlyMember';
  return isLastAdmin(members, me) ? 'lastAdmin' : null;
}

/**
 * Who put a club shelf entry there, as the shelf names them: the account itself, or a current member by display
 * name. Null for personal stock and once the adder left (the API clears it) or is not in the loaded member list.
 */
export function stockAdder(
  item: Pick<StockItem, 'clubId' | 'addedById'>,
  members: readonly ClubMember[] | undefined,
  userId: string,
): { you: true } | { name: string } | null {
  if (!item.clubId || !item.addedById) return null;
  if (item.addedById === userId) return { you: true };
  const member = members?.find((candidate) => candidate.id === item.addedById);
  return member ? { name: member.displayName } : null;
}

/** House rules longer than this many characters, or with more lines, are shown folded on the club page. */
export const RULES_FOLD_CHARS = 400;
export const RULES_FOLD_LINES = 6;

/**
 * The house rules as the club page first shows them: whole when short, else the start (at most `RULES_FOLD_LINES`
 * lines and about `RULES_FOLD_CHARS` characters, cut at a word where there is one) with an ellipsis. Pure and
 * measured by counting only, so the page's first render never depends on a layout (`PagedGrid`'s first-render rule).
 */
export function rulesFold(rules: string): { shown: string; folded: boolean } {
  const lines = rules.split(/\r?\n/);
  if (rules.length <= RULES_FOLD_CHARS && lines.length <= RULES_FOLD_LINES) return { shown: rules, folded: false };
  let head = lines.slice(0, RULES_FOLD_LINES).join('\n');
  if (head.length > RULES_FOLD_CHARS) {
    head = head.slice(0, RULES_FOLD_CHARS);
    // Never end on half of a surrogate pair; prefer the last space or line break of the final fifth.
    if (/[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1);
    const space = head.search(/\s\S*$/);
    if (space > RULES_FOLD_CHARS * 0.8) head = head.slice(0, space);
  }
  return { shown: `${head.trimEnd()}…`, folded: true };
}

/** The members who can invite and change settings, in the order given: the names a plain member is told to ask. */
export function clubAdmins(members: readonly ClubMember[] | undefined): ClubMember[] {
  return members?.filter((member) => member.role === 'ADMIN') ?? [];
}

/** The member list as the club page shows it: admins first, then by name (the app's locale), the account itself kept among them. */
export function orderedMembers(members: readonly ClubMember[], collator: Intl.Collator): ClubMember[] {
  return [...members].sort((a, b) => Number(b.role === 'ADMIN') - Number(a.role === 'ADMIN') || collator.compare(a.displayName, b.displayName));
}

/** How many members the club page lists before "Show all". */
export const MEMBERS_SHOWN = 12;

/** The counts a club card shows; a count whose list is not available is left out (undefined), never shown as 0. */
export interface ClubSummary {
  members?: number;
  /** Glazes on the club shelf that are not used up (the club page's "Club shelf (n)"). */
  glazes: number;
  /** Published combinations by current members (the club page's list); needs the member list. */
  combinations?: number;
}

/** What the Clubs list says about one club, from the loaded data only: `members` is undefined when its list is not available. */
export function clubSummary(
  club: Pick<Club, 'id'>,
  members: readonly ClubMember[] | undefined,
  stock: StockItem[],
  combinations: readonly Combination[],
): ClubSummary {
  return {
    members: members?.length,
    glazes: filterByOwner(stock, club.id).filter((item) => !isUsedUp(item)).length,
    combinations: members ? memberCombinations(combinations, members).length : undefined,
  };
}

/** The clubs by name in the app's locale (the API sorts case-sensitively), equal names by ID so the order is stable. */
export function sortedClubs<T extends Pick<Club, 'id' | 'name'>>(clubs: readonly T[], collator: Intl.Collator): T[] {
  return [...clubs].sort((a, b) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id));
}
