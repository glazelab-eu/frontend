/**
 * Hash routes: the fragment never reaches the server, so deep links need no server or
 * service-worker fallback, work offline, and keep tokens out of server logs and Referer headers.
 */
import type { MessageKey } from '../i18n/messages';
import { atmospheres, isCone, type Atmosphere } from '../firing/firing';
import { normalizeTag } from '../tags/tags';
import { BARCODE_DIGITS } from '../barcodes/barcodes';
import type { SyncState } from '../sync/lifecycle';

export type TokenRouteName = 'verify' | 'reset' | 'login' | 'invite' | 'buddy';
export type Section = 'discover' | 'stock' | 'studio' | 'clubs';

export const quickViews = ['all', 'mine', 'waiting', 'favourites', 'shelf', 'available', 'canMake', 'new'] as const;
export type QuickView = (typeof quickViews)[number];
export const quickLabels = {
  all: 'discover.quick.all',
  favourites: 'discover.quick.favourites',
  mine: 'discover.quick.mine',
  waiting: 'discover.quick.waiting',
  new: 'discover.quick.new',
  shelf: 'discover.quick.shelf',
  available: 'discover.quick.available',
  canMake: 'discover.quick.canMake',
} as const;
/** The part of the shelf "On my shelf" lists: glazes in stock (default, absent from links), used up ones, or both. */
export const shelfStocks = ['stock', 'used', 'all'] as const;
export type ShelfStock = (typeof shelfStocks)[number];
export const sorts = ['newest', 'favourites', 'az', 'used'] as const;
export type Sort = (typeof sorts)[number];

/** Available orders follow the type filter, even when a quick view narrows All to one kind. */
export function sortOptions(type?: ExploreType): readonly Sort[] {
  return type === 'glazes' ? ['newest', 'favourites', 'used', 'az'] : ['newest', 'favourites', 'az'];
}

const sortLabels: Record<Sort, MessageKey> = {
  favourites: 'discover.sort.favourites',
  used: 'discover.sort.used',
  newest: 'discover.sort.newest',
  az: 'discover.sort.az',
};

/** The label of an order; the glazes' A–Z sorts by code. */
export function sortLabel(sort: Sort, type?: ExploreType): MessageKey {
  return type === 'glazes' && sort === 'az' ? 'discover.sort.code' : sortLabels[sort];
}

/** Missing or inapplicable orders use this type's default. */
export function activeSort(sort: Sort | undefined, type?: ExploreType): Sort {
  const options = sortOptions(type);
  return sort && options.includes(sort) ? sort : options[0];
}

/** Defaults are implicit in links, and cannot carry over into another type. */
export function explicitSort(sort: Sort | undefined, type?: ExploreType): Sort | undefined {
  const active = activeSort(sort, type);
  return active === sortOptions(type)[0] ? undefined : active;
}

/**
 * Explore's search and filters, kept in the link so back navigation, reload and shared links
 * show the same list (account-specific ones apply to the receiver's own data). Empty or default
 * values are left out; the type (all, combinations or glazes) is part of the route.
 */
export interface DiscoverFilters {
  q?: string;
  /** Normalized tags; an item must carry all of them. */
  tags?: string[];
  /** A glaze ID: combinations with a glaze step of this glaze. */
  glaze?: string;
  quick?: Exclude<QuickView, 'all'>;
  /** With "I can make now": also combinations missing one glaze (`almost=1`; any other quick view drops it). */
  almost?: true;
  /** With "On my shelf": `stock=used` or `stock=all` (in stock is the default and left out; any other quick view drops it). */
  stock?: Exclude<ShelfStock, 'stock'>;
  /**
   * With "Available to me" or "I can make now": `clubs=1|0`, an explicit choice of "Include club glazes" and `buddies=1|0` of "Include buddies'
   * glazes". Absent: the account's remembered choice applies. Any other quick view drops them. Personal stock is always included.
   */
  clubs?: boolean;
  buddies?: boolean;
  sort?: Sort;
  /** The final firing's cone (`cone=6`, `cone=04`): combinations fired to it; glazes are left out. */
  cone?: string;
  /** The final firing's atmosphere (`atmosphere=oxidation` in the link); glazes are left out. */
  atmosphere?: Atmosphere;
}

/** Which items Explore lists: both (absent), only combinations or only glazes. */
export const exploreTypes = ['combinations', 'glazes'] as const;
export type ExploreType = (typeof exploreTypes)[number];

export type DiscoverRoute = { name: 'discover'; type?: ExploreType } & DiscoverFilters;

