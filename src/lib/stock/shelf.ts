import type { Club, Combination, Glaze, StockItem } from '../api/models';
import type { StockAddInput, StockInput, StockWrite } from '../api/inputs';
import { filterGlazes, glazeCode, stepTitle } from '../glazes/glazes';
import { glazeStepsOf, type GlazeStep } from '../glazes/steps';

/** IDs of the glazes with more than 0 g on the account's or a club's shelf. */
export function shelfGlazeIds(stock: Pick<StockItem, 'glazeId' | 'quantityG'>[]): Set<string> {
  return new Set(stock.filter((item) => item.quantityG > 0).map((item) => item.glazeId));
}

/** IDs of the glazes with an entry on the account's or a club's shelf, used up or not. */
export function shelfEntryIds(stock: Pick<StockItem, 'glazeId'>[]): Set<string> {
  return new Set(stock.map((item) => item.glazeId));
}

/**
 * A stock scope: the personal shelf, plus the club shelves with `clubs`, plus the glazes the buddies have
 * (`buddies`: the glaze IDs of `buddyHolders`, in stock by definition: buddies share nothing used up). `stock` holds the glazes
 * in stock, `entries` every glaze with an entry, used up or not, so "used up" is an entry that is not in stock. The sets
 * are built from the (small) stock list only; `entries` is skipped unless asked for. Personal Used up must use a scope without clubs or buddies.
 */
export function shelfScope(
  stock: (Pick<StockItem, 'glazeId' | 'quantityG'> & Partial<Pick<StockItem, 'clubId'>>)[],
  options: { clubs?: boolean; buddies?: Iterable<string>; entries?: boolean },
): { stock: Set<string>; entries: Set<string> } {
  const covered = options.clubs ? stock : stock.filter((item) => !item.clubId);
  const inStock = shelfGlazeIds(covered);
  const entries = options.entries ? shelfEntryIds(covered) : inStock;
  for (const id of options.buddies ?? []) {
    inStock.add(id);
    entries.add(id);
  }
  return { stock: inStock, entries };
}

/**
 * The glazes to compare combinations with, or undefined for an account that has no stock at all
 * (guests, new accounts): shelf lines and marks only make sense once something was stocked, even
 * when it is all used up.
 */
export function shelfToCompare(stock: Pick<StockItem, 'glazeId' | 'quantityG'>[]): Set<string> | undefined {
  return stock.length ? shelfGlazeIds(stock) : undefined;
}

/** What a shelf covers of a combination's glazes. */
export interface ShelfMatch {
  /** Different glazes the glaze steps apply; 0 for a combination without glaze steps. */
  total: number;
  /** How many of them are on the shelf. */
  have: number;
  /** The glazes that are not, as the first glaze step of each, in step order. */
  missing: GlazeStep[];
}

/**
 * Compares a combination's glazes with the shelf. Only glaze steps count: custom steps (firings,
 * say) need no glaze, and a glaze used in two steps counts once.
 */
export function shelfMatch(combination: Pick<Combination, 'steps'>, owned: ReadonlySet<string>): ShelfMatch {
  const first = new Map<string, GlazeStep>();
  for (const step of glazeStepsOf(combination)) if (!first.has(step.glazeId)) first.set(step.glazeId, step);
  const missing = [...first.values()].filter((step) => !owned.has(step.glazeId));
  return { total: first.size, have: first.size - missing.length, missing };
}

/** The glazes a shelf lacks as shown on a combination: the first `limit` by name, and how many more there are. */
export function missingSummary(missing: GlazeStep[], glazes: ReadonlyMap<string, Glaze>, limit = 2): { names: string[]; more: number } {
  const names = missing.slice(0, limit).map((step) => {
    const glaze = glazes.get(step.glazeId);
    return glaze ? glazeCode(glaze) : stepTitle(glazes, step);
  });
  return { names, more: missing.length - names.length };
}

/* The shelf as a list of entries (glaze x owner): grouping, used up, jars and the stock form. */

