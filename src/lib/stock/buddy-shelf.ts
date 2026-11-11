import type { Buddies, BuddyAvailability, BuddyName } from '../api/models';
import type { GlazeStep } from '../glazes/steps';

/**
 * Buddy availability matched with the glazes of a combination (27-3). The API reports, per glaze ID, the accepted buddies
 * who have it on their personal shelf (never amounts); everything here is by glaze ID and pure.
 */

/** The accepted buddies who have a glaze, by glaze ID, each list ordered by name. */
export type BuddyHolders = ReadonlyMap<string, BuddyName[]>;

/** Nothing read yet: a guest, a new account, or a snapshot saved before buddy availability. */
export const emptyAvailability = (): BuddyAvailability => ({ glazes: [], asOf: null });

/**
 * Who has which glaze. Only buddies the loaded lists still call accepted count, so a buddy removed on this device stops
 * showing at once, even before the availability is read again; a buddy listed twice counts once; a glaze nobody has is left out.
 */
export function buddyHolders(availability: Pick<BuddyAvailability, 'glazes'>, buddies: Pick<Buddies, 'buddies'>, collator?: Intl.Collator): BuddyHolders {
  const accepted = new Set(buddies.buddies.map((buddy) => buddy.id));
  const compare = collator ?? new Intl.Collator();
  const holders = new Map<string, BuddyName[]>();
  for (const entry of availability.glazes) {
    const seen = new Set<string>();
    const list = entry.buddies.filter((buddy) => accepted.has(buddy.id) && !seen.has(buddy.id) && seen.add(buddy.id));
    if (!list.length) continue;
    holders.set(
      entry.glazeId,
      [...list].sort((a, b) => compare.compare(a.displayName, b.displayName) || a.id.localeCompare(b.id)),
    );
  }
  return holders;
}

/**
 * The availability without anybody the loaded lists no longer call an accepted buddy, for the snapshot: a read that failed
 * after a removal keeps the old availability on show (filtered by `buddyHolders`), but the device must not keep a removed
 * buddy's name and glazes. Answers the same object when nothing goes.
 */
export function ofAcceptedBuddies(availability: BuddyAvailability, buddies: Pick<Buddies, 'buddies'>): BuddyAvailability {
  const accepted = new Set(buddies.buddies.map((buddy) => buddy.id));
  if (availability.glazes.every((entry) => entry.buddies.every((buddy) => accepted.has(buddy.id)))) return availability;
  const glazes = availability.glazes
    .map((entry) => ({ ...entry, buddies: entry.buddies.filter((buddy) => accepted.has(buddy.id)) }))
    .filter((entry) => entry.buddies.length > 0);
  return { ...availability, glazes };
}

/** The day (UTC) the availability was read, to tell whether a saved copy needs rewriting for its time. */
export const availabilityDay = (availability: Pick<BuddyAvailability, 'asOf'>): number | null =>
  availability.asOf === null ? null : Math.floor(availability.asOf / 86_400_000);

/** The day the availability was read, worded for the user's language ("31 Oct 2026"); undefined while nothing was read. */
export const availabilityDate = (availability: Pick<BuddyAvailability, 'asOf'>, locale: string): string | undefined =>
  availability.asOf === null ? undefined : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(availability.asOf);

/** The shelf's glaze IDs plus every glaze a buddy has: what "I can make now" counts with "Include buddies" on. */
export function withBuddyGlazes(owned: ReadonlySet<string>, holders: BuddyHolders): Set<string> {
  return new Set([...owned, ...holders.keys()]);
}

/** A glaze the shelf lacks and the buddies who have it. */
export interface BuddyCover {
  step: GlazeStep;
  buddies: BuddyName[];
}

/** Which of the missing glazes buddies have (the first glaze step of each, in step order), and who. */
export function buddyCover(missing: readonly GlazeStep[], holders: BuddyHolders): BuddyCover[] {
  return missing.flatMap((step) => {
    const buddies = holders.get(step.glazeId);
    return buddies ? [{ step, buddies }] : [];
  });
}

/** The glazes one set of buddies has, for a sentence like "Ada and Ben have A and B". */
export interface BuddyGroup {
  buddies: BuddyName[];
  steps: GlazeStep[];
}

/** The cover grouped by who has the glaze: equal sets of buddies share one entry, in the order of their first glaze. */
export function groupCover(cover: readonly BuddyCover[]): BuddyGroup[] {
  const groups = new Map<string, BuddyGroup>();
  for (const { step, buddies } of cover) {
    const key = buddies.map((buddy) => buddy.id).join(',');
    const group = groups.get(key);
    if (group) group.steps.push(step);
    else groups.set(key, { buddies, steps: [step] });
  }
  return [...groups.values()];
}

/** Up to this many buddies a mark names them; beyond it the mark says "At 4 buddies" and names them in its details. */
export const MARK_NAMES_MAX = 3;

/** How a mark words its buddies: by name, or by number with the names in the details (never a number alone). */
export const markNames = (buddies: readonly BuddyName[]): 'names' | 'count' => (buddies.length <= MARK_NAMES_MAX ? 'names' : 'count');

/** The buddies whose names a summary sentence lists in full; more are "Ada, Ben and 2 more". */
export const SUMMARY_NAMES_MAX = 3;

/** The names a summary sentence lists and how many more there are. */
export function summaryNames(buddies: readonly BuddyName[]): { names: string[]; more: number } {
  if (buddies.length <= SUMMARY_NAMES_MAX) return { names: buddies.map((buddy) => buddy.displayName), more: 0 };
  const shown = SUMMARY_NAMES_MAX - 1;
  return { names: buddies.slice(0, shown).map((buddy) => buddy.displayName), more: buddies.length - shown };
}

/**
 * The link an "Ask Ada" message carries, or null. A draft exists only for its author, so the buddy could not open the link: the
 * message names the combination by its title alone. Every published combination is readable by every signed-in account.
 */
export const askLink = (combination: { draft?: boolean }, link: string): string | null => (combination.draft ? null : link);

/**
 * The message an "Ask Ada" button shares (27-10): the combination variants name the combination (with its link unless it is a
 * draft); the glaze page has no combination (`title` null) and names the glaze alone, never with a link.
 */
export const askMessageKey = (
  title: string | null,
  link: string | null,
): 'buddies.shelf.message' | 'buddies.shelf.messageNoLink' | 'buddies.shelf.messageGlaze' =>
  title === null ? 'buddies.shelf.messageGlaze' : link ? 'buddies.shelf.message' : 'buddies.shelf.messageNoLink';