export type Route =
  | DiscoverRoute
  /** `photo`: the photo the carousel opens at (`?photo=<image ID>`, set by the admin pages' "Open item"); never kept in history or shared links. */
  | { name: 'glaze'; id: string; photo?: string }
  | { name: 'combination'; id: string; photo?: string }
  /** A club's page (#/clubs/<id>): its members' published combinations. */
  | { name: 'club'; id: string }
  /**
   * A scanned barcode (#/stock/<barcode>) selects its glaze or pre-fills the new-glaze form; `shelf`
   * (`?shelf=personal` or a club's ID, on either form of the link) shows one owner's part of the shelf.
   */
  | { name: 'stock'; barcode?: string; glaze?: string; shelf?: string }
  | { name: 'studio'; id?: string; from?: string; glaze?: string }
  /**
   * The signed-in account's own page (#/account): profile, password, sign-out and deletion; a guest sees the sign-in prompt.
   * `section` (`?section=picture|diagnostics`, the Explore intro card's links) scrolls to that part and focuses its heading.
   */
  | { name: 'account'; section?: AccountSection }
  /** `activity` (#/activity): what buddies and the account's clubs added (the header bell's page). */
  /** `about` (#/about): what Glazelab is; static text, no data, so it opens offline for guests and members alike. */
  | { name: 'clubs' | 'terms' | 'about' | 'activity' | 'admin' | AdminPageName }
  | { name: TokenRouteName; token: string }
  | { name: 'not-found' };

/** The site-admin pages, all under `#/admin/<name>` (the names double as the hash segments); `#/admin` is their landing page. */
export const adminPages = ['image-reports', 'image-deletions', 'avatar-reports', 'bans', 'error-reports', 'users', 'feedback'] as const;
export type AdminPageName = (typeof adminPages)[number];
const isAdminPage = (value: string): value is AdminPageName => (adminPages as readonly string[]).includes(value);

/** The parts of the account page a link can open at (`#/account?section=…`). */
export const accountSections = ['picture', 'diagnostics'] as const;
export type AccountSection = (typeof accountSections)[number];
const isAccountSection = (value: string | null): value is AccountSection => (accountSections as readonly (string | null)[]).includes(value);

export const home: DiscoverRoute = { name: 'discover' };
const tokenRoutes: readonly TokenRouteName[] = ['verify', 'reset', 'login', 'invite', 'buddy'];

export function isTokenRoute(route: Route): route is { name: TokenRouteName; token: string } {
  return (tokenRoutes as readonly string[]).includes(route.name);
}

const ID_PATTERN = /^[0-9A-Za-z-]{1,64}$/;

/** Reads Explore's filters from the query part of the hash, dropping unknown or invalid values. */
function discoverFilters(search: string, legacyType?: ExploreType): DiscoverFilters & { type?: ExploreType } {
  const params = new URLSearchParams(search);
  const filters: DiscoverFilters & { type?: ExploreType } = legacyType ? { type: legacyType } : {};
  const type = params.get('type');
  if (exploreTypes.some((value) => value === type)) filters.type = type as ExploreType;
  const q = params.get('q')?.trim().slice(0, 200);
  if (q) filters.q = q;
  const tags = [...new Set((params.get('tags') ?? '').split(',').map(normalizeTag).filter(Boolean))].slice(0, 20);
  if (tags.length) filters.tags = tags;
  const glaze = params.get('glaze');
  if (glaze && ID_PATTERN.test(glaze)) filters.glaze = glaze;
  const quick = params.get('quick');
  if (quickViews.some((value) => value === quick) && quick !== 'all') filters.quick = quick as DiscoverFilters['quick'];
  if (filters.quick === 'canMake' && params.get('almost') === '1') filters.almost = true;
  const stock = params.get('stock');
  if (filters.quick === 'shelf' && (stock === 'used' || stock === 'all')) filters.stock = stock;
  if (filters.quick === 'available' || filters.quick === 'canMake') {
    for (const name of ['clubs', 'buddies'] as const) {
      const value = params.get(name);
      if (value === '1' || value === '0') filters[name] = value === '1';
    }
  }
  // The final-firing filters concern combinations; the Glazes list drops them.
  const cone = params.get('cone')?.trim();
  const atmosphere = params.get('atmosphere')?.toUpperCase();
  if (filters.type !== 'glazes') {
    if (cone && isCone(cone)) filters.cone = cone;
    if (atmospheres.some((value) => value === atmosphere)) filters.atmosphere = atmosphere as Atmosphere;
  }
  const sort = params.get('sort');
  if (sorts.some((value) => value === sort)) {
    const selected = explicitSort(sort as Sort, filters.type);
    if (selected) filters.sort = selected;
  }
  return filters;
}

