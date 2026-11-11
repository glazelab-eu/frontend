import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { combination, glaze, glazeStep } from '../../test/fixtures';
import type { Combination, Glaze } from '../api/models';
import { glazeMap } from '../glazes/glazes';
import { buildTagIndex, countTags } from '../tags/tags';
import { shelfMatch } from '../stock/shelf';
import {
  compareText,
  inOrder,
  listedTime,
  listingOf,
  matchesOf,
  mergeSort,
  missingGlazes,
  newestFirst,
  tagCountsOf,
  warmListing,
  warmOrder,
  type Listing,
  type Row,
} from './listing';

const comboOf = (id: string, title: string, glazeIds: string[] = [], extra: Partial<Combination> = {}) =>
  combination({ id, title, steps: glazeIds.map((glazeId, at) => glazeStep({ glazeId, position: at + 1 })), ...extra });
const glazeOf = (id: string, code: string, extra: Partial<Glaze> = {}) => glaze({ id, code, ...extra });

const rowsOf = (listing: Listing): Row[] => [...listing.glazes, ...listing.combinations];
const ids = (entries: { item: { id: string } }[]) => entries.map((entry) => entry.item.id);

const match = (listing: Listing, glazes: Glaze[], combinations: Combination[], changes: Partial<Parameters<typeof matchesOf>[1]> = {}) =>
  matchesOf(listing, {
    glazes,
    combinations,
    glazesById: glazeMap(glazes),
    glazeIndex: buildTagIndex(glazes),
    combinationIndex: buildTagIndex(combinations),
    q: '',
    tags: [],
    glaze: undefined,
    ...changes,
  });

describe('listingOf', () => {
  it('makes the rows once per pair of arrays and again for a new one', () => {
    const glazes = [glazeOf('g1', 'A')];
    const combinations = [comboOf('c1', 'One', ['g1'])];
    const listing = listingOf(glazes, combinations);
    expect(listingOf(glazes, combinations)).toBe(listing);
    expect(listingOf([...glazes], combinations)).not.toBe(listing);
    expect(listingOf(glazes, [...combinations])).not.toBe(listing);
  });

  it('numbers the rows across both kinds, glazes first', () => {
    const listing = listingOf([glazeOf('g1', 'A'), glazeOf('g2', 'B')], [comboOf('c1', 'One')]);
    expect(rowsOf(listing).map((row) => row.position)).toEqual([0, 1, 2]);
  });

  it('counts a published combination once per glaze and leaves drafts out', () => {
    const { usage } = listingOf([], [comboOf('c1', 'One', ['g1', 'g2', 'g1']), comboOf('c2', 'Two', ['g1']), comboOf('c3', 'Draft', ['g1'], { draft: true })]);
    expect([...usage]).toEqual([
      ['g1', 2],
      ['g2', 1],
    ]);
  });
});