/** The shelf list offers a filter field from this many entries. */
export const SHELF_FILTER_FROM = 10;
/** Rows a shelf list renders at once, more than fill a phone's screen; the rest follow while the page is idle (`ShelfList`). */
export const SHELF_FIRST_ROWS = 12;
/** Largest amount and jar size the shelf accepts (the API caps jar sizes at 100000 g). */
export const MAX_STOCK_G = 1_000_000_000;
export const MAX_JAR_G = 100_000;
/**
 * One common jar of glaze: the amount every form that starts a new shelf entry is filled with (stock form, scan sheet,
 * glaze page, add-glaze dialog; it stays editable and is not typed input), and the one-click jar.
 */
export const DEFAULT_JAR_G = 250;

/** The owner of a stock entry as the form's select value: "personal" or the club's ID. */
export const ownerOf = (item: Pick<StockItem, 'clubId'>): string => item.clubId ?? 'personal';

/** Nothing left of it: the entry is kept for its jar size and as a reorder reminder. */
export const isUsedUp = (item: Pick<StockItem, 'quantityG'>): boolean => item.quantityG <= 0;

/** One owner's part of the shelf: entries in stock and, apart, the used up ones. */
export interface ShelfGroup {
  /** "personal" or the club's ID. */
  key: string;
  /** The club's name, or null for the account's own shelf. */
  clubName: string | null;
  items: StockItem[];
  usedUp: StockItem[];
  /** Used up entries of the whole group: the summary's count, also while only the first of them are shown (`firstRows`). */
  usedUpCount: number;
}

/** One shared collator, as `compareText`: `localeCompare` with options builds a new one per comparison. Numbers in order, the browser's language. */
const compareTitle = new Intl.Collator(undefined, { numeric: true }).compare;

/**
 * Entries grouped by owner: the account's own shelf first, then each club by name. Within a group,
 * entries are ordered by `titleOf` (the display code and name) and split into in stock and used up.
 */
export function groupShelf(stock: StockItem[], titleOf: (item: StockItem) => string): ShelfGroup[] {
  const groups = new Map<string, ShelfGroup>();
  for (const item of stock) {
    const key = ownerOf(item);
    const group = groups.get(key) ?? {
      key,
      clubName: item.clubId ? (item.clubName ?? '') : null,
      items: [],
      usedUp: [],
      usedUpCount: 0,
    };
    (isUsedUp(item) ? group.usedUp : group.items).push(item);
    groups.set(key, group);
  }
  const titles = new Map(stock.map((item) => [item.id, titleOf(item)]));
  const byTitle = (a: StockItem, b: StockItem) => compareTitle(titles.get(a.id)!, titles.get(b.id)!) || a.id.localeCompare(b.id);
  const sorted = [...groups.values()].sort((a, b) =>
    a.clubName === null ? -1 : b.clubName === null ? 1 : a.clubName.localeCompare(b.clubName) || a.key.localeCompare(b.key),
  );
  for (const group of sorted) {
    group.items.sort(byTitle);
    group.usedUp.sort(byTitle);
    group.usedUpCount = group.usedUp.length;
  }
  return sorted;
}

/**
 * How many rows `ShelfList` renders when the list goes from `before` rows to `count`. Fewer rows lower the limit, so more rows later
 * come in slices again. A list that was all on the page stays so when a few rows join: an entry saved or synced would otherwise
 * push the last rows out for a moment, and with them an open used up group and any focus in them.
 */
export function shelfRowLimit(limit: number, before: number, count: number): number {
  return count < limit || (limit >= before && count <= before + SHELF_FIRST_ROWS) ? Math.max(count, SHELF_FIRST_ROWS) : limit;
}

/** The rows of the groups, in stock and used up. */
export const shelfRowCount = (groups: readonly ShelfGroup[]): number => groups.reduce((count, group) => count + group.items.length + group.usedUp.length, 0);