/** The query part for Explore's filters, in a stable order, without empty values. */
function discoverSearch({ type, q, tags, glaze, quick, almost, stock, clubs, buddies, sort, cone, atmosphere }: DiscoverRoute): string {
  const params = new URLSearchParams();
  if (type) params.set('type', type);
  if (q?.trim()) params.set('q', q.trim());
  if (tags?.length) params.set('tags', tags.join(','));
  if (glaze) params.set('glaze', glaze);
  if (quick) params.set('quick', quick);
  if (quick === 'canMake' && almost) params.set('almost', '1');
  if (quick === 'shelf' && stock) params.set('stock', stock);
  if ((quick === 'available' || quick === 'canMake') && clubs !== undefined) params.set('clubs', clubs ? '1' : '0');
  if ((quick === 'available' || quick === 'canMake') && buddies !== undefined) params.set('buddies', buddies ? '1' : '0');
  if (cone && type !== 'glazes') params.set('cone', cone);
  if (atmosphere && type !== 'glazes') params.set('atmosphere', atmosphere.toLowerCase());
  const selected = explicitSort(sort, type);
  if (selected) params.set('sort', selected);
  const search = params.toString();
  return search ? `?${search}` : '';
}

/** The `photo` query of an item link; anything but a plain ID is ignored. */
function photoOf(search: string): { photo?: string } {
  const photo = new URLSearchParams(search).get('photo');
  return photo && ID_PATTERN.test(photo) ? { photo } : {};
}

/** The route without the one-time `photo` pointer: what history, back links and shared links keep. */
export function withoutPhotoPointer(route: Route): Route {
  if ((route.name === 'glaze' || route.name === 'combination') && route.photo) return { name: route.name, id: route.id };
  return route;
}

function segment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

