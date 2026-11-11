import { instantTime } from '../api/instant';
import type { Combination, Glaze } from '../api/models';
import { filterCombinations, filterGlazes, glazeCode, glazeMap, idleSlices } from '../glazes/glazes';
import { glazeIdsOf } from '../glazes/steps';
import { buildTagIndex, filterByTags, type TagCount, type TagIndex } from '../tags/tags';
import type { Sort } from '../routing/routes';
import type { ExploreItem } from './explore';

/*
 * What Explore derives from the listing alone, kept per pair of listing arrays: a change to a listing replaces the arrays
 * and the changed items, it never edits them, so nothing here needs a check beyond the arrays' identity. What depends on
 * the account (stock, buddies, favourites) stays out of the rows: `explore` applies it in passes over them that compare
 * no text or date and allocate little. The search, tags and glaze filter keep their last result (`matchesOf`) and a
 * shelf scope its count per combination (`missingGlazes`).
 */

export type Dated = { createdAt?: string | null; publishedAt?: string | null };

/**
 * The date an entry is listed from: a combination from its publication (a draft published weeks
 * later is new then), everything else, and listings saved before publication dates, from creation.
 */
export function listedAt(item: Dated): string | null | undefined {
  return item.publishedAt || item.createdAt;
}

const listedTimes = new WeakMap<Dated, number | null>();

/** `listedAt` in milliseconds (`instantTime`), null when unknown. Parsed once per item: a change to a listing replaces its items, it never edits them. */
export function listedTime(item: Dated): number | null {
  let listed = listedTimes.get(item);
  if (listed === undefined) {
    listed = instantTime(listedAt(item));
    listedTimes.set(item, listed);
  }
  return listed;
}

function compareTimes(x: number | null, y: number | null): number {
  if (x === y) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return y - x;
}

/** Newest first by `listedAt`; an unknown time (older saved listings) comes last. */
export function newestFirst(a: Dated, b: Dated): number {
  return compareTimes(listedTime(a), listedTime(b));
}

/** One shared collator: `localeCompare` with a locale or options builds a new one per comparison. */
export const compareText = new Intl.Collator('en', { sensitivity: 'base' }).compare;

/** An item of the listing with what its orders and filters read, made once per listing. */
export interface Row<T extends Glaze | Combination = Glaze | Combination> {
  /** Its place among all rows, glazes first: what `ranks` and `missingGlazes` index. */
  position: number;
  entry: ExploreItem;
  item: T;
  /** Title or display code. */
  text: string;
  listed: number | null;
}

export interface CombinationRow extends Row<Combination> {
  glazeIds: ReadonlySet<string>;
}

/** The two orders of the whole listing every sort reduces to: a filter reads them instead of comparing anything. */
export type ListingOrder = 'newest' | 'az';

/** An order under way; `sorted` is set once its steps ran out. */
interface Ordering {
  steps: Generator<void, Row[]>;
  sorted?: { rows: Row[]; ranks: Int32Array };
}

export interface Listing {
  glazes: Row<Glaze>[];
  combinations: CombinationRow[];
  /** Published combinations in which each glaze has a glaze step (`glazeUsage`). */
  usage: ReadonlyMap<string, number>;
  /** The glaze array these rows belong to; the cache's key holds the combination array. */
  source: readonly Glaze[];
  orders: Record<ListingOrder, Ordering>;
  /** The last scopes of `missingGlazes`, latest first. */
  scopes: { scope: ReadonlySet<string>; missing: Uint16Array }[];
  /** The last result of `matchesOf`. */
  matches?: Matches;
  /** The row of each item, for what a filter kept; made with the first filter. */
  rowOf?: Map<Glaze | Combination, Row>;
  /** Every tag of the listing in `countTags`' tie order, and per row position the tags as places in it. */
  tags?: { names: string[]; byRow: number[][] };
}

/** What `matchesOf` reads. */
export interface MatchInput {
  glazes: Glaze[];
  combinations: Combination[];
  glazesById: ReadonlyMap<string, Glaze>;
  glazeIndex: TagIndex;
  combinationIndex: TagIndex;
  q: string;
  tags: string[];
  glaze: string | undefined;
}

/** What the search, tags and glaze filter let through. */
export interface Matches extends MatchInput {
  glazeRows: Row<Glaze>[];
  combinationRows: CombinationRow[];
}

/** Kind, then title or display code, then ID: ties never depend on the listing order. */
function compareIdentity(a: Row, b: Row): number {
  if (a.entry.kind !== b.entry.kind) return a.entry.kind === 'combination' ? -1 : 1;
  return compareText(a.text, b.text) || compareText(a.item.id, b.item.id);
}

const byNewest = (a: Row, b: Row) => compareTimes(a.listed, b.listed) || compareIdentity(a, b);
const byText = (a: Row, b: Row) => compareText(a.text, b.text) || compareIdentity(a, b);

/** Merged items between two pauses of `mergeSort`: well below a long task, on the slowest phones too. */
const SORT_STEP = 2048;