/**
 * The first `limit` rows of the groups, in their order; what falls beyond is left out, so nothing above a later row moves when
 * it comes. A group's used up rows follow its rows in stock and arrive in slices like them (hundreds at once were a long task on a
 * slow phone), while `usedUpCount` keeps the summary's count whole. A group that fits stays the same object, and a part that fits
 * the same array, so rendering more rows looks at the unfinished group only.
 */
export function firstRows(groups: readonly ShelfGroup[], limit: number): ShelfGroup[] {
  const shown: ShelfGroup[] = [];
  let left = limit;
  for (const group of groups) {
    if (left <= 0) break;
    const rows = group.items.length + group.usedUp.length;
    if (rows <= left) shown.push(group);
    else {
      const usedUp = Math.max(0, left - group.items.length);
      shown.push({ ...group, items: usedUp ? group.items : group.items.slice(0, left), usedUp: group.usedUp.slice(0, usedUp) });
    }
    left -= rows;
  }
  return shown;
}

/**
 * The owner a link's `shelf` names: "personal" or the ID of a club the account belongs to. Anything
 * else (a club the account left or never had, a stale link) is all shelves, as is a missing value.
 */
export function shelfOwnerFor(shelf: string | undefined, clubs: readonly Pick<Club, 'id'>[]): string | undefined {
  if (!shelf) return undefined;
  return shelf === 'personal' || clubs.some((club) => club.id === shelf) ? shelf : undefined;
}

/** The club a write goes to ("personal" or a club's ID), or undefined for the personal shelf and a club the account left. */
export function targetClub<C extends Pick<Club, 'id'>>(owner: string, clubs: readonly C[]): C | undefined {
  return owner === 'personal' ? undefined : clubs.find((club) => club.id === owner);
}

/**
 * Where the shelf page's form writes before a glaze is chosen: the shown shelf, else (all shelves, or a club the
 * account left) the personal one. A club is never kept from an earlier chip.
 */
export function formOwnerFor(shown: string | undefined, clubs: readonly Pick<Club, 'id'>[]): string {
  return shown && (shown === 'personal' || clubs.some((club) => club.id === shown)) ? shown : 'personal';
}

/** The entries of one owner ("personal" or a club's ID), or all of them without an owner. */
export function filterByOwner(stock: StockItem[], owner: string | undefined): StockItem[] {
  return owner ? stock.filter((item) => ownerOf(item) === owner) : stock;
}

/** A choice of the shelf page's owner chips: `owner` is undefined for all shelves; `count` the entries in stock. */
export interface ShelfChoice {
  owner: string | undefined;
  /** The club's name; null for all shelves and the personal shelf (the caller words them). */
  clubName: string | null;
  count: number;
}

/**
 * The owner chips: all shelves, the personal shelf, then each club by name in the user's language
 * (numbers in order, case and accents ignored). Empty without a club, as there is nothing to choose.
 */
export function shelfChoices(stock: StockItem[], clubs: readonly Pick<Club, 'id' | 'name'>[], locale?: string): ShelfChoice[] {
  if (!clubs.length) return [];
  const inStock = stock.filter((item) => !isUsedUp(item));
  const count = (owner: string) => inStock.filter((item) => ownerOf(item) === owner).length;
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  const byName = [...clubs].sort((a, b) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id));
  return [
    { owner: undefined, clubName: null, count: inStock.length },
    { owner: 'personal', clubName: null, count: count('personal') },
    ...byName.map((club) => ({ owner: club.id, clubName: club.name, count: count(club.id) })),
  ];
}

/** The entries matching a typed filter in their code, manufacturer or name (as pickers match). */
export function filterShelf(stock: StockItem[], glazesById: ReadonlyMap<string, Glaze>, query: string): StockItem[] {
  if (!query.trim()) return stock;
  return stock.filter((item) => {
    const glaze = glazesById.get(item.glazeId) ?? {
      code: '',
      name: item.name,
      manufacturer: { name: item.manufacturer, shortId: '' },
    };
    return filterGlazes([glaze], query).length > 0;
  });
}