/** Parses `location.hash`. Links from older emails/invites (`#verify=<token>`, never a buddy link) map to their routes. */
export function parseRoute(hash: string): Route {
  const fragment = hash.replace(/^#/, '');
  if (!fragment.startsWith('/')) {
    const legacy = new URLSearchParams(fragment);
    for (const name of tokenRoutes.filter((route) => route !== 'buddy')) {
      const token = legacy.get(name);
      if (token) return { name, token };
    }
    return fragment ? { name: 'not-found' } : home;
  }
  const [path, search = ''] = fragment.split(/\?(.*)/s);
  const parts = path.split('/').filter(Boolean).map(segment);
  if (parts.some((part) => !part)) return { name: 'not-found' };
  const [first, second, ...rest] = parts;
  if (rest.length) return { name: 'not-found' };
  if (!first) return { ...home, ...discoverFilters(search) };
  if (second === undefined) {
    // The older lists: #/combinations and #/glazes open the list of that type.
    if (first === 'combinations' || first === 'glazes') return { ...home, ...discoverFilters(search, first) };
    // The admin pages' first hashes (`#/image-reports` ...) keep working: old notes, bookmarks and emails.
    if (isAdminPage(first)) return { name: first };
    if (first === 'admin') return { name: 'admin' };
    if (first === 'stock') {
      const glaze = new URLSearchParams(search).get('glaze');
      return { name: 'stock', ...(glaze && ID_PATTERN.test(glaze) ? { glaze } : {}), ...shelfOf(search) };
    }
    if (first === 'studio') {
      const params = new URLSearchParams(search);
      const from = params.get('from');
      const glaze = params.get('glaze');
      if (from && ID_PATTERN.test(from)) return { name: 'studio', from };
      return { name: 'studio', ...(glaze && ID_PATTERN.test(glaze) ? { glaze } : {}) };
    }
    if (first === 'account') {
      const section = new URLSearchParams(search).get('section');
      return isAccountSection(section) ? { name: 'account', section } : { name: 'account' };
    }
    if (first === 'clubs' || first === 'terms' || first === 'about' || first === 'activity') return { name: first };
    return { name: 'not-found' };
  }
  if (first === 'admin') return isAdminPage(second) ? { name: second } : { name: 'not-found' };
  if (first === 'studio' && ID_PATTERN.test(second)) return { name: 'studio', id: second };
  if (first === 'glazes') return { name: 'glaze', id: second, ...photoOf(search) };
  if (first === 'stock' && BARCODE_DIGITS.test(second)) return { name: 'stock', barcode: second, ...shelfOf(search) };
  if (first === 'combinations') return { name: 'combination', id: second, ...photoOf(search) };
  if (first === 'clubs') return { name: 'club', id: second };
  const token = tokenRoutes.find((name) => name === first);
  return token ? { name: token, token: second } : { name: 'not-found' };
}

/** The `shelf` query of the shelf page; anything but a plain ID is ignored. */
function shelfOf(search: string): { shelf?: string } {
  const shelf = new URLSearchParams(search).get('shelf');
  return shelf && ID_PATTERN.test(shelf) ? { shelf } : {};
}

/** The query of the shelf page: a glaze to select and the owner to show. */
function stockSearch({ glaze, shelf }: { glaze?: string; shelf?: string }): string {
  const params = new URLSearchParams();
  if (glaze) params.set('glaze', glaze);
  if (shelf) params.set('shelf', shelf);
  const search = params.toString();
  return search ? `?${search}` : '';
}

const photoSearch = (photo?: string) => (photo ? `?photo=${encodeURIComponent(photo)}` : '');

/** Builds the hash for a route; unknown routes fall back to the library. */
export function routeHref(route: Route): string {
  switch (route.name) {
    case 'discover':
      return '#/' + discoverSearch(route);
    case 'glaze':
      return `#/glazes/${encodeURIComponent(route.id)}${photoSearch(route.photo)}`;
    case 'combination':
      return `#/combinations/${encodeURIComponent(route.id)}${photoSearch(route.photo)}`;
    case 'club':
      return `#/clubs/${encodeURIComponent(route.id)}`;
    case 'stock':
      return route.barcode ? '#/stock/' + encodeURIComponent(route.barcode) + stockSearch({ shelf: route.shelf }) : '#/stock' + stockSearch(route);
    case 'studio':
      if (route.id) return '#/studio/' + encodeURIComponent(route.id);
      return route.from ? '#/studio?from=' + encodeURIComponent(route.from) : route.glaze ? '#/studio?glaze=' + encodeURIComponent(route.glaze) : '#/studio';
    case 'account':
      return route.section ? `#/account?section=${route.section}` : '#/account';
    case 'clubs':
    case 'terms':
    case 'about':
    case 'activity':
      return `#/${route.name}`;
    case 'admin':
      return '#/admin';
    case 'image-deletions':
    case 'image-reports':
    case 'avatar-reports':
    case 'bans':
    case 'error-reports':
    case 'users':
    case 'feedback':
      return `#/admin/${route.name}`;
    case 'not-found':
      return '#/';
    default:
      return `#/${route.name}/${encodeURIComponent(route.token)}`;
  }
}

/**
 * What a page is: routes with the same key show the same page, so a change of Explore's filters
 * and type, or of the shelf's owner, updates the shown page instead of mounting it again (focus
 * stays in the search box, the add form keeps its draft).
 */
export function routeKey(route: Route): string {
  if (route.name === 'discover') return 'discover';
  if (route.name === 'account') return routeHref({ name: 'account' });
  return routeHref(route.name === 'stock' ? { ...route, shelf: undefined } : route);
}

/** The navigation entry a route belongs to; unknown routes highlight nothing. */
export function routeSection(route: Route): Section | null {
  switch (route.name) {
    case 'stock':
    case 'studio':
    case 'clubs':
      return route.name;
    case 'club':
      return 'clubs';
    case 'not-found':
    case 'terms':
    case 'about':
    case 'account':
    case 'activity':
    case 'admin':
    case 'image-deletions':
    case 'image-reports':
    case 'avatar-reports':
    case 'bans':
    case 'error-reports':
    case 'users':
    case 'feedback':
      return null;
    default:
      return 'discover';
  }
}

export type ItemStatus<T> = { status: 'found'; item: T } | { status: 'loading' | 'missing' | 'unavailable' };

/**
 * Resolves an item addressed by a route from loaded or saved data. A missing item is reported as
 * missing whether it never existed or is not visible, so the UI cannot reveal private items. When
 * the last load failed and the item is not in the saved snapshot, the data is unavailable instead.
 */
export function findItem<T extends { id: string }>(items: readonly T[], id: string, sync: SyncState): ItemStatus<T> {
  const item = items.find((candidate) => candidate.id === id);
  if (item) return { status: 'found', item };
  // While a load runs over shown listings (the snapshot at the start), the item may still arrive.
  if (sync.phase !== 'idle') return { status: 'loading' };
  return { status: sync.failure ? 'unavailable' : 'missing' };
}