describe('inOrder', () => {
  // More items than one pause of the merge sort takes, in an order that owes nothing to the listing.
  const scrambled = Array.from({ length: 5000 }, (_, at) => (at * 2654435761) % 4093);
  const glazes = scrambled
    .slice(0, 1000)
    .map((value, at) => glazeOf(`g${at}`, `Code ${value % 97}`, { createdAt: new Date(value * 86_400_000).toISOString() }));
  const combinations = scrambled
    .slice(1000)
    .map((value, at) => comboOf(`c${at}`, `Title ${value % 97}`, [], { createdAt: new Date((value % 500) * 86_400_000).toISOString() }));
  const listing = listingOf(glazes, combinations);
  const collate = new Intl.Collator('en', { sensitivity: 'base' }).compare;

  const expectedNewest = (a: Row, b: Row) =>
    (b.listed ?? 0) - (a.listed ?? 0) ||
    (a.entry.kind === b.entry.kind ? 0 : a.entry.kind === 'combination' ? -1 : 1) ||
    collate(a.text, b.text) ||
    collate(a.item.id, b.item.id);
  const expectedText = (a: Row, b: Row) =>
    collate(a.text, b.text) || (a.entry.kind === b.entry.kind ? 0 : a.entry.kind === 'combination' ? -1 : 1) || collate(a.item.id, b.item.id);

  it('orders any part of the listing as a full comparison would', () => {
    const everyThird = rowsOf(listing).filter((row) => row.position % 3 === 0);
    expect(ids(inOrder(listing, everyThird, 'newest'))).toEqual(ids([...everyThird].sort(expectedNewest).map((row) => row.entry)));
    expect(ids(inOrder(listing, everyThird, 'az'))).toEqual(ids([...everyThird].sort(expectedText).map((row) => row.entry)));
  });

  it('puts the score first, highest on top, and the order within a score', () => {
    const rows = rowsOf(listing);
    const score = (row: Row) => row.position % 5;
    const expected = [...rows].sort((a, b) => score(b) - score(a) || expectedNewest(a, b));
    expect(ids(inOrder(listing, rows, 'newest', score))).toEqual(ids(expected.map((row) => row.entry)));
  });

  it('leaves entries that compare equal in listing order', () => {
    const twins = [comboOf('same', 'Same'), comboOf('same', 'Same')];
    const list = listingOf([], twins);
    for (const order of ['newest', 'az'] as const) expect(inOrder(list, list.combinations, order).map((entry) => entry.item)).toEqual(twins);
    expect(inOrder(list, list.combinations, 'az')[0].item).toBe(twins[0]);
  });

  it('answers an empty list, with and without a score', () => {
    expect(inOrder(listing, [], 'az')).toEqual([]);
    expect(inOrder(listing, [], 'newest', () => 1)).toEqual([]);
    const empty = listingOf([], []);
    expect(inOrder(empty, [], 'newest')).toEqual([]);
  });

  it('hands out one entry object per item, so a keyed list keeps its cards', () => {
    const [first] = inOrder(listing, rowsOf(listing), 'az');
    expect(inOrder(listing, rowsOf(listing), 'newest')).toContain(first);
  });
});

describe('mergeSort', () => {
  it('sorts stably and pauses inside one merge too, so no step compares more than a step of it', () => {
    const items = Array.from({ length: 10_000 }, (_, at) => ({ key: (at * 7919) % 100, at }));
    let compared = 0;
    let most = 0;
    const steps = mergeSort(items, (a, b) => {
      compared++;
      return a.key - b.key;
    });
    let step = steps.next();
    while (!step.done) {
      most = Math.max(most, compared);
      compared = 0;
      step = steps.next();
    }
    expect(most).toBeLessThanOrEqual(2048);
    expect(step.value).toEqual([...items].sort((a, b) => a.key - b.key));
    expect(items[1].at).toBe(1);
  });

  it('answers an empty and a one-item list', () => {
    expect(mergeSort([], () => 0).next()).toEqual({ done: true, value: [] });
    expect(mergeSort([1], () => 0).next()).toEqual({ done: true, value: [1] });
  });
});

describe('warmListing', () => {
  afterEach(() => vi.restoreAllMocks());

  it('takes one task for the rows and their order, one for the tags and maps, and ends a task later', async () => {
    const tasks: (() => void)[] = [];
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((run: () => void) => tasks.push(run)) as unknown as typeof setTimeout);
    const nextTask = async () => {
      tasks.shift()!();
      for (let turn = 0; turn < 5; turn++) await Promise.resolve();
    };
    const reads = { id: 0, tags: 0, glazeTags: 0 };
    const glazes = [
      Object.defineProperties(glazeOf('g1', 'A1'), {
        id: { get: () => (reads.id++, 'g1') },
        tags: { get: () => (reads.glazeTags++, []) },
      }) as Glaze,
    ];
    const combinations = [Object.defineProperty(comboOf('c1', 'Later'), 'tags', { get: () => (reads.tags++, []) }) as Combination];
    let ended = false;
    void warmListing(glazes, combinations).then(() => (ended = true));
    const listing = () => listingOf(glazes, combinations);
    expect(reads).toEqual({ id: 0, tags: 0, glazeTags: 0 });
    await nextTask();
    expect(listing().orders.newest.sorted).toBeDefined();
    expect(listing().tags).toBeUndefined();
    await nextTask();
    expect(listing().tags).toBeDefined();
    expect(ended).toBe(false);
    await nextTask();
    expect(ended).toBe(true);

    // What the task that shows the listing asks for is there: nothing reads the items again.
    const made = { ...reads };
    expect(buildTagIndex(glazes)).toBe(buildTagIndex(glazes));
    expect(buildTagIndex(combinations)).toBe(buildTagIndex(combinations));
    expect(glazeMap(glazes).get('g1')).toBe(glazes[0]);
    expect(reads).toEqual(made);
  });

  it('makes the rows, the default order and the tags of the very listing a derivation then finds', async () => {
    const glazes = [glazeOf('g1', 'A1')];
    const combinations = [comboOf('c1', 'Later'), comboOf('c2', 'Earlier')];
    await warmListing(glazes, combinations);
    const listing = listingOf(glazes, combinations);
    expect(listing.orders.newest.sorted).toBeDefined();
    expect(listing.tags).toBeDefined();
    // A-Z stays with its idle slices.
    expect(listing.orders.az.sorted).toBeUndefined();
  });

  it('also sorts A-Z when the route asks for it, in tasks of their own before it answers (19e-10)', async () => {
    const tasks: (() => void)[] = [];
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((run: () => void) => tasks.push(run)) as unknown as typeof setTimeout);
    // Every look at the clock is 10 ms later, so a task ends after a few steps of the sort.
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (clock += 10));
    const combinations = Array.from({ length: 6000 }, (_, at) => comboOf(`c${at}`, `Title ${(at * 7919) % 6000}`));
    const glazes: Glaze[] = [];
    let ended = false;
    void warmListing(glazes, combinations, 'az').then(() => (ended = true));
    let ran = 0;
    while (!ended && ran < 1000) {
      tasks.shift()!();
      ran++;
      for (let turn = 0; turn < 5; turn++) await Promise.resolve();
    }
    expect(ended).toBe(true);
    const listing = listingOf(glazes, combinations);
    expect(listing.orders.az.sorted).toBeDefined();
    // More tasks than the three of the default order: the sort was cut into slices.
    expect(ran).toBeGreaterThan(4);
    expect(inOrder(listing, listing.combinations, 'az').map((entry) => (entry.item as Combination).title)).toEqual(
      combinations.map((item) => item.title).sort(compareText),
    );
  });
});

