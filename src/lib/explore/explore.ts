import { hasResultPhoto } from '../images/pictures';
import type { Combination, FavoriteCounts, Favorites, Glaze, StockItem } from '../api/models';
import { glazeMap } from '../glazes/glazes';
import { shelfScope } from '../stock/shelf';
import type { BuddyHolders } from '../stock/buddy-shelf';
import { activeSort, explicitSort, type DiscoverFilters, type DiscoverRoute, type ExploreType, type QuickView, type ShelfStock } from '../routing/routes';
import type { TagCount, TagIndex } from '../tags/tags';
import { compareText, inOrder, listingOf, listingOrder, matchesOf, missingGlazes, tagCountsOf, type Row } from './listing';

/** One entry of Explore's mixed list. */
export type ExploreItem = { kind: 'glaze'; item: Glaze } | { kind: 'combination'; item: Combination };

/** The key of a list entry in paging and rendering; unique across both kinds. */
export function exploreKey(entry: ExploreItem): string {
  return `${entry.kind}:${entry.item.id}`;
}

export interface ExploreCounts {
  all: number;
  combinations: number;
  glazes: number;
}

/** The quick views, in the order of their chips. */
const chipViews: readonly QuickView[] = ['all', 'favourites', 'mine', 'waiting', 'new', 'shelf', 'available', 'canMake'];

/** How long an entry counts as new. */
export const newDays = 14;

/** A quick-view chip of the row above the results. */
export interface QuickChip {
  view: QuickView;
  /** Entries the view lists for the current search, tags, glaze and type. */
  count: number;
  /** Why the chip cannot be used now; it stays visible so the reason can be read. */
  reason?: 'noShelf';
}

/** The route without personal stock and shared availability options, for links leaving these views. */
function withoutShelfOptions(route: DiscoverRoute): DiscoverRoute {
  const { stock: _, clubs: __, buddies: ___, ...rest } = route;
  return rest;
}

/** The type a quick view concerns; views that name none apply to both. */
const quickScope: Record<Exclude<QuickView, 'all'>, ExploreType | undefined> = {
  favourites: undefined,
  mine: 'combinations',
  waiting: undefined,
  new: undefined,
  shelf: 'glazes',
  available: 'glazes',
  canMake: 'combinations',
};

const scopeOf = (quick: QuickView | undefined) => (quick && quick !== 'all' ? quickScope[quick] : undefined);

/** Whether a quick view makes sense for the type: a type-specific view fits All and its own type. */
export function quickApplies(quick: QuickView | undefined, type?: ExploreType): boolean {
  const scope = scopeOf(quick);
  return !scope || !type || scope === type;
}

/**
 * The quick view that acts on the list. Account-specific views do nothing for guests, and a view
 * that concerns the other type is ignored, so a hand-edited or shared link never empties the list
 * silently.
 */
export function activeQuick(quick: QuickView | undefined, type: ExploreType | undefined, signedIn: boolean): QuickView {
  return quick && signedIn && quickApplies(quick, type) ? quick : 'all';
}

export interface ExploreResult {
  /** The entries for the chosen type, in the type's order. */
  items: ExploreItem[];
  /** Entries per type for the current search, tags, glaze and quick filter. */
  counts: ExploreCounts;
  /** The quick view in effect (see `activeQuick`). */
  quick: QuickView;
  /** The chips to show, in order; none for guests, who have nothing personal to filter by. */
  chips: QuickChip[];
  /** Tags of the shown entries, most used first, so a tag choice never ends in an empty list. */
  tagCounts: TagCount[];
  /** The part of the shelf "On my shelf" lists (see `ShelfStock`); in stock whenever another view is in effect. */
  shelfStock: ShelfStock;
  /** With "On my shelf": what each part of the shelf would list for the current search, tags and type; otherwise empty. */
  shelfChoices: { choice: ShelfStock; count: number }[];
  /** Visible combinations using each glaze (a combination counts once). */
  usage: ReadonlyMap<string, number>;
  /** "Missing at most one glaze" is in effect: only with I can make now. */
  almost: boolean;
  /**
   * For I can make now: combinations matching the search, tags and glaze that miss exactly one
   * glaze, so the step and the empty state can say what it would add.
   */
  oneMissing: number;
}

