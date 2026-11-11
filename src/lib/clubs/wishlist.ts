import type { WishlistEntry } from '../api/models';
import { instantTime } from '../api/instant';
import { glazeTitle } from '../glazes/glazes';

/** What a wishlist entry names (the API's `WishlistEntry.Type`, a shared string enum). */
export const WISHLIST_TYPES = ['GLAZE', 'ITEM'] as const;
export type WishlistType = (typeof WISHLIST_TYPES)[number];

/** The API's bounds (backend `WishlistEntry`, `WishlistLinks`). */
export const WISHLIST_NAME_MAX = 120;
export const WISHLIST_NOTE_MAX = 200;
export const WISHLIST_LINK_MAX = 2000;

/** The characters of a path segment (RFC 3986 `pchar`), the percent sign checked separately: as the backend's `WishlistLinks`. */
const PCHAR = "A-Za-z0-9\\-._~!$&'()*+,;=:@%";
const LINK = new RegExp(
  `^[Hh][Tt][Tt][Pp][Ss]?://([A-Za-z0-9.-]+|\\[[0-9A-Fa-f:.]+\\])(?::[0-9]{1,5})?(?:/[${PCHAR}/]*)?(?:\\?[${PCHAR}/?]*)?(?:#[${PCHAR}/?]*)?$`,
);
const BAD_ESCAPE = /%(?![0-9A-Fa-f]{2})/;
const LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

/**
 * The backend's link grammar (`model/WishlistLinks`, shared vectors `wishlist-links.json`): an http or https URL of printable ASCII with a
 * host name or bracketed IPv6 address, RFC 3986 characters with valid escapes, no credentials or white space, at most 2000 characters.
 */
export function isWishlistLink(link: string): boolean {
  if (!link || link.length > WISHLIST_LINK_MAX) return false;
  const match = LINK.exec(link);
  if (!match || BAD_ESCAPE.test(link)) return false;
  const host = match[1];
  if (host.startsWith('[')) return true;
  return (host.endsWith('.') ? host.slice(0, -1) : host).split('.').every((label) => LABEL.test(label));
}

/** Anything the browser's URL parser would drop or rewrite silently: control characters, white space inside, a backslash. */
const SILENTLY_CHANGED = /[\s\u0000-\u001f\u007f-\u009f\\]/u;

/**
 * The link a person typed, as the API stores it: trimmed, refused when it holds white space, control characters or a backslash
 * (which the URL parser would drop or turn into a slash) or does not start with `http://` or `https://`, then the browser's normalised
 * form (`URL.href`: a non-ASCII host as punycode, other characters percent-encoded), which must pass `isWishlistLink`. Credentials
 * are refused. Never fetched.
 */
export function wishlistLink(typed: string): { link: string } | { error: 'required' | 'invalid' } {
  const text = typed.trim();
  if (!text) return { error: 'required' };
  if (SILENTLY_CHANGED.test(text) || !/^https?:\/\//i.test(text)) return { error: 'invalid' };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { error: 'invalid' };
  }
  if (url.username || url.password || !url.hostname) return { error: 'invalid' };
  return isWishlistLink(url.href) ? { link: url.href } : { error: 'invalid' };
}

/** The host a link leads to, shown as its visible text (punycode stays punycode, so a look-alike host cannot pass for another). */
export function linkHost(link: string): string {
  try {
    return new URL(link).hostname;
  } catch {
    return link;
  }
}

/** How an entry is named: a glaze by its title (`glazeTitle`), an item by its own name. */
export function wishlistTitle(entry: Pick<WishlistEntry, 'type' | 'manufacturer' | 'code' | 'name'>): string {
  return entry.type === 'GLAZE' ? glazeTitle({ manufacturer: { name: entry.manufacturer ?? '' }, code: entry.code ?? '', name: entry.name }) : entry.name;
}

/** Still wanted (not acquired). */
export const isOpen = (entry: Pick<WishlistEntry, 'acquiredAt'>) => !entry.acquiredAt;

/** Entries still wanted, newest first, then the acquired ones, most recently acquired first. */
export function orderedWishlist<T extends Pick<WishlistEntry, 'id' | 'addedAt' | 'acquiredAt'>>(entries: readonly T[]): T[] {
  const time = (entry: T) => instantTime(entry.acquiredAt ?? entry.addedAt) ?? 0;
  return [...entries].sort((a, b) => Number(!isOpen(a)) - Number(!isOpen(b)) || time(b) - time(a) || a.id.localeCompare(b.id));
}

/** How many entries are still wanted (the limit counts these). */
export const openCount = (entries: readonly Pick<WishlistEntry, 'acquiredAt'>[]) => entries.filter(isOpen).length;

/** Whether this glaze is wanted already (the API refuses a second open entry). */
export const isWished = (entries: readonly Pick<WishlistEntry, 'glazeId' | 'acquiredAt'>[], glazeId: string) =>
  entries.some((entry) => entry.glazeId === glazeId && isOpen(entry));

/** The list after a write the API answered: the entry replaces its old copy or joins the list. */
export function withWishlistEntry<T extends { id: string }>(entries: readonly T[], entry: T): T[] {
  return entries.some((item) => item.id === entry.id) ? entries.map((item) => (item.id === entry.id ? entry : item)) : [...entries, entry];
}