describe('warmOrder', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const big = () => {
    const combinations = Array.from({ length: 6000 }, (_, at) => comboOf(`c${at}`, `Title ${(at * 7919) % 6000}`));
    const glazes: Glaze[] = [];
    return { glazes, combinations, listing: listingOf(glazes, combinations) };
  };

  it('finishes the order in slices, without blocking the call', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', undefined);
    const { glazes, combinations, listing } = big();
    warmOrder(glazes, combinations);
    expect(listing.orders.az.sorted).toBeUndefined();
    vi.advanceTimersByTime(60_000);
    expect(listing.orders.az.sorted).toBeDefined();
    const collate = new Intl.Collator('en', { sensitivity: 'base' }).compare;
    expect(inOrder(listing, listing.combinations, 'az').map((entry) => (entry.item as Combination).title)).toEqual(
      combinations.map((item) => item.title).sort(collate),
    );
  });

  it('leaves the other order of the listing right when one stops half way', () => {
    const runs: ((deadline: IdleDeadline) => void)[] = [];
    vi.stubGlobal('requestIdleCallback', (run: (deadline: IdleDeadline) => void) => runs.push(run));
    const { glazes, combinations, listing } = big();
    warmOrder(glazes, combinations)();
    const cancelled = warmOrder(glazes, combinations);
    for (let step = 0; step < 3; step++) runs.pop()!({ didTimeout: true, timeRemaining: () => 0 });
    cancelled();
    const titles = combinations.map((item) => item.title).sort(new Intl.Collator('en', { sensitivity: 'base' }).compare);
    const read = (order: 'az' | 'newest') => inOrder(listing, listing.combinations, order).map((entry) => (entry.item as Combination).title);
    expect(read('newest')).toEqual(titles);
    expect(read('az')).toEqual(titles);
  });

  it('stops when cancelled, and a use before the end finishes the order itself', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', undefined);
    const { glazes, combinations, listing } = big();
    const cancel = warmOrder(glazes, combinations);
    cancel();
    vi.advanceTimersByTime(60_000);
    expect(listing.orders.az.sorted).toBeUndefined();
    expect(inOrder(listing, listing.combinations, 'az')).toHaveLength(6000);
    expect(listing.orders.az.sorted).toBeDefined();
  });
});

