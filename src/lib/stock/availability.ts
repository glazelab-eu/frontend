import type { Club, StockItem } from '../api/models';
import type { translate } from '../i18n';

/** A club name longer than this many characters is cut with an ellipsis in an availability mark (the API allows 120). */
export const CLUB_NAME_MAX = 24;
/** An availability mark names at most this many clubs; more are counted ("A, B and 2 more"). */
export const AVAILABLE_CLUBS_MAX = 2;

/** Where the account can get a glaze: its personal shelf (in stock), else the clubs whose shelves hold it in stock, by name. */
export interface GlazeAvailability {
  personal: boolean;
  /** The clubs' names, sorted; empty when the personal shelf has it (the mark then says only "On your shelf"). */
  clubs: string[];
}

/**
 * The availability of every glaze in stock, for the shelf marks. Only entries above 0 g count. Club entries count only with
 * `clubs` (the active scope includes club shelves) and only for a club in `memberOf` (the loaded clubs list, which also
 * gives the name), so a club the account left is never named. A glaze in personal stock is personal only, whatever the
 * clubs hold.
 */
export function availabilityByGlaze(
  stock: readonly Pick<StockItem, 'glazeId' | 'quantityG' | 'clubId'>[],
  memberOf: readonly Pick<Club, 'id' | 'name'>[],
  options: { clubs: boolean; locale?: string },
): Map<string, GlazeAvailability> {
  const names = new Map(memberOf.map((club) => [club.id, club.name]));
  const byGlaze = new Map<string, GlazeAvailability>();
  for (const item of stock) {
    if (item.quantityG <= 0) continue;
    const name = item.clubId ? names.get(item.clubId) : undefined;
    if (item.clubId && (!options.clubs || name === undefined)) continue;
    const entry = byGlaze.get(item.glazeId) ?? { personal: false, clubs: [] };
    if (!item.clubId) entry.personal = true;
    else if (!entry.clubs.includes(name!)) entry.clubs.push(name!);
    byGlaze.set(item.glazeId, entry);
  }
  const collator = new Intl.Collator(options.locale, { numeric: true, sensitivity: 'base' });
  for (const entry of byGlaze.values()) {
    if (entry.personal) entry.clubs = [];
    else entry.clubs.sort(collator.compare);
  }
  return byGlaze;
}

/** A club name as a mark shows it: at most `CLUB_NAME_MAX` characters (code points, never half a surrogate pair), else cut with "…". */
export function shortClubName(name: string, max = CLUB_NAME_MAX): string {
  const chars = Array.from(name.trim());
  return chars.length <= max
    ? chars.join('')
    : `${chars
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`;
}

/**
 * The mark beside a glaze: "On your shelf", "Available in A", "Available in A and B", "Available in A, B and 2 more", or
 * "Not on your shelf". The full club names go to `full`, for a tooltip where a name was cut.
 */
export function availabilityText(
  availability: GlazeAvailability | undefined,
  t: typeof translate,
  locale: string,
): { text: string; full: string; available: boolean } {
  if (availability?.personal) return { text: t('combination.shelf.on'), full: '', available: true };
  const clubs = availability?.clubs ?? [];
  if (!clubs.length) return { text: t('combination.shelf.off'), full: '', available: false };
  const line = (names: string[]) => {
    const more = clubs.length - names.length;
    // "A, B" before the translation's "and N more" (a unit list joins with "e" in Portuguese, doubling the "and").
    const list = more > 0 ? names.join(', ') : new Intl.ListFormat(locale, { type: 'conjunction' }).format(names);
    return more > 0
      ? t('combination.shelf.inClubsMore', { values: { clubs: list, more } })
      : t('combination.shelf.inClubs', { values: { clubs: list, count: clubs.length } });
  };
  const shown = clubs.slice(0, AVAILABLE_CLUBS_MAX);
  const text = line(shown.map((name) => shortClubName(name)));
  const full = line(shown);
  return { text, full: full === text ? '' : full, available: true };
}