export interface ExploreInput {
  glazes: Glaze[];
  combinations: Combination[];
  /** `glazes` by ID, kept per listing change: search keeps its text only while it is the same map. Built here when omitted. */
  glazesById?: ReadonlyMap<string, Glaze>;
  /** Built once per listing change (`buildTagIndex`), not per keystroke. */
  glazeIndex: TagIndex;
  combinationIndex: TagIndex;
  filters: Pick<DiscoverFilters, 'q' | 'tags' | 'glaze' | 'quick' | 'almost' | 'stock' | 'sort' | 'cone' | 'atmosphere'> & {
    type?: ExploreType;
  };
  /** The account's favourites; null for guests, whose favourites filter has nothing to apply. */
  favorites: Favorites | null;
  /** Public totals, separate from the account's own favourites. Missing/offline older data counts as zero. */
  favoriteCounts?: FavoriteCounts;
  /** Shelf entries of the account and its clubs. */
  stock: (Pick<StockItem, 'glazeId' | 'quantityG'> & Partial<Pick<StockItem, 'clubId'>>)[];
  /** Shared glazes of accepted buddies, only when included in the availability scope. */
  buddyHolders?: BuddyHolders;
  /** Include club stock in Available to me and I can make now. Personal stock is always included. */
  includeClubs?: boolean;
  /** Allow opening the scope controls even when the current sources have no stock. */
  hasSharedSources?: boolean;
  /** The time "New" counts back from, in milliseconds; the current time when omitted. */
  now?: number;
}

/** Whether the final-firing filters (cone, atmosphere) apply: they concern combinations only. */
export function firingApplies(type?: ExploreType): boolean {
  return type !== 'glazes';
}

/**
 * The type the list is narrowed to: the chosen one, else combinations while a final-firing filter
 * is set (it leaves the glazes out of All, like a combination-only quick view).
 */
export function effectiveType(filters: Pick<DiscoverFilters, 'cone' | 'atmosphere'> & { type?: ExploreType }): ExploreType | undefined {
  return filters.type ?? (filters.cone || filters.atmosphere ? 'combinations' : undefined);
}

/** Whether a combination's final firing matches the cone and atmosphere filters (exact values). */
export function matchesFiring(combination: Pick<Combination, 'cone' | 'atmosphere'>, filters: Pick<DiscoverFilters, 'cone' | 'atmosphere'>): boolean {
  return (!filters.cone || combination.cone === filters.cone) && (!filters.atmosphere || combination.atmosphere === filters.atmosphere);
}

/**
 * The link with a final-firing filter set or removed (`undefined`). Like the glaze filter, it drops
 * "On my shelf", which lists glazes only.
 */
export function firingRoute(route: DiscoverRoute, changes: Pick<DiscoverFilters, 'cone' | 'atmosphere'>): DiscoverRoute {
  const next: DiscoverRoute = { ...route, ...changes };
  if (!next.cone) delete next.cone;
  if (!next.atmosphere) delete next.atmosphere;
  if (!quickApplies(next.quick, effectiveType(next))) {
    delete next.quick;
    delete next.stock;
    delete next.clubs;
    delete next.buddies;
  }
  return next;
}

/**
 * The mixed list's link for a type; a quick view that concerns the other type goes, and so do the
 * final-firing filters for Glazes.
 */
export function typeRoute(route: DiscoverRoute, type?: ExploreType): DiscoverRoute {
  const { type: _, ...rest } = route;
  const next: DiscoverRoute = type ? { ...rest, type } : rest;
  if (!firingApplies(type)) {
    delete next.cone;
    delete next.atmosphere;
  }
  if (!quickApplies(next.quick, effectiveType(next))) {
    delete next.quick;
    delete next.almost;
    delete next.stock;
    delete next.clubs;
    delete next.buddies;
  }
  const sort = explicitSort(next.sort, type);
  if (sort) next.sort = sort;
  else delete next.sort;
  return next;
}

/** The link for a quick view (All leaves it out); search, tags, glaze and type stay, a step goes. */
export function quickRoute(route: DiscoverRoute, view: QuickView): DiscoverRoute {
  const { quick: _, almost: __, ...rest } = withoutShelfOptions(route);
  return view === 'all'
    ? rest
    : {
        ...rest,
        quick: view,
        ...((view === 'available' || view === 'canMake') && (route.quick === 'available' || route.quick === 'canMake')
          ? { clubs: route.clubs, buddies: route.buddies }
          : {}),
      };
}

/** The link that chooses the part of the shelf "On my shelf" lists (in stock, the default, leaves it out). */
export function shelfStockRoute(route: DiscoverRoute, choice: ShelfStock): DiscoverRoute {
  const { stock: _, ...rest } = route;
  return choice === 'stock' ? rest : { ...rest, quick: 'shelf', stock: choice };
}