describe('missingGlazes', () => {
  const combinations = [comboOf('c1', 'One', ['g1', 'g2', 'g1']), comboOf('c2', 'Two', ['g2']), comboOf('c3', 'None')];
  const missingOf = (listing: Listing, scope: Set<string>) => [...missingGlazes(listing, scope)];

  it('counts what shelfMatch counts, each glaze once', () => {
    const listing = listingOf([], combinations);
    const scope = new Set(['g2']);
    expect(missingOf(listing, scope)).toEqual(combinations.map((item) => shelfMatch(item, scope).missing.length));
  });

  it('reuses the pass for a new set with the same glazes, in any order, and for no other', () => {
    const listing = listingOf([], combinations);
    const first = missingGlazes(listing, new Set(['g1', 'g2']));
    expect(missingGlazes(listing, new Set(['g2', 'g1']))).toBe(first);
    expect(missingGlazes(listing, new Set(['g1']))).not.toBe(first);
    expect(missingGlazes(listing, new Set(['g1', 'g3']))).not.toBe(first);
    expect(missingGlazes(listing, new Set())).not.toBe(first);
  });

  it('keeps the four scopes of the two switches, and drops the oldest for a fifth', () => {
    const listing = listingOf([], combinations);
    const scopes = ['a', 'b', 'c', 'd'].map((id) => new Set([id]));
    const passes = scopes.map((scope) => missingGlazes(listing, scope));
    scopes.forEach((scope, at) => expect(missingGlazes(listing, scope)).toBe(passes[at]));
    missingGlazes(listing, new Set(['e']));
    expect(missingGlazes(listing, scopes[3])).toBe(passes[3]);
    expect(missingGlazes(listing, scopes[0])).not.toBe(passes[0]);
  });
});

describe('matchesOf', () => {
  const glazes = [glazeOf('g1', 'PC-1', { tags: ['satin'] }), glazeOf('g2', 'PC-2')];
  const combinations = [comboOf('c1', 'Zircon', ['g1'], { tags: ['satin'] }), comboOf('c2', 'Quartz', ['g2'])];

  it('keeps its answer while the search, tags and glaze stay, whatever the arrays of tags', () => {
    const listing = listingOf(glazes, combinations);
    const first = match(listing, glazes, combinations, { q: 'zircon', tags: ['satin'] });
    expect(match(listing, glazes, combinations, { q: 'zircon', tags: ['satin'] })).toBe(first);
  });

  it('answers anew for another search, tag, glaze, map or index', () => {
    const listing = listingOf(glazes, combinations);
    const ask = (changes: Parameters<typeof match>[3]) => match(listing, glazes, combinations, changes);
    expect(ids(ask({ q: 'zircon' }).combinationRows)).toEqual(['c1']);
    expect(ids(ask({ q: 'quartz' }).combinationRows)).toEqual(['c2']);
    expect(ids(ask({ tags: ['satin'] }).glazeRows)).toEqual(['g1']);
    expect(ids(ask({ tags: [] }).glazeRows)).toEqual(['g1', 'g2']);
    expect(ids(ask({ tags: ['a'] }).glazeRows)).toEqual([]);
    expect(ids(ask({ tags: ['a', 'b'] }).glazeRows)).toEqual([]);
    expect(ids(ask({ glaze: 'g2' }).combinationRows)).toEqual(['c2']);
    expect(ids(ask({ glaze: 'g2' }).glazeRows)).toEqual(['g2']);
    const again = ask({});
    expect(ask({ glazesById: new Map(glazeMap(glazes)) })).not.toBe(again);
    const byMap = ask({});
    expect(ask({ glazeIndex: new Map() })).not.toBe(byMap);
    const byIndex = ask({});
    expect(ask({ combinationIndex: new Map() })).not.toBe(byIndex);
  });

  it('tells selections of the same length apart, and one glaze from another', () => {
    const listing = listingOf(glazes, combinations);
    const ask = (changes: Parameters<typeof match>[3]) => match(listing, glazes, combinations, changes);
    expect(ids(ask({ tags: ['satin'] }).glazeRows)).toEqual(['g1']);
    expect(ids(ask({ tags: ['gloss'] }).glazeRows)).toEqual([]);
    expect(ids(ask({ glaze: 'g1' }).glazeRows)).toEqual(['g1']);
    expect(ids(ask({ glaze: 'g2' }).glazeRows)).toEqual(['g2']);
    expect(ids(ask({ glaze: undefined }).glazeRows)).toEqual(['g1', 'g2']);
  });

  it('does not take the rows of one tag selection for another that reads the same joined', () => {
    const listing = listingOf(glazes, combinations);
    const first = match(listing, glazes, combinations, { tags: ['a,b'] });
    expect(match(listing, glazes, combinations, { tags: ['a', 'b'] })).not.toBe(first);
  });

  it('answers with the listing rows themselves when nothing narrows', () => {
    const listing = listingOf(glazes, combinations);
    const matches = match(listing, glazes, combinations);
    expect(matches.glazeRows).toBe(listing.glazes);
    expect(matches.combinationRows).toBe(listing.combinations);
  });
});