/** An amount or jar size typed or bound by a number input: a whole number from `min`, else null (text without a value is none, not 0 g). */
export function parseGrams(value: number | string | null | undefined, { min = 0, max = MAX_STOCK_G } = {}): number | null {
  const text = typeof value === 'string' ? value.trim() : value;
  if (text === null || text === undefined || text === '') return null;
  const grams = Number(text);
  return Number.isInteger(grams) && grams >= min && grams <= max ? grams : null;
}

/** The save for an entry: its glaze and owner with a new amount; `jarSizeG` left out keeps the entry's. */
export function stockInputFor(item: Pick<StockItem, 'glazeId' | 'clubId'>, quantityG: number, jarSizeG?: number | null): StockInput {
  return {
    glazeId: item.glazeId,
    quantityG,
    ownerType: item.clubId ? 'club' : 'personal',
    clubId: item.clubId,
    ...(jarSizeG ? { jarSizeG } : {}),
  };
}

/** Whether a shelf write adds grams to what the server holds (else it sets the amount). */
export const isAddition = (write: StockWrite): write is StockAddInput => 'addG' in write;

/**
 * The addition for an entry: `addG` grams more on its shelf. The server stores `jarSizeG` only on an entry without a
 * size (a new or recreated one included) and keeps a stored size (STOCK-2), unless `replaceJarSize` asks for the change.
 */
export function stockAddFor(item: Pick<StockItem, 'glazeId' | 'clubId'>, addG: number, jarSizeG?: number | null, replaceJarSize = false): StockAddInput {
  return {
    glazeId: item.glazeId,
    addG,
    ownerType: item.clubId ? 'club' : 'personal',
    clubId: item.clubId,
    ...(jarSizeG ? { jarSizeG } : {}),
    ...(jarSizeG && replaceJarSize ? { replaceJarSize: true } : {}),
  };
}

/** Whether an addition of jars of `jar` grams changes the jar size this device knows for the entry on purpose. */
export const changesJarSize = (entry: Pick<StockItem, 'jarSizeG'> | undefined, jar: number | null | undefined): boolean =>
  !!entry?.jarSizeG && !!jar && jar !== entry.jarSizeG;

/** "Used up": 0 g, whatever was left, without touching the jar size. */
export const usedUpInput = (item: StockItem): StockInput => stockInputFor(item, 0);

/**
 * "+1 jar": one jar added to what the server holds (never a total worked out from this device's copy, which may be
 * stale). `jarSizeG` is the size just asked for when the entry has none; without any size there is nothing to add, and
 * null comes back. The size always goes along: the server stores it only where its entry has none (a row another device
 * removed meanwhile is recreated with the size it showed), never over a stored one.
 */
export function oneJarInput(item: StockItem, jarSizeG?: number | null): StockAddInput | null {
  const jar = parseGrams(item.jarSizeG ?? jarSizeG, { min: 1, max: MAX_JAR_G });
  return jar === null ? null : stockAddFor(item, jar, jar);
}

/**
 * The listing after a save: the entry's new amount (and jar size, when the save carried one), or null
 * when the entry is not listed (a first save: the caller reloads for its names).
 */
export function withSavedStock(stock: StockItem[], id: string, input: Pick<StockInput, 'quantityG' | 'jarSizeG'>): StockItem[] | null {
  if (!stock.some((item) => item.id === id)) return null;
  // A size-only save (no amount) keeps the amount, which the server kept too.
  return stock.map((item) => (item.id === id ? { ...item, quantityG: input.quantityG ?? item.quantityG, jarSizeG: input.jarSizeG ?? item.jarSizeG } : item));
}

/** The listing after an addition: the entry as the server answered it (its total), or null when it is not listed (the caller reloads). */
export function withStockEntry(stock: StockItem[], entry: StockItem): StockItem[] | null {
  if (!stock.some((item) => item.id === entry.id)) return null;
  return stock.map((item) => (item.id === entry.id ? entry : item));
}

