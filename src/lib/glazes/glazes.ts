import type { Glaze, Manufacturer, Step } from '../api/models';
import { isGlazeStep } from './steps';

type Coded = Pick<Glaze, 'code'> & { manufacturer: Pick<Manufacturer, 'name'> };
type Named = Coded & Pick<Glaze, 'name'>;
type Searchable = Named & { manufacturer: Pick<Manufacturer, 'shortId'> };

/**
 * How a glaze code is shown everywhere: the manufacturer's display name, then its own code
 * (Amaco PC-20). The one place to change when the code format changes; short IDs stay the unique
 * keys and appear only where a manufacturer is chosen or added.
 */
export function glazeCode(glaze: Coded): string {
  return [glaze.manufacturer.name.trim(), glaze.code].filter(Boolean).join(' ');
}

/** Code and name (Amaco PC-20 Blue Rutile), for titles, pickers and image descriptions. */
export function glazeTitle(glaze: Named): string {
  return [glazeCode(glaze), glaze.name].filter(Boolean).join(' ');
}

/** A glaze named by a step or stock entry: by its loaded glaze (with the code), else by its own names. */
export function referencedGlazeTitle(glazesById: ReadonlyMap<string, Named>, entry: { glazeId: string; manufacturer: string; name: string }): string {
  const glaze = glazesById.get(entry.glazeId);
  return glaze ? glazeTitle(glaze) : [entry.manufacturer.trim(), entry.name].filter(Boolean).join(' ');
}

/** A combination's title; only a draft may have none, and then shows `untitled`. */
export function combinationTitle(combination: { title: string }, untitled: string): string {
  return combination.title.trim() || untitled;
}

/**
 * The combination a variation was recorded from, when the listing offers it (the API names a source only
 * to viewers who may see it, and not once it was deleted).
 */
export function variationSource<T extends { id: string }>(combinations: readonly T[], combination: { basedOnId?: string | null }): T | undefined {
  return combination.basedOnId ? combinations.find((candidate) => candidate.id === combination.basedOnId) : undefined;
}

/** The listed variations of a combination, in listing order (newest first). */
export function variationsOf<T extends { basedOnId?: string | null }>(combinations: readonly T[], id: string): T[] {
  return combinations.filter((candidate) => candidate.basedOnId === id);
}

/** A step's title: its glaze (as in `referencedGlazeTitle`), or a custom step's label. */
export function stepTitle(
  glazesById: ReadonlyMap<string, Named>,
  step: {
    type?: Step['type'];
    glazeId?: string | null;
    manufacturer?: string | null;
    name?: string | null;
    label?: string | null;
  },
): string {
  if (!isGlazeStep(step)) return step.label ?? '';
  return referencedGlazeTitle(glazesById, {
    glazeId: step.glazeId!,
    manufacturer: step.manufacturer ?? '',
    name: step.name ?? '',
  });
}

const glazeMaps = new WeakMap<object, ReadonlyMap<string, unknown>>();

/** The loaded glazes by ID, for looking up the codes of steps and stock entries. One map per list, for every page: never edit it, nor the list. */
export function glazeMap<T extends { id: string }>(glazes: readonly T[]): ReadonlyMap<string, T> {
  let map = glazeMaps.get(glazes) as ReadonlyMap<string, T> | undefined;
  if (!map) glazeMaps.set(glazes, (map = new Map(glazes.map((glaze) => [glaze.id, glaze]))));
  return map;
}

/** Lower case without accents, for matching typed text against glaze data. */
function fold(text: string): string {
  // Plain ASCII, most of a library, has nothing to take off and skips the costly part.
  return (/^[\0-\x7f]*$/.test(text) ? text : text.normalize('NFD').replace(/\p{M}/gu, '')).toLowerCase();
}

/** Letters and digits only, so "pc20" and "PC 20" find code PC-20. */
function compact(text: string): string {
  return text.replace(/[^\p{L}\p{N}]/gu, '');
}

/** An item as `search` compares it: everything that costs time per key is made once (see the caches below). */
interface SearchText {
  /** Every searched field, folded. */
  text: string;
  /** Codes, folded and compacted. */
  codes: string[];
}

/** Whether `word` starts one of the words of a text, which `[\s·-]` separates; a word holding a separator never does. */
function startsAWord(text: string, word: string): boolean {
  if (/[·-]/.test(word)) return false;
  for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1)) {
    if (at === 0 || /[\s·-]/.test(text[at - 1])) return true;
  }
  return false;
}