/** The link that sets "Include club glazes" or "Include buddies' glazes" for the availability views (an explicit value, so the link wins over the remembered choice). */
export function shelfOptionRoute(route: DiscoverRoute, change: { clubs: boolean } | { buddies: boolean }): DiscoverRoute {
  return { ...route, quick: route.quick === 'canMake' ? 'canMake' : 'available', ...change };
}

/** The link that adds or removes "missing at most one glaze" (a step of I can make now). */
export function almostRoute(route: DiscoverRoute, on: boolean): DiscoverRoute {
  const { almost: _, stock: __, ...rest } = route;
  return on ? { ...rest, quick: 'canMake', almost: true } : rest;
}

/**
 * Explore filtered by one glaze and its combinations on the current route, the glaze card first (the Glazes type has no
 * use, so it goes to All; "On my shelf" would hide the combinations, so it goes). Only the barcode-scan result uses it:
 * the glaze card is the point there. A link that states a number of combinations is `combinationsOfGlazeRoute`.
 */
export function glazeCombinationsRoute(route: DiscoverRoute, glazeId: string): DiscoverRoute {
  const next = typeRoute({ ...route, glaze: glazeId }, route.type === 'glazes' ? undefined : route.type);
  if (next.quick === 'shelf' || next.quick === 'available') {
    delete next.quick;
    delete next.stock;
    delete next.clubs;
    delete next.buddies;
  }
  return next;
}

/**
 * Exactly the combinations of one glaze under the Combinations type, whatever Explore shows now: the number a link states
 * (`glazeUsage`: the glaze page's "See all", a glaze row's "N combinations") is the number the list heading shows.
 */
export function combinationsOfGlazeRoute(glazeId: string): DiscoverRoute {
  return { name: 'discover', type: 'combinations', glaze: glazeId };
}

/** The shelves behind "I can make now": the account's own and each club's, with something on them. */
export function shelfSources(stock: Pick<StockItem, 'quantityG' | 'clubId' | 'clubName'>[]): {
  personal: boolean;
  clubs: string[];
} {
  const filled = stock.filter((item) => item.quantityG > 0);
  const clubs = new Map<string, string>();
  for (const item of filled) if (item.clubId) clubs.set(item.clubId, item.clubName ?? '');
  return {
    personal: filled.some((item) => !item.clubId),
    clubs: [...clubs.values()].filter(Boolean).sort(compareText),
  };
}

/** A glaze's photos are its own; a combination's are those of its listing. */
export function hasPhoto(entry: ExploreItem): boolean {
  return hasResultPhoto(entry.item.images ?? []);
}

/** Defer empty previews during discovery; explicit lookups and personal views keep their complete results. */
export function photoBrowse(
  items: ExploreItem[],
  filters: Pick<DiscoverFilters, 'q' | 'glaze'>,
  quick: QuickView,
  revealed = false,
): {
  items: ExploreItem[];
  deferred: number;
} {
  if (filters.q?.trim() || filters.glaze || (quick !== 'all' && quick !== 'new')) return { items, deferred: 0 };
  const pictured: ExploreItem[] = [];
  const without: ExploreItem[] = [];
  for (const item of items) (hasPhoto(item) ? pictured : without).push(item);
  return { items: revealed ? [...pictured, ...without] : pictured, deferred: revealed ? 0 : without.length };
}

/**
 * The author's own drafts are listed only under Mine (and in Studio); every other list, count and
 * glaze rule uses the published combinations.
 */
export function published<T extends { draft?: boolean }>(combinations: readonly T[]): T[] {
  return combinations.filter((combination) => !combination.draft);
}

/**
 * Nothing of the shown types exists yet, as opposed to nothing matching the filters. The author's
 * own drafts are no library content: an account with only a draft still sees the empty-library text.
 */
export function isLibraryEmpty(type: ExploreType | undefined, glazes: readonly unknown[], combinations: readonly { draft?: boolean }[]): boolean {
  const noCombinations = !published(combinations).length;
  return type === 'glazes' ? !glazes.length : type === 'combinations' ? noCombinations : !glazes.length && noCombinations;
}

/** The account's own published combinations that no visible photo shows yet (drafts take none). */
export function isWaiting(combination: Pick<Combination, 'own' | 'images'> & { draft?: boolean }): boolean {
  return combination.own && !combination.draft && !hasResultPhoto(combination.images ?? []);
}