/** The entry an owner holds of a glaze, if any. */
export function entryFor(stock: StockItem[], glazeId: string, owner: string): StockItem | undefined {
  return stock.find((item) => item.glazeId === glazeId && ownerOf(item) === owner);
}

/** How the stock form changes an existing entry: set the amount, or add one jar. */
export type StockMode = 'set' | 'jar';

/** The form's fields (number inputs bind numbers, or null while empty). */
export interface StockDraft {
  mode: StockMode;
  amount: number | null;
  jar: number | null;
  /**
   * The entry's jar size when the draft was started (what an untouched jar field shows): jar mode compares the typed
   * size with it, never with an entry a refresh changed meanwhile, which would replace another device's size unasked.
   * Left out, the entry's size is used.
   */
  startJar?: number | null;
  /**
   * The entry's amount when the draft was started, null when the shelf held no entry then. Set mode sends the amount only
   * when it differs (an untouched amount never resets one a refresh brought in), and a draft started without an entry
   * adds its amount (an entry another device made meanwhile keeps its grams). Left out, the entry's amount is used.
   */
  startAmount?: number | null;
}

/**
 * The form after choosing a glaze and owner: an existing entry shows its amount and jar size; a new one starts at the
 * default amount without a jar size (saved, it is added: an entry another device made meanwhile keeps its grams).
 */
export function stockDraftFor(entry: StockItem | undefined): StockDraft {
  return {
    mode: 'set',
    amount: entry ? entry.quantityG : DEFAULT_JAR_G,
    jar: entry?.jarSizeG ?? null,
    startJar: entry?.jarSizeG ?? null,
    startAmount: entry ? entry.quantityG : null,
  };
}

/** Typed input the stock form would lose: an amount or jar size other than where it started (a new entry: the default amount, no size). */
export function stockFormDirty(draft: StockDraft): boolean {
  return draft.amount !== (draft.startAmount ?? DEFAULT_JAR_G) || draft.jar !== (draft.startJar ?? null);
}

/** The amount the form would save (in jar mode as this device sees it: the server adds to what it holds), or null while its fields are incomplete or invalid. */
export function stockFormTotal(entry: StockItem | undefined, draft: StockDraft): number | null {
  if (draft.mode === 'jar' && entry) {
    const jar = parseGrams(draft.jar, { min: 1, max: MAX_JAR_G });
    return jar === null ? null : parseGrams(entry.quantityG + jar);
  }
  return parseGrams(draft.amount);
}

/** The shelf part of a write for an owner select's value ("personal" or a club's ID). */
const ownerFields = (owner: string) => ({
  ownerType: owner === 'personal' ? ('personal' as const) : ('club' as const),
  clubId: owner === 'personal' ? null : owner,
});

/**
 * The save for the stock form, or null while it is incomplete. Only what the person changed goes out, so a stale form
 * never undoes another device's write:
 * - "add a jar" is an addition to what the server holds and stores the size it adds where the entry has none, and replaces
 *   the size only when the person typed another one than the form started from;
 * - a form started without an entry adds its amount (FE-6: an entry another device made meanwhile gets it on top; 0 g
 *   stays a set, there is nothing to add);
 * - set mode sends the amount only when it differs from the one the form started from and the jar size only when it
 *   differs from the started size (STOCK-3, FE-9); a size change alone is a size-only save; an untouched form sets the
 *   amount it shows.
 */
export function stockFormInput(glazeId: string, owner: string, entry: StockItem | undefined, draft: StockDraft): StockWrite | null {
  if (!glazeId) return null;
  const jar = parseGrams(draft.jar, { min: 1, max: MAX_JAR_G });
  const startJar = draft.startJar === undefined ? (entry?.jarSizeG ?? null) : draft.startJar;
  if (draft.mode === 'jar' && entry) {
    return jar === null
      ? null
      : { glazeId, addG: jar, jarSizeG: jar, ...ownerFields(owner), ...(changesJarSize({ jarSizeG: startJar }, jar) ? { replaceJarSize: true } : {}) };
  }
  const input = stockSetInput(glazeId, owner, draft.amount, draft.jar);
  if (!input) return null;
  const startAmount = draft.startAmount === undefined ? (entry?.quantityG ?? null) : draft.startAmount;
  return startAmount === null || !entry ? newEntryWrite(input) : changedOnly(input, startAmount, startJar);
}