describe('tagCountsOf', () => {
  it('counts as countTags does, ties alphabetically, an unused tag left out', () => {
    const items = [
      comboOf('c1', 'One', [], { tags: ['satin', 'blue'] }),
      comboOf('c2', 'Two', [], { tags: ['satin', 'ähre'] }),
      comboOf('c3', 'Three', [], { tags: ['zebra', 'blue', 'apple'] }),
      comboOf('c4', 'Unused', [], { tags: ['unused'] }),
    ];
    const listing = listingOf([glazeOf('g1', 'A', { tags: ['satin'] })], items);
    const rows = rowsOf(listing).filter((row) => row.item.id !== 'c4');
    expect(tagCountsOf(listing, rows)).toEqual(countTags(rows.map((row) => row.item)));
    expect(tagCountsOf(listing, rows).map(({ tag }) => tag)).toEqual(['satin', 'blue', 'ähre', 'apple', 'zebra']);
  });

  it('reads the tags of a listing once', () => {
    const listing = listingOf([], [comboOf('c1', 'One', [], { tags: ['satin'] })]);
    tagCountsOf(listing, rowsOf(listing));
    const { tags } = listing;
    tagCountsOf(listing, []);
    expect(listing.tags).toBe(tags);
  });

  it('counts nothing for no rows', () => {
    expect(tagCountsOf(listingOf([], [comboOf('c1', 'One', [], { tags: ['satin'] })]), [])).toEqual([]);
  });
});

describe('compareText', () => {
  it('orders Italian and Spanish titles A-Z with accented letters beside their base letter', () => {
    const titles = ['Verde', 'Pérola', 'Ñandú', 'Città', 'Nube', 'Perla', 'città', 'Àmbra', 'Azul', 'Éter', 'Esmeralda'];
    expect([...titles].sort(compareText)).toEqual(['Àmbra', 'Azul', 'Città', 'città', 'Esmeralda', 'Éter', 'Ñandú', 'Nube', 'Perla', 'Pérola', 'Verde']);
    expect(compareText('Città', 'citta')).toBe(0);
  });

  it('is fixed to English: Spanish collation would put ñ after every n, the shared order puts it with n', () => {
    // One order per listing for every language (it is cached with the listing); the difference is this one letter.
    expect(compareText('Ñandú', 'Nube')).toBeLessThan(0);
    expect(new Intl.Collator('es', { sensitivity: 'base' }).compare('Ñandú', 'Nube')).toBeGreaterThan(0);
    // Italian has no letters of its own: its collation agrees with the shared one.
    const italian = new Intl.Collator('it', { sensitivity: 'base' }).compare;
    const words = ['Verde', 'Città', 'Perla', 'Pérola', 'Àmbra', 'Ècru', 'Eolo'];
    expect([...words].sort(italian)).toEqual([...words].sort(compareText));
  });
});

describe('listing times', () => {
  const zone = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'Europe/Berlin';
  });
  afterAll(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  it('orders combinations and glazes by their instants, whatever the reader’s zone', () => {
    const published = combination({ id: 'c1', createdAt: '2026-11-10T11:00:00Z', publishedAt: '2026-11-10T12:00:00Z' });
    const added = glaze({ id: 'g1', createdAt: '2026-11-10T11:30:00Z' });
    expect([added, published].sort(newestFirst).map((item) => item.id)).toEqual(['c1', 'g1']);
    expect(listedTime(published)).toBe(Date.UTC(2026, 10, 10, 12));
  });

  it('reads a zone-less time of a snapshot saved before sync format 2 as UTC', () => {
    const saved = combination({ id: 'c2', createdAt: '2026-11-10T11:00:00', publishedAt: '2026-11-10T12:00:00' });
    const added = glaze({ id: 'g2', createdAt: '2026-11-10T11:30:00Z' });
    expect(listedTime(saved)).toBe(Date.UTC(2026, 10, 10, 12));
    expect([added, saved].sort(newestFirst).map((item) => item.id)).toEqual(['c2', 'g2']);
  });
});