/**
 * Items matching every word of the query in their text. Items whose code starts with the query
 * (ignoring separators) come first, then matches at the start of a word; otherwise the order is kept.
 */
function search<T>(items: T[], query: string, textOf: (item: T) => SearchText): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  const compactQuery = compact(words.join(''));
  const byCode: T[] = [];
  const byWordStart: T[] = [];
  const others: T[] = [];
  for (const item of items) {
    const { text, codes } = textOf(item);
    const codeMatch = compactQuery !== '' && codes.some((code) => code.startsWith(compactQuery));
    if (!codeMatch && !words.every((word) => text.includes(word))) continue;
    (codeMatch ? byCode : words.every((word) => startsAWord(text, word)) ? byWordStart : others).push(item);
  }
  return [...byCode, ...byWordStart, ...others];
}

/** The older code form, short ID and code (AMACO-PC-20), still found by search. */
function shortIdCode(glaze: Searchable): string {
  return [glaze.manufacturer.shortId, glaze.code].filter(Boolean).join('-');
}

function compactCodes(codes: string[]): string[] {
  return codes.map((code) => compact(fold(code)));
}

/*
 * Search text is made once per item, not per key: folding a large library takes longer than a key press. An item's
 * cache entry holds because a listing change replaces its items and never edits them in place (`upsert` keeps an
 * object only while it is unchanged). A combination's text also holds what its steps' glazes say, and a glaze change
 * replaces only the combinations whose copied name changed (`withGlazeNames`), never for a code or short ID: so its
 * entry remembers the glaze objects it was made from and is made again when the map answers another one. Keep passing
 * the same map while the glazes are the same (a map is never edited): a new one costs a look at every step.
 */
const glazeCodeCache = new WeakMap<Searchable, string[]>();
const glazeTextCache = new WeakMap<Searchable, SearchText>();
const glazeNotesTextCache = new WeakMap<Searchable, SearchText>();
const combinationTextCache = new WeakMap<SearchableCombination, CombinationText>();

function glazeCodes(glaze: Searchable): string[] {
  let codes = glazeCodeCache.get(glaze);
  if (!codes) glazeCodeCache.set(glaze, (codes = compactCodes([glazeCode(glaze), shortIdCode(glaze), glaze.code])));
  return codes;
}

type SearchableGlaze = Searchable & { notes?: string | null; tags?: string[] };

function glazeText(glaze: SearchableGlaze, notes: boolean): SearchText {
  const cache = notes ? glazeNotesTextCache : glazeTextCache;
  let text = cache.get(glaze);
  if (!text) {
    text = {
      text: fold([glazeCode(glaze), shortIdCode(glaze), glaze.name, ...(glaze.tags ?? []), notes ? glaze.notes : ''].join(' ')),
      codes: glazeCodes(glaze),
    };
    cache.set(glaze, text);
  }
  return text;
}

/**
 * Glazes matching every word of the query in their code, manufacturer (name or short ID), name or
 * tags, and optionally their notes. A code matches with or without the manufacturer, in the shown form
 * or the older short ID form (pc20, PC 20, Amaco PC-20 and AMACO-PC-20 find Amaco PC-20).
 */
export function filterGlazes<T extends SearchableGlaze>(glazes: T[], query: string, { notes = false } = {}): T[] {
  return search(glazes, query, (glaze) => glazeText(glaze, notes));
}

interface SearchableCombination {
  title: string;
  description?: string | null;
  author?: string | null;
  tags: string[];
  steps: {
    type?: Step['type'];
    glazeId?: string | null;
    manufacturer?: string | null;
    name?: string | null;
    label?: string | null;
    method?: string | null;
    notes?: string | null;
  }[];
}

/** Search text of a combination, with the glazes its glaze steps' IDs named when it was made. */
interface CombinationText extends SearchText {
  glazeIds: string[];
  usedGlazes: (Searchable | undefined)[];
  /** The last map found to answer the same glazes: asking the map again for every item of every key would take longer than the rest of a search. */
  checked: ReadonlyMap<string, Searchable>;
}