/** A stable bottom-up merge sort that can pause, also inside one merge, so an order of the whole listing fits into idle slices. */
export function* mergeSort<T>(items: readonly T[], compare: (a: T, b: T) => number): Generator<void, T[]> {
  let from = [...items];
  let to = new Array<T>(items.length);
  let merged = 0;
  for (let width = 1; width < items.length; width *= 2) {
    for (let start = 0; start < items.length; start += 2 * width) {
      const middle = Math.min(start + width, items.length);
      const end = Math.min(start + 2 * width, items.length);
      let left = start;
      let right = middle;
      for (let at = start; at < end; at++) {
        to[at] = right >= end || (left < middle && compare(from[left], from[right]) <= 0) ? from[left++] : from[right++];
        if (++merged >= SORT_STEP) {
          merged = 0;
          yield;
        }
      }
    }
    [from, to] = [to, from];
  }
  return from;
}

/** Advances an order by one step; true once it is complete. */
function advance(ordering: Ordering): boolean {
  if (ordering.sorted) return true;
  const step = ordering.steps.next();
  if (!step.done) return false;
  const ranks = new Int32Array(step.value.length);
  step.value.forEach((row, rank) => (ranks[row.position] = rank));
  ordering.sorted = { rows: step.value, ranks };
  return true;
}

function sortedBy(listing: Listing, order: ListingOrder): NonNullable<Ordering['sorted']> {
  const ordering = listing.orders[order];
  while (!advance(ordering));
  return ordering.sorted!;
}

/**
 * Published combinations in which each glaze has a glaze step; a combination using a glaze twice
 * counts once. The author's own drafts do not count.
 */
export function glazeUsage(combinations: readonly (Pick<Combination, 'steps'> & { draft?: boolean })[]): Map<string, number> {
  const usage = new Map<string, number>();
  for (const combination of combinations) if (!combination.draft) for (const id of glazeIdsOf(combination)) usage.set(id, (usage.get(id) ?? 0) + 1);
  return usage;
}

const listings = new WeakMap<readonly Combination[], Listing>();

/** The rows of a pair of listing arrays, made once. */
export function listingOf(glazes: readonly Glaze[], combinations: readonly Combination[]): Listing {
  const known = listings.get(combinations);
  if (known?.source === glazes) return known;
  const glazeRows = glazes.map((item, position): Row<Glaze> => ({
    position,
    entry: { kind: 'glaze', item },
    item,
    text: glazeCode(item),
    listed: listedTime(item),
  }));
  const combinationRows = combinations.map((item, index): CombinationRow => ({
    position: glazes.length + index,
    entry: { kind: 'combination', item },
    item,
    text: item.title,
    listed: listedTime(item),
    glazeIds: glazeIdsOf(item),
  }));
  const rows = [...glazeRows, ...combinationRows];
  const listing: Listing = {
    glazes: glazeRows,
    combinations: combinationRows,
    usage: glazeUsage(combinations),
    source: glazes,
    orders: { newest: { steps: mergeSort(rows, byNewest) }, az: { steps: mergeSort(rows, byText) } },
    scopes: [],
  };
  listings.set(combinations, listing);
  return listing;
}

/**
 * The entries of `rows` in a listing order, or by `score` first (highest on top) and the order within a score. Only ranks are
 * read, so a change of filter or sort compares no title or date: without a score a walk over the order, with one a native
 * sort of whole numbers.
 */
export function inOrder(listing: Listing, rows: Row[], order: ListingOrder, score?: (row: Row) => number): ExploreItem[] {
  const { rows: sorted, ranks } = sortedBy(listing, order);
  const entries = new Array<ExploreItem>(rows.length);
  if (score) {
    const scores = rows.map(score);
    const top = scores.reduce((highest, value) => Math.max(highest, value), 0);
    const keys = Float64Array.from(rows, (row, at) => (top - scores[at]) * sorted.length + ranks[row.position]).sort();
    for (let at = 0; at < rows.length; at++) entries[at] = sorted[keys[at] % sorted.length].entry;
  } else {
    const chosen = new Uint8Array(sorted.length);
    for (const row of rows) chosen[ranks[row.position]] = 1;
    let at = 0;
    for (let rank = 0; rank < sorted.length; rank++) if (chosen[rank]) entries[at++] = sorted[rank].entry;
  }
  return entries;
}

function kept<T extends Glaze | Combination, R extends Row<T>>(listing: Listing, found: T[], all: T[], rows: R[]): R[] {
  if (found === all) return rows;
  const rowOf = (listing.rowOf ??= new Map<Glaze | Combination, Row>([...listing.glazes, ...listing.combinations].map((row) => [row.item, row])));
  return found.map((item) => rowOf.get(item) as R);
}

/**
 * What the search, tags and glaze filter let through. The last answer stands while they stay the same: a chip or a sort
 * changes none of them. The rows keep the search's order; what is listed takes its order from `inOrder`.
 */