/**
 * The write for a set typed where this device saw no entry (FE-6): its grams are added, so an entry another device made
 * meanwhile keeps its own; 0 g with a jar size is a size-only save (the server creates a used-up entry or keeps the
 * other device's amount); 0 g alone stays a set. A sent size is stored only where the entry has none.
 */
export function newEntryWrite(input: StockInput): StockWrite {
  const { quantityG, jarSizeG, ...rest } = input;
  const jar = jarSizeG ? { jarSizeG } : {};
  if (quantityG) return { ...rest, addG: quantityG, ...jar };
  return jarSizeG ? { ...rest, ...jar } : input;
}

/** A save that sets the amount, or null while the amount or a given jar size is invalid; an empty jar size keeps the entry's. */
export function stockSetInput(glazeId: string, owner: string, amount: StockDraft['amount'], jarSize: StockDraft['jar']): StockInput | null {
  const quantityG = parseGrams(amount);
  const jar = parseGrams(jarSize, { min: 1, max: MAX_JAR_G });
  if (quantityG === null || (jarSize !== null && jar === null)) return null;
  return { glazeId, quantityG, ...ownerFields(owner), ...(jar ? { jarSizeG: jar } : {}) };
}

/**
 * A set of an existing entry reduced to what changed against the amount and jar size the form or sheet started from:
 * an unchanged jar size is left out (the entry keeps the size it has now), an unchanged amount too when the size changed
 * (a size-only save). Nothing changed sets the amount shown.
 */
export function changedOnly(input: StockInput, startAmount: number, startJar: number | null | undefined): StockInput {
  const { jarSizeG, quantityG, ...rest } = input;
  const newJar = jarSizeG && jarSizeG !== startJar ? { jarSizeG } : {};
  return quantityG === startAmount && 'jarSizeG' in newJar ? { ...rest, ...newJar } : { ...rest, quantityG, ...newJar };
}

/**
 * The one-click add (glaze page, Explore, scan sheet): one default jar added on a shelf (the personal one by default),
 * stored as the entry's jar size. An addition, so an entry another device made meanwhile gets the jar on top and keeps
 * its own jar size.
 */
export const quickAddInput = (glazeId: string, owner = 'personal'): StockAddInput => ({
  glazeId,
  addG: DEFAULT_JAR_G,
  jarSizeG: DEFAULT_JAR_G,
  ...ownerFields(owner),
});

/* One glaze's part of the shelf, for its page. */

/** The entries of one glaze across the account's own shelf and its clubs': personal first, then clubs by name. */
export function glazeEntries(stock: StockItem[], glazeId: string): StockItem[] {
  return groupShelf(
    stock.filter((item) => item.glazeId === glazeId),
    () => '',
  ).flatMap((group) => [...group.items, ...group.usedUp]);
}

/** The shelves that hold nothing of the glaze yet ("personal", then the clubs in the given order). */
export function freeOwners(entries: Pick<StockItem, 'clubId'>[], clubs: { id: string }[]): string[] {
  const taken = new Set(entries.map(ownerOf));
  return ['personal', ...clubs.map((club) => club.id)].filter((owner) => !taken.has(owner));
}

/** What a glaze's shelf line says: nothing stocked, something in stock, or only used up entries. */
export type GlazeShelfState = 'none' | 'stocked' | 'usedUp';

export const glazeShelfState = (entries: Pick<StockItem, 'quantityG'>[]): GlazeShelfState =>
  !entries.length ? 'none' : entries.some((item) => !isUsedUp(item)) ? 'stocked' : 'usedUp';