function combinationText(combination: SearchableCombination, glazes: ReadonlyMap<string, Searchable>): SearchText {
  const cached = combinationTextCache.get(combination);
  if (cached) {
    if (cached.checked === glazes) return cached;
    if (cached.glazeIds.every((id, index) => glazes.get(id) === cached.usedGlazes[index])) {
      cached.checked = glazes;
      return cached;
    }
  }
  const glazeIds: string[] = [];
  const usedGlazes: (Searchable | undefined)[] = [];
  const codes: string[] = [];
  const parts = combination.steps.flatMap((step) => {
    if (!isGlazeStep(step)) return [step.label, step.notes];
    const glaze = glazes.get(step.glazeId!);
    glazeIds.push(step.glazeId!);
    usedGlazes.push(glaze);
    if (glaze) codes.push(...glazeCodes(glaze));
    return [glaze ? `${glazeCode(glaze)} ${shortIdCode(glaze)}` : '', step.manufacturer, step.name, step.method, step.notes];
  });
  const text = [combination.title, combination.description, combination.author, ...combination.tags, ...parts].filter(Boolean).join(' ');
  const made = { text: fold(text), codes, glazeIds, usedGlazes, checked: glazes };
  combinationTextCache.set(combination, made);
  return made;
}

/**
 * Combinations matching every word of the query in their title, notes, author or tags, or in a
 * glaze step's glaze (code in either form, manufacturer, name), method or notes, or in a custom
 * step's label or details. Combinations with a glaze step whose code matches come first, as in the
 * glaze search.
 */
export function filterCombinations<T extends SearchableCombination>(combinations: T[], query: string, glazes: ReadonlyMap<string, Searchable>): T[] {
  return search(combinations, query, (combination) => combinationText(combination, glazes));
}

/** The longest idle slice: below a long task, on the slowest phones too. */
const WARM_SLICE_MS = 40;
/** The slice without an idle callback's deadline: leaves room for a frame. */
const WARM_TIMER_SLICE_MS = 8;

/** Runs `step` until it answers true, in slices of at most `sliceMs` while the page is idle. Answers its cancel. */
export function idleSlices(step: () => boolean, sliceMs = WARM_SLICE_MS): () => void {
  let cancelled = false;
  const later = () => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(slice, { timeout: 2000 });
    else setTimeout(slice, 20);
  };
  const slice = (idle?: IdleDeadline) => {
    if (cancelled) return;
    const end = performance.now() + (idle ? Math.min(idle.timeRemaining(), sliceMs) : WARM_TIMER_SLICE_MS);
    let done: boolean;
    do done = step();
    while (!done && !cancelled && performance.now() < end);
    if (!done && !cancelled) later();
  };
  later();
  return () => {
    cancelled = true;
  };
}

/**
 * Makes the search text of a listing (as Explore searches it: glaze notes included) ahead of the first key, in slices
 * while the page is idle, so that key finds it ready. Items already made cost one lookup. Answers its cancel.
 */
export function warmSearch(glazes: SearchableGlaze[], combinations: SearchableCombination[], glazesById: ReadonlyMap<string, Searchable>): () => void {
  const total = glazes.length + combinations.length;
  let done = 0;
  return idleSlices(() => {
    if (done < glazes.length) glazeText(glazes[done], true);
    else if (done < total) combinationText(combinations[done - glazes.length], glazesById);
    return ++done >= total;
  });
}

/**
 * Glazes on the account's shelf or a club shelf (more than 0 g) first, then the others, each in
 * listing order: what a potter can apply right away comes first in pickers.
 */
export function stockedFirst<T extends { id: string }>(glazes: T[], stock: { glazeId: string; quantityG: number }[]): T[] {
  const stocked = new Set(stock.filter((item) => item.quantityG > 0).map((item) => item.glazeId));
  return [...glazes.filter((glaze) => stocked.has(glaze.id)), ...glazes.filter((glaze) => !stocked.has(glaze.id))];
}

/** The manufacturers of the loaded glazes, once each, by name. */
export function manufacturersOf(glazes: Pick<Glaze, 'manufacturer'>[]): Manufacturer[] {
  const byId = new Map<string, Manufacturer>();
  // Snapshots saved before manufacturers existed carry placeholders without an ID.
  for (const { manufacturer } of glazes) if (manufacturer.id) byId.set(manufacturer.id, manufacturer);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Manufacturers matching every word in their name or short ID; short ID matches first. */
export function filterManufacturers(manufacturers: Manufacturer[], query: string): Manufacturer[] {
  return search(manufacturers, query, (manufacturer) => ({
    text: fold(`${manufacturer.shortId} ${manufacturer.name}`),
    codes: compactCodes([manufacturer.shortId]),
  }));
}

/** One-line text for a manufacturer in the picker. */
export function manufacturerLabel(manufacturer: Manufacturer): string {
  return `${manufacturer.name} (${manufacturer.shortId})`;
}