export function matchesOf(listing: Listing, input: MatchInput): Matches {
  const { glazes, combinations, glazesById, glazeIndex, combinationIndex, q, tags, glaze } = input;
  const last = listing.matches;
  if (
    last?.q === q &&
    last.glaze === glaze &&
    last.tags.length === tags.length &&
    last.tags.every((tag, at) => tag === tags[at]) &&
    last.glazesById === glazesById &&
    last.glazeIndex === glazeIndex &&
    last.combinationIndex === combinationIndex
  )
    return last;
  const glazeRows = kept(listing, filterGlazes(filterByTags(glazes, glazeIndex, tags), q, { notes: true }), glazes, listing.glazes);
  const combinationRows = kept(
    listing,
    filterCombinations(filterByTags(combinations, combinationIndex, tags), q, glazesById),
    combinations,
    listing.combinations,
  );
  return (listing.matches = {
    ...input,
    glazeRows: glaze ? glazeRows.filter((row) => row.item.id === glaze) : glazeRows,
    combinationRows: glaze ? combinationRows.filter((row) => row.glazeIds.has(glaze)) : combinationRows,
  });
}

function tagsOf(listing: Listing): NonNullable<Listing['tags']> {
  if (listing.tags) return listing.tags;
  const rows = [...listing.glazes, ...listing.combinations];
  const names = [...new Set(rows.flatMap((row) => row.item.tags))].sort((a, b) => a.localeCompare(b));
  const places = new Map(names.map((name, place) => [name, place]));
  return (listing.tags = { names, byRow: rows.map((row) => row.item.tags.map((tag) => places.get(tag)!)) });
}

/** `countTags` over rows of the listing: tags are numbers here, and only the tags that occur are sorted. */
export function tagCountsOf(listing: Listing, rows: readonly Row[]): TagCount[] {
  const { names, byRow } = tagsOf(listing);
  const counts = new Int32Array(names.length);
  for (const row of rows) for (const place of byRow[row.position]) counts[place]++;
  const used: TagCount[] = [];
  for (let place = 0; place < names.length; place++) if (counts[place]) used.push({ tag: names[place], count: counts[place] });
  return used.sort((a, b) => b.count - a.count);
}

/** How many scopes `missingGlazes` keeps: all four of Include club glazes and Include buddies on and off. */
const KEPT_SCOPES = 4;

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

/** Per row position, how many of a combination's glazes the scope lacks (as `shelfMatch` counts). Scopes are compared by content: a new set of the same glazes costs no pass. */
export function missingGlazes(listing: Listing, scope: ReadonlySet<string>): Uint16Array {
  const at = listing.scopes.findIndex((known) => sameSet(known.scope, scope));
  if (at >= 0) {
    const [known] = listing.scopes.splice(at, 1);
    listing.scopes.unshift(known);
    return known.missing;
  }
  const missing = new Uint16Array(listing.glazes.length + listing.combinations.length);
  for (const { position, glazeIds } of listing.combinations) {
    let count = 0;
    for (const id of glazeIds) if (!scope.has(id)) count++;
    missing[position] = count;
  }
  listing.scopes.unshift({ scope, missing });
  listing.scopes.length = Math.min(listing.scopes.length, KEPT_SCOPES);
  return missing;
}

const nextTask = () => new Promise((resolve) => setTimeout(resolve));

/** The longest task of the A-Z sort `warmListing` makes ahead of a patch: below a long task. */
const WARM_TASK_MS = 40;

/** The listing order an explicit sort reads: A-Z its own, every other one the newest order (scores aside). */
export function listingOrder(sort: Sort): ListingOrder {
  return sort === 'az' ? 'az' : 'newest';
}

/**
 * Makes what Explore's next derivation of a new listing would otherwise make in the task that shows it (rows, the default
 * order, tags, maps, and the A-Z order when the route asks for it, in tasks of at most `WARM_TASK_MS`), in tasks of its own
 * and ending a task later, so a changed delta stays below a long task on a slow phone.
 */
export async function warmListing(glazes: readonly Glaze[], combinations: readonly Combination[], order: ListingOrder = 'newest') {
  await nextTask();
  const listing = listingOf(glazes, combinations);
  sortedBy(listing, 'newest');
  if (order === 'az') {
    await nextTask();
    let end = performance.now() + WARM_TASK_MS;
    while (!advance(listing.orders.az))
      if (performance.now() >= end) {
        await nextTask();
        end = performance.now() + WARM_TASK_MS;
      }
  }
  await nextTask();
  tagsOf(listing);
  glazeMap(glazes);
  buildTagIndex(glazes);
  buildTagIndex(combinations);
  await nextTask();
}

/** Sorts the listing A-Z in idle slices ahead of its first use, which would otherwise take one long task. Answers its cancel. */
export function warmOrder(glazes: readonly Glaze[], combinations: readonly Combination[]): () => void {
  const { az } = listingOf(glazes, combinations).orders;
  return idleSlices(() => advance(az));
}