/** The shared glaze library needs a result photo, even when a packaging photo is already present. */
export function isWaitingGlaze(glaze: Pick<Glaze, 'images'>): boolean {
  return !hasResultPhoto(glaze.images ?? []);
}

/** Listed within the last `newDays` days (`listedTime`); an unknown date (older listings) never counts. */
export function isNew(listed: number | null, now: number): boolean {
  return listed !== null && listed >= now - newDays * 86_400_000;
}

/** A quick view as a bit of a row's set of views. On my shelf has one bit per part of the shelf (`partBit`); a combination never has them. */
const viewBit: Record<QuickView, number> = {
  all: 1,
  favourites: 2,
  mine: 4,
  waiting: 8,
  new: 16,
  available: 32,
  canMake: 64,
  shelf: 0,
};
const partBit: Record<ShelfStock, number> = { stock: 128, used: 256, all: 512 };
/** Not a view: a listed combination that lacks exactly one glaze. */
const ONE_MISSING = 1024;
const ROW_VIEWS = 2048;

/**
 * Explore's one list. One search, one tag selection and one glaze filter apply to both kinds: a
 * glaze filter keeps the combinations with a step of that glaze and the glaze itself. One quick view
 * narrows the list further (signed in only): Favourites (both kinds), Mine (own combinations, the
 * only view that shows the author's drafts), Waiting for photos (glazes and own combinations without a
 * result photo), New (both kinds, listed in the last
 * `newDays` days), On my shelf (glazes with more than 0 g on the account's personal shelf, plus the clubs' and the buddies' with their options; `stock` chooses the used up ones or both instead) and
 * I can make now (combinations whose glaze steps are all on a shelf; none without glaze steps; with `almost`, also those missing one glaze). The final-firing filters (cone,
 * atmosphere; not for Glazes) keep the combinations fired that way and leave the glazes out of All,
 * so a glaze-only view does not apply then. A view that concerns one type leaves the other out of
 * All and is ignored for the other type's own list (`activeQuick`). Counts describe what each
 * type's link shows, and each chip's count what choosing it would list.
 */
export function explore(input: ExploreInput): ExploreResult {
  const { filters, favorites, glazes, combinations } = input;
  const tags = filters.tags ?? [];
  const signedIn = favorites !== null;
  const firing = firingApplies(filters.type) ? { cone: filters.cone, atmosphere: filters.atmosphere } : {};
  /** All with a final-firing filter lists combinations only, so glaze-only views do not apply. */
  const narrowed = effectiveType({ ...firing, type: filters.type });
  const quick = activeQuick(filters.quick, narrowed, signedIn);
  const almost = quick === 'canMake' && !!filters.almost;
  const glazesById = input.glazesById ?? glazeMap(glazes);
  // Personal stock state never depends on access to someone else's glaze.
  const personal = shelfScope(input.stock, { entries: quick === 'shelf' });
  const available = shelfScope(input.stock, { clubs: input.includeClubs, buddies: input.buddyHolders?.keys() });
  const shelfStock: ShelfStock = quick === 'shelf' ? (filters.stock ?? 'stock') : 'stock';
  const onShelf = (id: string, part: ShelfStock) =>
    part === 'stock' ? personal.stock.has(id) : part === 'all' ? personal.entries.has(id) : personal.entries.has(id) && !personal.stock.has(id);
  const makeableIds = available.stock;
  const now = input.now ?? Date.now();

  const listing = listingOf(glazes, combinations);
  const { usage } = listing;
  const matches = matchesOf(listing, {
    glazes,
    combinations,
    glazesById,
    glazeIndex: input.glazeIndex,
    combinationIndex: input.combinationIndex,
    q: filters.q ?? '',
    tags,
    glaze: filters.glaze,
  });
  const missing = missingGlazes(listing, makeableIds);
  const firingFiltered = !!(firing.cone || firing.atmosphere);
  const firedRows = firingFiltered ? matches.combinationRows.filter(({ item }) => matchesFiring(item, firing)) : matches.combinationRows;
  const favouriteGlazes = new Set(favorites?.glazeIds);
  const favouriteCombinations = new Set(favorites?.combinationIds);
  const missingAllowed = almost ? 1 : 0;

  /** One pass per list instead of one per view: each row's views as bits, and how many rows have each set of views. */
  const views = new Uint16Array(glazes.length + combinations.length);
  const glazeTally = new Int32Array(ROW_VIEWS);
  const combinationTally = new Int32Array(ROW_VIEWS);
  for (const { position, item, listed } of matches.glazeRows) {
    const { id } = item;
    const set =
      viewBit.all |
      (favouriteGlazes.has(id) ? viewBit.favourites : 0) |
      (isWaitingGlaze(item) ? viewBit.waiting : 0) |
      (isNew(listed, now) ? viewBit.new : 0) |
      (available.stock.has(id) ? viewBit.available : 0) |
      (onShelf(id, 'stock') ? partBit.stock : 0) |
      (onShelf(id, 'used') ? partBit.used : 0) |
      (onShelf(id, 'all') ? partBit.all : 0);
    views[position] = set;
    glazeTally[set]++;
  }
  for (const { position, item, listed, glazeIds } of firedRows) {
    const lacking = missing[position];
    const set = item.draft
      ? 0
      : viewBit.all |
        (favouriteCombinations.has(item.id) ? viewBit.favourites : 0) |
        (isWaiting(item) ? viewBit.waiting : 0) |
        (isNew(listed, now) ? viewBit.new : 0) |
        (glazeIds.size > 0 && lacking <= missingAllowed ? viewBit.canMake : 0) |
        (lacking === 1 ? ONE_MISSING : 0);
    views[position] = set | (item.own ? viewBit.mine : 0);
    combinationTally[views[position]]++;
  }

  const count = (tally: Int32Array, bit: number) => {
    let sum = 0;
    for (let set = 0; set < ROW_VIEWS; set++) if (set & bit) sum += tally[set];
    return sum;
  };
  /** What the view lists of each kind, for All (no type) or one type. */
  const listsGlazes = (view: QuickView, type?: ExploreType) =>
    !(type === 'combinations' || scopeOf(view) === 'combinations' || (firingFiltered && type !== 'glazes'));
  const listsCombinations = (view: QuickView, type?: ExploreType) => !(type === 'glazes' || scopeOf(view) === 'glazes');
  const bitOf = (view: QuickView) => (view === 'shelf' ? partBit[shelfStock] : viewBit[view]);
  const size = (view: QuickView, type?: ExploreType) =>
    (listsGlazes(view, type) ? count(glazeTally, bitOf(view)) : 0) + (listsCombinations(view, type) ? count(combinationTally, viewBit[view]) : 0);
  /** A type's own link drops a quick view that concerns the other type. */
  const forType = (type: ExploreType) => (quickApplies(quick, type) ? quick : 'all');

  const counts: ExploreCounts = {
    all: size(quick),
    combinations: size(forType('combinations'), 'combinations'),
    glazes: size(forType('glazes'), 'glazes'),
  };
  const chips = signedIn
    ? chipViews
        .filter((view) => quickApplies(view, narrowed))
        .map((view): QuickChip => ({
          view,
          count: size(view, filters.type),
          ...(view === 'canMake' && !makeableIds.size && !input.hasSharedSources && quick !== 'canMake' && { reason: 'noShelf' }),
        }))
    : [];

  const shownBit = bitOf(quick);
  const rows: Row[] = [
    ...(listsGlazes(quick, filters.type) ? matches.glazeRows.filter(({ position }) => views[position] & shownBit) : []),
    ...(listsCombinations(quick, filters.type) ? firedRows.filter(({ position }) => views[position] & viewBit[quick]) : []),
  ];
  const sort = activeSort(filters.sort, filters.type);
  let items: ExploreItem[];
  if (sort === 'used') items = inOrder(listing, rows, 'newest', ({ item }) => usage.get(item.id) ?? 0);
  else if (sort === 'favourites') {
    const totals = { glaze: new Map<string, number>(), combination: new Map<string, number>() };
    for (const row of input.favoriteCounts?.glazes ?? []) totals.glaze.set(row.id, row.count);
    for (const row of input.favoriteCounts?.combinations ?? []) totals.combination.set(row.id, row.count);
    items = inOrder(listing, rows, 'newest', ({ entry, item }) => totals[entry.kind].get(item.id) ?? 0);
  } else items = inOrder(listing, rows, listingOrder(sort));
  return {
    items,
    counts,
    quick,
    chips,
    tagCounts: tagCountsOf(listing, rows),
    usage,
    almost,
    shelfStock,
    shelfChoices:
      quick === 'shelf'
        ? (['stock', 'used', 'all'] as const).map((choice) => ({ choice, count: listsGlazes('shelf', filters.type) ? count(glazeTally, partBit[choice]) : 0 }))
        : [],
    oneMissing: count(combinationTally, ONE_MISSING),
  };
}
