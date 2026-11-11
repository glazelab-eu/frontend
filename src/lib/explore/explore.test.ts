import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Combination, Favorites, Glaze } from '../api/models';
import { combination, customStep, glaze, glazeStep, imageInfo } from '../../test/fixtures';
import { buildTagIndex } from '../tags/tags';
import type { BuddyHolders } from '../stock/buddy-shelf';
import { shelfScope } from '../stock/shelf';
import { home, routeHref } from '../routing/routes';
import {
  activeQuick,
  almostRoute,
  combinationsOfGlazeRoute,
  effectiveType,
  explore,
  exploreKey,
  photoBrowse,
  firingRoute,
  glazeCombinationsRoute,
  matchesFiring,
  isLibraryEmpty,
  isNew,
  isWaiting,
  published,
  hasPhoto,
  newDays,
  quickApplies,
  quickRoute,
  shelfSources,
  shelfStockRoute,
  shelfOptionRoute,
  typeRoute,
  type ExploreInput,
  type ExploreItem,
} from './explore';
import { glazeUsage, listedAt, listedTime, newestFirst } from './listing';

function glazeOf(id: string, code: string, extra: Partial<Glaze> = {}): Glaze {
  return glaze({ id, code, name: `Name ${code}`, createdAt: '2026-01-01T00:00:00Z', ...extra });
}
function combo(id: string, title: string, glazeIds: string[], extra: Partial<Combination> = {}) {
  return combination({
    id,
    title,
    createdAt: '2026-01-01T00:00:00Z',
    steps: glazeIds.map((glazeId, index) => glazeStep({ glazeId, position: index + 1, name: 'x' })),
    ...extra,
  });
}

const g1 = glazeOf('g1', 'PC-1', { tags: ['satin'], images: [imageInfo({ id: 'p1' })] });
const g2 = glazeOf('g2', 'PC-2', { tags: ['gloss'], createdAt: '2026-03-01T00:00:00Z' });
const g3 = glazeOf('g3', 'PC-3', { tags: ['satin'] });
const c1 = combo('c1', 'Blue over green', ['g1', 'g2'], { tags: ['satin'] });
const c2 = combo('c2', 'Green alone', ['g2'], {
  images: [imageInfo({ id: 'p2' })],
  createdAt: '2026-02-01T00:00:00Z',
});
const c3 = combo('c3', 'Triple', ['g2', 'g3', 'g2'], { createdAt: '2026-04-01T00:00:00Z' });
const noFavorites: Favorites = { glazeIds: [], combinationIds: [] };

function run(input: Partial<ExploreInput> = {}, glazes = [g1, g2, g3], combos = [c1, c2, c3]) {
  return explore({
    glazes,
    combinations: combos,
    glazeIndex: buildTagIndex(glazes),
    combinationIndex: buildTagIndex(combos),
    filters: {},
    favorites: noFavorites,
    stock: [],
    // Far after the fixtures, so nothing is "new" unless a test sets its own clock.
    now: Date.parse('2026-10-01T00:00:00Z'),
    ...input,
  });
}
const keys = (items: ExploreItem[]) => items.map(exploreKey);
/** The glazes by use, with `uses` published combinations of one of them. */
function mostUsed(glazes: Glaze[], glazeId = '', uses = 0) {
  const users = Array.from({ length: uses }, (_, at) => combo(`user-${at}`, 'User', [glazeId]));
  return run({ filters: { type: 'glazes', sort: 'used' } }, glazes, users).items;
}

describe('mixed list', () => {
  it('shows both kinds by default, newest first, with keys of both kinds', () => {
    const result = run();
    // Newest first across both kinds, regardless of photos.
    expect(keys(result.items)).toEqual(['combination:c3', 'glaze:g2', 'combination:c2', 'combination:c1', 'glaze:g1', 'glaze:g3']);
    expect(result.counts).toEqual({ all: 6, combinations: 3, glazes: 3 });
  });

  it('lists one type when chosen, newest first', () => {
    expect(keys(run({ filters: { type: 'combinations' } }).items)).toEqual(['combination:c3', 'combination:c2', 'combination:c1']);
    // Glazes use their creation date too.
    expect(keys(run({ filters: { type: 'glazes' } }).items)).toEqual(['glaze:g2', 'glaze:g1', 'glaze:g3']);
  });

  it('counts a combination once per glaze however often it uses it', () => {
    const usage = glazeUsage([c1, c2, c3]);
    expect(usage.get('g2')).toBe(3);
    expect(usage.get('g1')).toBe(1);
    expect(usage.get('g3')).toBe(1);
    expect(run().usage.get('g2')).toBe(3);
  });

  it('breaks ties by kind, then title or display code, then ID, independently of listing order', () => {
    const a = glazeOf('a', 'B-1');
    const b = glazeOf('b', 'A-1');
    const same = glazeOf('c', 'A-1');
    const x = combo('x', 'Zed', []);
    const y = combo('y', 'Alpha', []);
    const expected = ['combination:y', 'combination:x', 'glaze:b', 'glaze:c', 'glaze:a'];
    expect(keys(run({}, [a, b, same], [x, y]).items)).toEqual(expected);
    expect(keys(run({}, [same, b, a], [y, x]).items)).toEqual(expected);
  });

  it('puts glazes of older saved listings without a creation time last in their group', () => {
    const legacy = { ...glazeOf('old', 'PC-0'), createdAt: undefined } as unknown as Glaze;
    const result = run({ filters: { type: 'glazes' } }, [legacy, g3], []);
    expect(keys(result.items)).toEqual(['glaze:g3', 'glaze:old']);
    const mixed = run({}, [legacy, g3], []);
    expect(keys(mixed.items)).toEqual(['glaze:g3', 'glaze:old']);
  });

  it('orders glazes by use, then newest', () => {
    expect(keys(mostUsed([g1, g2, g3]))).toEqual(['glaze:g2', 'glaze:g1', 'glaze:g3']);
    expect(keys(mostUsed([g1, g2, g3], 'g3', 5))).toEqual(['glaze:g3', 'glaze:g2', 'glaze:g1']);
  });
});

describe('shared filters', () => {
  it('applies one search to both kinds', () => {
    expect(keys(run({ filters: { q: 'green' } }).items)).toEqual(['combination:c2', 'combination:c1']);
    expect(keys(run({ filters: { q: 'pc-3' } }).items)).toContain('glaze:g3');
  });

  it('applies the selected tags to both kinds', () => {
    const result = run({ filters: { tags: ['satin'] } });
    expect(keys(result.items).sort()).toEqual(['combination:c1', 'glaze:g1', 'glaze:g3']);
    expect(result.counts).toEqual({ all: 3, combinations: 1, glazes: 2 });
  });

  it('offers tags of the shown items only', () => {
    const result = run({ filters: { tags: ['satin'] } });
    expect(result.tagCounts).toEqual([{ tag: 'satin', count: 3 }]);
    expect(run({ filters: { type: 'glazes' } }).tagCounts).toEqual([
      { tag: 'satin', count: 2 },
      { tag: 'gloss', count: 1 },
    ]);
  });

  it('keeps the combinations with a step of the glaze and the glaze itself', () => {
    const result = run({ filters: { glaze: 'g3' } });
    expect(keys(result.items)).toEqual(['combination:c3', 'glaze:g3']);
    expect(result.counts).toEqual({ all: 2, combinations: 1, glazes: 1 });
    expect(keys(run({ filters: { glaze: 'g1' } }).items)).toEqual(['combination:c1', 'glaze:g1']);
  });

  it('lists exactly the combinations of a glaze under the Combinations type, the count of the glaze page link', () => {
    const result = run({ filters: { glaze: 'g2', type: 'combinations' } });
    expect(keys(result.items)).toEqual(keys(run({ filters: { glaze: 'g2' } }).items).filter((key) => key.startsWith('combination:')));
    expect(result.items).toHaveLength(glazeUsage([c1, c2, c3]).get('g2') ?? 0);
  });

  it('links a glaze to its combinations under the Combinations type, listing as many as the link says', () => {
    const own = combo('c4', 'Draft', ['g2'], { draft: true });
    for (const id of ['g1', 'g2', 'g3']) {
      const route = combinationsOfGlazeRoute(id);
      expect(route).toEqual({ name: 'discover', type: 'combinations', glaze: id });
      expect(routeHref(route)).toBe(`#/?type=combinations&glaze=${id}`);
      const result = run({ filters: { glaze: route.glaze, type: route.type } }, [g1, g2, g3], [c1, c2, c3, own]);
      expect(result.items).toHaveLength(glazeUsage([c1, c2, c3, own]).get(id) ?? 0);
      expect(result.counts.combinations).toBe(result.items.length);
    }
  });

  it('shows favourites of both kinds to signed-in users only', () => {
    const favorites = { glazeIds: ['g3'], combinationIds: ['c1'] };
    const result = run({ filters: { quick: 'favourites' }, favorites });
    expect(keys(result.items).sort()).toEqual(['combination:c1', 'glaze:g3']);
    // Guests have no favourites to apply, so a shared link shows the whole list.
    expect(run({ filters: { quick: 'favourites' }, favorites: null }).counts.all).toBe(6);
  });

  it('applies "I can make now" to combinations, leaving glazes out of All', () => {
    const stock = [
      { glazeId: 'g2', quantityG: 100 },
      { glazeId: 'g3', quantityG: 0 },
    ];
    const result = run({ filters: { quick: 'canMake' }, stock });
    expect(keys(result.items)).toEqual(['combination:c2']);
    expect(result.counts).toEqual({ all: 1, combinations: 1, glazes: 3 });
    // The Glazes type has no such control: the filter does not empty it.
    expect(run({ filters: { quick: 'canMake', type: 'glazes' }, stock }).items).toHaveLength(3);
  });

  describe('with buddies included', () => {
    const ada = { id: 'u2', displayName: 'Ada' };
    const stock = [{ glazeId: 'g2', quantityG: 100 }];
    const holders = (...ids: string[]): BuddyHolders => new Map(ids.map((id) => [id, [ada]]));

    it('counts the glazes buddies have as available for I can make now, and only there', () => {
      // g2 on the shelf: only c2 is makeable. Ada has g1: c1 (g1 + g2) becomes makeable too.
      expect(keys(run({ filters: { quick: 'canMake' }, stock }).items)).toEqual(['combination:c2']);
      const withAda = run({ filters: { quick: 'canMake' }, stock, buddyHolders: holders('g1') });
      expect(keys(withAda.items)).toEqual(['combination:c2', 'combination:c1']);
      expect(withAda.chips.find((chip) => chip.view === 'canMake')?.count).toBe(2);
      // c3 still lacks g3, which nobody has.
      expect(keys(withAda.items)).not.toContain('combination:c3');
    });

    it('keeps On my shelf personal and allows buddy-only availability', () => {
      const shelf = run({ filters: { quick: 'shelf' }, stock, buddyHolders: holders('g1', 'g3') });
      expect(keys(shelf.items)).toEqual(['glaze:g2']);
      // Buddies have glazes but the account stocked nothing: the chip keeps its reason.
      const bare = run({ filters: {}, stock: [], buddyHolders: holders('g1', 'g2') });
      expect(bare.chips.find((chip) => chip.view === 'canMake')?.reason).toBeUndefined();
      expect(keys(run({ filters: { quick: 'canMake' }, buddyHolders: holders('g2') }).items)).toEqual(['combination:c2']);
    });

    it("counts the combinations missing one glaze with the buddies' glazes too", () => {
      // Shelf g2, Ada g3: c3 (g2, g3) is complete, c1 lacks g1 only, c2 is complete.
      const result = run({ filters: { quick: 'canMake', almost: true }, stock, buddyHolders: holders('g3') });
      expect(keys(result.items).sort()).toEqual(['combination:c1', 'combination:c2', 'combination:c3']);
      const plain = run({ filters: { quick: 'canMake' }, stock, buddyHolders: holders('g3') });
      expect(keys(plain.items)).toEqual(['combination:c3', 'combination:c2']);
      expect(plain.oneMissing).toBe(1);
    });

    it('changes nothing for a glaze nobody holds', () => {
      expect(run({ filters: { quick: 'canMake' }, stock, buddyHolders: new Map() })).toEqual(run({ filters: { quick: 'canMake' }, stock }));
    });
  });

  it('ignores custom steps for the shelf, usage and the glaze filter, and never matches a combination without glaze steps', () => {
    const firing = customStep();
    const fired = combo('c4', 'Fired only', [], { steps: [firing] });
    const mixed = combo('c5', 'Fired and glazed', ['g2'], {
      steps: [firing, ...combo('x', 'x', ['g2']).steps],
    });
    const stock = [{ glazeId: 'g2', quantityG: 100 }];
    const combos = [c2, fired, mixed];
    expect(keys(run({ filters: { quick: 'canMake' }, stock }, [g1, g2, g3], combos).items)).toEqual(['combination:c2', 'combination:c5']);
    expect(run({ filters: { quick: 'canMake' }, stock: [] }, [g1, g2, g3], combos).items).toEqual([]);
    expect(glazeUsage(combos).get('g2')).toBe(2);
    expect(keys(run({ filters: { glaze: 'g2', type: 'combinations' } }, [g1, g2, g3], combos).items)).toEqual(['combination:c2', 'combination:c5']);
    expect(run({}, [g1, g2, g3], combos).counts.combinations).toBe(3);
  });

  it('adds the combinations missing one glaze to I can make now, ordered like the list', () => {
    const stock = [{ glazeId: 'g2', quantityG: 100 }];
    // g2 only: c2 is complete, c1 lacks g1 and c3 lacks g3 (a glaze used twice counts once).
    const plain = run({ filters: { quick: 'canMake' }, stock });
    expect(keys(plain.items)).toEqual(['combination:c2']);
    expect(plain.almost).toBe(false);
    expect(plain.oneMissing).toBe(2);
    const more = run({ filters: { quick: 'canMake', almost: true }, stock });
    expect(keys(more.items)).toEqual(['combination:c3', 'combination:c2', 'combination:c1']);
    expect(more.almost).toBe(true);
    expect(more.counts).toEqual({ all: 3, combinations: 3, glazes: 3 });
    expect(more.chips.find((chip) => chip.view === 'canMake')?.count).toBe(3);
    // Nothing owned: no combination misses just one glaze unless it has one glaze only.
    const none = run({ filters: { quick: 'canMake', almost: true }, stock: [] });
    expect(keys(none.items)).toEqual(['combination:c2']);
  });

  it('counts only one missing glaze, never combinations with more or without glaze steps', () => {
    const firing = customStep({ label: 'Bisque' });
    const fired = combo('c4', 'Fired only', [], { steps: [firing] });
    const combos = [c1, c2, c3, fired];
    const stock = [{ glazeId: 'g3', quantityG: 5 }];
    // c1 misses g1 and g2, c2 misses g2, c3 misses g2: only c2 and c3 miss one.
    const result = run({ filters: { quick: 'canMake', almost: true }, stock }, [g1, g2, g3], combos);
    expect(keys(result.items).sort()).toEqual(['combination:c2', 'combination:c3']);
    expect(result.oneMissing).toBe(2);
    // 0 g does not count as owned.
    const empty = run({ filters: { quick: 'canMake', almost: true }, stock: [{ glazeId: 'g2', quantityG: 0 }] }, [g1, g2, g3], combos);
    expect(keys(empty.items)).toEqual(['combination:c2']);
  });

  it('honours the step only with I can make now, narrowed by search and club stock', () => {
    const stock = [{ glazeId: 'g1', quantityG: 100 }]; // e.g. a club shelf
    expect(run({ filters: { quick: 'mine', almost: true }, stock }).almost).toBe(false);
    expect(run({ filters: { almost: true }, stock }).almost).toBe(false);
    // Guests have no shelf and no quick view at all.
    expect(run({ filters: { quick: 'canMake', almost: true }, favorites: null }).almost).toBe(false);
    const searched = run({ filters: { quick: 'canMake', almost: true, q: 'alone' }, stock });
    expect(keys(searched.items)).toEqual(['combination:c2']);
    expect(searched.oneMissing).toBe(1);
  });

  it('links to the step and drops it with the quick view', () => {
    const route = { ...home, type: 'combinations', quick: 'canMake', q: 'x' } as const;
    expect(almostRoute(route, true)).toEqual({ ...route, almost: true });
    expect(almostRoute({ ...route, almost: true }, false)).toEqual(route);
    expect(quickRoute({ ...route, almost: true }, 'canMake')).toEqual(route);
    expect(quickRoute({ ...route, almost: true }, 'favourites').almost).toBeUndefined();
    expect(typeRoute({ ...route, almost: true }, 'combinations').almost).toBe(true);
    expect(typeRoute({ ...home, quick: 'canMake', almost: true }, 'glazes')).toEqual({
      ...home,
      type: 'glazes',
    });
  });

  it('is empty per type with no matches', () => {
    const result = run({ filters: { q: 'zzz' } });
    expect(result.items).toEqual([]);
    expect(result.counts).toEqual({ all: 0, combinations: 0, glazes: 0 });
  });

  it('works with an empty library', () => {
    const result = run({}, [], []);
    expect(result.items).toEqual([]);
    expect(result.tagCounts).toEqual([]);
  });
});

describe('type links', () => {
  it('sets or removes the type and drops the toggle the Glazes type has no use for', () => {
    const route = { ...home, q: 'x', quick: 'canMake' } as const;
    expect(typeRoute(route, 'glazes')).toEqual({ name: 'discover', type: 'glazes', q: 'x' });
    expect(typeRoute({ ...route, type: 'glazes' }, undefined)).toEqual(route);
    expect(typeRoute(route, 'combinations')).toEqual({ ...route, type: 'combinations' });
    expect(typeRoute({ ...home, quick: 'favourites' }, 'glazes').quick).toBe('favourites');
  });

  it('shows a glaze with its combinations, leaving the Glazes type for All', () => {
    expect(glazeCombinationsRoute({ ...home, type: 'glazes', q: 'x' }, 'g1')).toEqual({
      name: 'discover',
      q: 'x',
      glaze: 'g1',
    });
    expect(glazeCombinationsRoute({ ...home, type: 'combinations' }, 'g1')).toEqual({
      name: 'discover',
      type: 'combinations',
      glaze: 'g1',
    });
  });
});

describe('quick views', () => {
  const stock = [
    { glazeId: 'g2', quantityG: 100 },
    { glazeId: 'g3', quantityG: 0 },
  ];
  const favorites = { glazeIds: ['g3', 'g1'], combinationIds: ['c1'] };
  const views = (result: ReturnType<typeof run>) => result.chips.map((chip) => chip.view);

  it('knows which type each view concerns', () => {
    expect(quickApplies('canMake', 'glazes')).toBe(false);
    expect(quickApplies('canMake', 'combinations')).toBe(true);
    expect(quickApplies('canMake')).toBe(true);
    expect(quickApplies('shelf', 'combinations')).toBe(false);
    expect(quickApplies('shelf', 'glazes')).toBe(true);
    expect(quickApplies('favourites', 'glazes')).toBe(true);
    expect(quickApplies(undefined, 'glazes')).toBe(true);
  });

  it('ignores a view that does nothing here instead of emptying the list', () => {
    expect(activeQuick('canMake', 'glazes', true)).toBe('all');
    expect(activeQuick('shelf', 'combinations', true)).toBe('all');
    expect(activeQuick('favourites', undefined, false)).toBe('all');
    expect(activeQuick('shelf', undefined, false)).toBe('all');
    expect(activeQuick('mine', 'glazes', true)).toBe('all');
    expect(activeQuick('waiting', 'glazes', true)).toBe('waiting');
    expect(activeQuick('mine', undefined, false)).toBe('all');
    expect(activeQuick('new', undefined, false)).toBe('all');
    expect(activeQuick('mine', undefined, true)).toBe('mine');
    expect(activeQuick('new', 'glazes', true)).toBe('new');
    expect(activeQuick('canMake', undefined, true)).toBe('canMake');
  });

  it('shows chips to signed-in users only, for the types they fit', () => {
    expect(run({ favorites: null }).chips).toEqual([]);
    expect(views(run({ favorites }))).toEqual(['all', 'favourites', 'mine', 'waiting', 'new', 'shelf', 'available', 'canMake']);
    expect(views(run({ favorites, filters: { type: 'combinations' } }))).toEqual(['all', 'favourites', 'mine', 'waiting', 'new', 'canMake']);
    expect(views(run({ favorites, filters: { type: 'glazes' } }))).toEqual(['all', 'favourites', 'waiting', 'new', 'shelf', 'available']);
  });

  it('counts what each chip would list for the current search, tags and type', () => {
    const counts = (input: Partial<ExploreInput>) =>
      Object.fromEntries(
        run(input)
          .chips.filter((chip) => !['mine', 'waiting', 'new'].includes(chip.view))
          .map((chip) => [chip.view, chip.count]),
      );
    expect(counts({ favorites, stock })).toEqual({ all: 6, favourites: 3, shelf: 1, available: 1, canMake: 1 });
    // Search and tags narrow every count; the type picks the entries counted.
    expect(counts({ favorites, stock, filters: { q: 'green' } })).toEqual({
      all: 2,
      favourites: 1,
      shelf: 0,
      available: 0,
      canMake: 1,
    });
    expect(counts({ favorites, stock, filters: { tags: ['satin'] } })).toMatchObject({
      all: 3,
      favourites: 3,
    });
    expect(counts({ favorites, stock, filters: { type: 'glazes' } })).toEqual({
      all: 3,
      favourites: 2,
      shelf: 1,
      available: 1,
    });
    // The chosen view does not change the other chips' counts.
    expect(counts({ favorites, stock, filters: { quick: 'favourites' } })).toEqual({
      all: 6,
      favourites: 3,
      shelf: 1,
      available: 1,
      canMake: 1,
    });
  });

  it('lists favourite glazes and combinations together, and counts types within it', () => {
    const result = run({ favorites, filters: { quick: 'favourites' } });
    expect(result.quick).toBe('favourites');
    expect(keys(result.items).sort()).toEqual(['combination:c1', 'glaze:g1', 'glaze:g3']);
    expect(result.counts).toEqual({ all: 3, combinations: 1, glazes: 2 });
    expect(keys(run({ favorites, filters: { quick: 'favourites', type: 'glazes' } }).items)).toEqual(['glaze:g1', 'glaze:g3']);
    expect(run({ favorites: noFavorites, filters: { quick: 'favourites' } }).items).toEqual([]);
  });

  it('lists the glazes on a shelf, glazes only, whatever the search says about combinations', () => {
    const result = run({ favorites, stock, filters: { quick: 'shelf' } });
    expect(keys(result.items)).toEqual(['glaze:g2']);
    // Combinations keep their own link without the view, so their count is not zero.
    expect(result.counts).toEqual({ all: 1, combinations: 3, glazes: 1 });
    expect(keys(run({ favorites, stock, filters: { quick: 'shelf', q: 'PC-3' } }).items)).toEqual([]);
    // Not applicable to the Combinations type: ignored.
    const combinations = run({
      favorites,
      stock,
      filters: { quick: 'shelf', type: 'combinations' },
    });
    expect(combinations.quick).toBe('all');
    expect(combinations.items).toHaveLength(3);
  });

  it('orders the glazes on a shelf by the selected type default', () => {
    const stockAll = [
      { glazeId: 'g1', quantityG: 5 },
      { glazeId: 'g2', quantityG: 5 },
      { glazeId: 'g3', quantityG: 5 },
    ];
    // A quick view keeps the default newest-first order.
    expect(keys(run({ favorites, stock: stockAll, filters: { quick: 'shelf' } }).items)).toEqual(['glaze:g2', 'glaze:g1', 'glaze:g3']);
  });

  it('lists the used up glazes or both parts of the shelf, with a count for each choice', () => {
    // g1 in stock (twice: a used up jar beside a full one), g2 used up only, g3 not on any shelf.
    const stock = [
      { glazeId: 'g1', quantityG: 0 },
      { glazeId: 'g1', quantityG: 50 },
      { glazeId: 'g2', quantityG: 0 },
    ];
    const ids = (stockFilter?: 'used' | 'all') => keys(run({ filters: { quick: 'shelf', type: 'glazes', stock: stockFilter }, stock }).items);
    expect(ids()).toEqual(['glaze:g1']);
    expect(ids('used')).toEqual(['glaze:g2']);
    expect(ids('all').sort()).toEqual(['glaze:g1', 'glaze:g2']);
    const used = run({ filters: { quick: 'shelf', stock: 'used' }, stock });
    expect(used.shelfStock).toBe('used');
    expect(used.shelfChoices).toEqual([
      { choice: 'stock', count: 1 },
      { choice: 'used', count: 1 },
      { choice: 'all', count: 2 },
    ]);
    expect(used.counts.glazes).toBe(1);
    expect(used.chips.find((chip) => chip.view === 'shelf')?.count).toBe(1);
    // Searching narrows the counts of the choices too.
    expect(run({ filters: { quick: 'shelf', q: 'PC-2' }, stock }).shelfChoices.map((entry) => entry.count)).toEqual([0, 1, 1]);
  });

  it('applies the shelf choice only with "On my shelf", for signed-in accounts', () => {
    const stock = [{ glazeId: 'g2', quantityG: 0 }];
    const other = run({ filters: { quick: 'favourites', stock: 'used' }, stock });
    expect(other.shelfStock).toBe('stock');
    expect(other.shelfChoices).toEqual([]);
    expect(run({ filters: { stock: 'used' }, stock }).items).toHaveLength(6);
    const guest = run({ filters: { quick: 'shelf', stock: 'used' }, stock, favorites: null });
    expect(guest.shelfChoices).toEqual([]);
    expect(guest.items).toHaveLength(6);
    // The other chips still count what choosing them lists: the shelf chip says in stock until it is chosen.
    expect(run({ filters: { stock: 'used' }, stock }).chips.find((chip) => chip.view === 'shelf')?.count).toBe(0);
  });

  describe('the scope of On my shelf (27-13)', () => {
    const ada = { id: 'u2', displayName: 'Ada' };
    const holders = (...ids: string[]): BuddyHolders => new Map(ids.map((id) => [id, [ada]]));
    // g1 personal in stock, g2 club in stock, g3 personal used up; g4 (not in these lists) is on no shelf.
    const stock = [
      { glazeId: 'g1', quantityG: 50, clubId: null },
      { glazeId: 'g2', quantityG: 80, clubId: 'club' },
      { glazeId: 'g3', quantityG: 0, clubId: null },
    ];
    const shelf = (extra: Partial<Omit<ExploreInput, 'stock'>> & { part?: 'used' | 'all' } = {}) => {
      const { part, ...input } = extra;
      return run({ filters: { quick: 'shelf', type: 'glazes', stock: part }, stock, ...input });
    };

    it('lists the personal shelf only by default', () => {
      expect(keys(shelf().items)).toEqual(['glaze:g1']);
      expect(keys(shelf({ part: 'used' }).items)).toEqual(['glaze:g3']);
      expect(keys(shelf({ part: 'all' }).items).sort()).toEqual(['glaze:g1', 'glaze:g3']);
      expect(shelf().shelfChoices.map((entry) => entry.count)).toEqual([1, 1, 2]);
      expect(shelf().chips.find((chip) => chip.view === 'shelf')?.count).toBe(1);
    });

    it('keeps personal counts stable when clubs and buddies are included', () => {
      const selected = { includeClubs: true, buddyHolders: holders('g2', 'g3') };
      expect(keys(shelf(selected).items)).toEqual(['glaze:g1']);
      expect(shelf(selected).shelfChoices.map((entry) => entry.count)).toEqual([1, 1, 2]);
      expect(keys(shelf({ ...selected, part: 'used' }).items)).toEqual(['glaze:g3']);
      expect(keys(shelf({ ...selected, part: 'all' }).items).sort()).toEqual(['glaze:g1', 'glaze:g3']);
      expect(shelf(selected).chips.find((chip) => chip.view === 'shelf')?.count).toBe(1);
    });

    it('uses the same selected sources for Available to me and I can make now', () => {
      const available = (extra: Partial<ExploreInput> = {}) => run({ stock, filters: { quick: 'available' }, ...extra });
      expect(keys(available().items)).toEqual(['glaze:g1']);
      expect(keys(available({ includeClubs: true }).items).sort()).toEqual(['glaze:g1', 'glaze:g2']);
      expect(keys(available({ includeClubs: true, buddyHolders: holders('g3') }).items).sort()).toEqual(['glaze:g1', 'glaze:g2', 'glaze:g3']);
      const make = (includeClubs?: boolean) => keys(run({ filters: { quick: 'canMake' }, stock, includeClubs }).items).sort();
      expect(make()).toEqual([]);
      expect(make(false)).toEqual([]);
      expect(make(true)).toEqual(['combination:c1', 'combination:c2']);
      expect(available({ favorites: null }).quick).toBe('all');
    });

    it('is built from the stock list only: scopes of the pure function', () => {
      expect([...shelfScope(stock, {}).stock]).toEqual(['g1']);
      expect([...shelfScope(stock, { clubs: true }).stock].sort()).toEqual(['g1', 'g2']);
      expect([...shelfScope(stock, { entries: true }).entries].sort()).toEqual(['g1', 'g3']);
      expect([...shelfScope(stock, { buddies: ['g9'], entries: true }).stock].sort()).toEqual(['g1', 'g9']);
    });

    it('keeps explicit source options between availability views and drops them elsewhere', () => {
      const route = { ...home, quick: 'available', clubs: true, buddies: false } as const;
      expect(shelfOptionRoute(home, { clubs: true })).toEqual({ ...home, quick: 'available', clubs: true });
      expect(shelfOptionRoute({ ...home, quick: 'canMake' }, { buddies: true })).toEqual({ ...home, quick: 'canMake', buddies: true });
      expect(quickRoute(route, 'canMake')).toEqual({ ...route, quick: 'canMake' });
      expect(almostRoute({ ...route, quick: 'canMake' }, true)).toEqual({ ...route, quick: 'canMake', almost: true });
      expect(quickRoute(route, 'shelf')).toEqual({ ...home, quick: 'shelf' });
      expect(quickRoute(route, 'all')).toEqual(home);
      expect(typeRoute(route, 'combinations')).toEqual({ ...home, type: 'combinations' });
      expect(firingRoute(route, { cone: '6' })).toEqual({ ...home, cone: '6' });
      expect(glazeCombinationsRoute(route, 'g1')).toEqual({ ...home, glaze: 'g1' });
    });
  });

  it('links to the shelf choice and drops it with the quick view', () => {
    const route = { ...home, type: 'glazes', quick: 'shelf', q: 'x' } as const;
    expect(shelfStockRoute(route, 'used')).toEqual({ ...route, stock: 'used' });
    expect(shelfStockRoute({ ...route, stock: 'used' }, 'stock')).toEqual(route);
    expect(shelfStockRoute({ ...home, type: 'glazes' }, 'all')).toEqual({ ...route, q: undefined, stock: 'all' });
    expect(quickRoute({ ...route, stock: 'all' }, 'shelf')).toEqual(route);
    expect(quickRoute({ ...route, stock: 'all' }, 'favourites').stock).toBeUndefined();
    expect(typeRoute({ ...route, stock: 'all' }, 'combinations').stock).toBeUndefined();
    expect(typeRoute({ ...route, stock: 'all' }, undefined).stock).toBe('all');
    expect(firingRoute({ ...route, type: undefined, stock: 'all' }, { cone: '6' }).stock).toBeUndefined();
    expect(glazeCombinationsRoute({ ...route, stock: 'all' }, 'g1').stock).toBeUndefined();
  });

  it('lists the combinations that can be made from the shelf, combinations only', () => {
    const result = run({ favorites, stock, filters: { quick: 'canMake' } });
    expect(result.quick).toBe('canMake');
    expect(keys(result.items)).toEqual(['combination:c2']);
    // c3 uses g3 (0 g), c1 uses g1 (not on the shelf).
    expect(result.counts).toEqual({ all: 1, combinations: 1, glazes: 3 });
    expect(run({ favorites, stock, filters: { quick: 'canMake', type: 'glazes' } }).quick).toBe('all');
  });

  it('counts club stock like a personal shelf and ignores glaze steps without stock above 0 g', () => {
    const shelf = [
      { glazeId: 'g1', quantityG: 1 },
      { glazeId: 'g2', quantityG: 1 },
      { glazeId: 'g3', quantityG: 0.5 },
    ];
    expect(keys(run({ favorites, stock: shelf, filters: { quick: 'canMake' } }).items).sort()).toEqual(['combination:c1', 'combination:c2', 'combination:c3']);
  });

  it('marks "I can make now" unusable without stock, until it is the chosen view', () => {
    const chip = (input: Partial<ExploreInput>) => run(input).chips.find((entry) => entry.view === 'canMake');
    expect(chip({ favorites, stock: [] })?.reason).toBe('noShelf');
    expect(chip({ favorites, stock: [{ glazeId: 'g1', quantityG: 0 }] })?.reason).toBe('noShelf');
    expect(chip({ favorites, stock })?.reason).toBeUndefined();
    // Following an old link keeps the chip active, so it can still be read and left.
    expect(chip({ favorites, stock: [], filters: { quick: 'canMake' } })?.reason).toBeUndefined();
    expect(run({ favorites, stock: [], filters: { quick: 'canMake' } }).items).toEqual([]);
  });

  it('never lists a combination without glaze steps as makeable', () => {
    const firing = customStep({ label: 'Bisque' });
    const fired = combo('c4', 'Fired only', [], { steps: [firing] });
    const result = run({ favorites, stock, filters: { quick: 'canMake' } }, [g1, g2, g3], [fired, c2]);
    expect(keys(result.items)).toEqual(['combination:c2']);
    expect(result.chips.find((chip) => chip.view === 'canMake')?.count).toBe(1);
  });

  it('gives guests the whole list for account views in a shared link', () => {
    for (const quick of ['favourites', 'shelf', 'canMake'] as const) expect(run({ favorites: null, stock, filters: { quick } }).counts.all).toBe(6);
  });
});

describe('quick links and shelves', () => {
  it('sets or clears the view and keeps the rest', () => {
    const route = { ...home, type: 'glazes', q: 'x', quick: 'favourites' } as const;
    expect(quickRoute(route, 'shelf')).toEqual({ ...route, quick: 'shelf' });
    expect(quickRoute(route, 'all')).toEqual({ name: 'discover', type: 'glazes', q: 'x' });
  });

  it('drops a view that concerns the other type from the type links', () => {
    expect(typeRoute({ ...home, quick: 'shelf' }, 'combinations').quick).toBeUndefined();
    expect(typeRoute({ ...home, quick: 'shelf' }, 'glazes').quick).toBe('shelf');
    expect(typeRoute({ ...home, type: 'glazes', quick: 'shelf' }).quick).toBe('shelf');
    expect(typeRoute({ ...home, quick: 'canMake' }, 'combinations').quick).toBe('canMake');
  });

  it('shows the combinations of a glaze without "On my shelf"', () => {
    expect(glazeCombinationsRoute({ ...home, quick: 'shelf' }, 'g1').quick).toBeUndefined();
    expect(glazeCombinationsRoute({ ...home, quick: 'favourites' }, 'g1').quick).toBe('favourites');
  });

  it('names the shelves with something on them', () => {
    const row = (quantityG: number, clubId: string | null, clubName: string | null) => ({
      quantityG,
      clubId,
      clubName,
    });
    expect(shelfSources([])).toEqual({ personal: false, clubs: [] });
    expect(
      shelfSources([
        row(10, null, null),
        row(5, 'c2', 'Sunday Clay Studio'),
        row(5, 'c2', 'Sunday Clay Studio'),
        row(0, 'c3', 'Empty Club'),
        row(1, 'c1', 'Ada Pottery'),
      ]),
    ).toEqual({ personal: true, clubs: ['Ada Pottery', 'Sunday Clay Studio'] });
    expect(shelfSources([row(0, null, null), row(2, 'c1', 'Club')])).toEqual({
      personal: false,
      clubs: ['Club'],
    });
  });
});

describe('Mine, Waiting for photos and New', () => {
  const now = Date.parse('2026-06-15T12:00:00Z');
  const day = 86_400_000;
  const ago = (days: number) => new Date(now - days * day).toISOString();
  const glazes = [
    glazeOf('g1', 'PC-1', { createdAt: ago(3) }),
    glazeOf('g2', 'PC-2', { createdAt: ago(30) }),
    glazeOf('g3', 'PC-3', { createdAt: null as unknown as string }),
  ];
  const combos = [
    combo('own-new', 'Own new', ['g1'], { own: true, createdAt: ago(1) }),
    combo('own-old', 'Own old', ['g2'], { own: true, createdAt: ago(60) }),
    combo('own-newer', 'Own newer', ['g2'], { own: true, createdAt: ago(20) }),
    combo('own-photo', 'Own photo', ['g1'], {
      own: true,
      createdAt: ago(5),
      images: [imageInfo({ id: 'x' })],
    }),
    combo('other', 'Other', ['g1'], { createdAt: ago(2) }),
    combo('other-old', 'Other old', ['g1'], { createdAt: ago(40) }),
  ];
  const favorites = noFavorites;
  const go = (filters: ExploreInput['filters'], signedIn = true) => run({ filters, now, favorites: signedIn ? favorites : null }, glazes, combos);

  it("lists the account's own combinations only", () => {
    const result = go({ quick: 'mine' });
    expect(result.quick).toBe('mine');
    expect(keys(result.items).sort()).toEqual(['combination:own-new', 'combination:own-newer', 'combination:own-old', 'combination:own-photo']);
    // Combinations only: the type counts say what each type's link shows.
    expect(result.counts).toEqual({ all: 4, combinations: 4, glazes: 3 });
    expect(keys(go({ quick: 'mine', q: 'newer' }).items)).toEqual(['combination:own-newer']);
  });

  it('lists glazes and own combinations without a photo, newest first', () => {
    const result = go({ quick: 'waiting' });
    expect(keys(result.items)).toEqual(['combination:own-new', 'glaze:g1', 'combination:own-newer', 'glaze:g2', 'combination:own-old', 'glaze:g3']);
    expect(isWaiting(combos[3])).toBe(false);
    expect(isWaiting(combos[4])).toBe(false);
    expect(isWaiting({ own: true, images: undefined as never })).toBe(true);
  });

  it('lists what was created in the last 14 days, both kinds, glazes without a creation time never', () => {
    const result = go({ quick: 'new' });
    expect(keys(result.items).sort()).toEqual(['combination:other', 'combination:own-new', 'combination:own-photo', 'glaze:g1']);
    expect(keys(go({ quick: 'new', type: 'glazes' }).items)).toEqual(['glaze:g1']);
    expect(keys(go({ quick: 'new', type: 'combinations' }).items)).toHaveLength(3);
  });

  it('counts the 14th day in and the 15th out, on a fixed clock', () => {
    const edge = (days: number) => ({ createdAt: ago(days) });
    expect(newDays).toBe(14);
    expect(isNew(listedTime(edge(14)), now)).toBe(true);
    expect(isNew(listedTime({ createdAt: new Date(now - 14 * day - 1).toISOString() }), now)).toBe(false);
    expect(isNew(listedTime(edge(0)), now)).toBe(true);
    expect(isNew(listedTime({ createdAt: null }), now)).toBe(false);
    expect(isNew(listedTime({}), now)).toBe(false);
    expect(isNew(listedTime({ createdAt: 'not a date' }), now)).toBe(false);
    // Unknown stays unknown on any clock, not a time near 1970.
    expect(isNew(listedTime({ createdAt: null }), 0)).toBe(false);
    // The clock decides: a month later nothing is new any more.
    expect(run({ filters: { quick: 'new' }, now: now + 30 * day, favorites }, glazes, combos).items).toEqual([]);
  });

  it('counts each chip for the current search and type', () => {
    const counts = (filters: ExploreInput['filters']) => Object.fromEntries(go(filters).chips.map((chip) => [chip.view, chip.count]));
    expect(counts({})).toMatchObject({ all: 9, mine: 4, waiting: 6, new: 4 });
    expect(counts({ type: 'glazes' })).toMatchObject({ all: 3, new: 1 });
    expect(counts({ type: 'glazes' })).not.toHaveProperty('mine');
    expect(counts({ q: 'own' })).toMatchObject({ mine: 4, waiting: 3, new: 2 });
  });

  it('does nothing for guests and for the Glazes type', () => {
    expect(go({ quick: 'mine' }, false).quick).toBe('all');
    expect(go({ quick: 'mine' }, false).items).toHaveLength(9);
    expect(go({ quick: 'new' }, false).chips).toEqual([]);
    expect(go({ quick: 'waiting', type: 'glazes' }).items).toHaveLength(3);
    expect(go({ quick: 'waiting', type: 'glazes' }).quick).toBe('waiting');
  });

  it('keeps the link of a chip and removes it where it does not apply', () => {
    expect(quickRoute(home, 'waiting')).toEqual({ ...home, quick: 'waiting' });
    expect(typeRoute({ ...home, quick: 'mine' }, 'glazes')).toEqual({ ...home, type: 'glazes' });
    expect(typeRoute({ ...home, quick: 'new' }, 'glazes')).toEqual({
      ...home,
      type: 'glazes',
      quick: 'new',
    });
  });
});

describe('sort choices', () => {
  it('keeps the totals of a glaze and a combination with the same ID apart', () => {
    const glazes = [glazeOf('same', 'A', { createdAt: '2026-01-01T00:00:00Z' })];
    const combos = [combo('same', 'B', [], { createdAt: '2026-01-01T00:00:00Z' }), combo('other', 'C', [], { createdAt: '2026-01-01T00:00:00Z' })];
    const favoriteCounts = { glazes: [{ id: 'same', count: 1 }], combinations: [{ id: 'other', count: 2 }] };
    expect(keys(run({ filters: { sort: 'favourites' }, favoriteCounts }, glazes, combos).items)).toEqual([
      'combination:other',
      'glaze:same',
      'combination:same',
    ]);
  });

  it('finds a glaze by its notes, which pickers do not search', () => {
    const noted = glazeOf('n', 'Q1', { notes: 'cobalt wash' });
    expect(keys(run({ filters: { q: 'cobalt' } }, [noted], []).items)).toEqual(['glaze:n']);
  });

  it('orders both kinds by public favourite totals, then age, with missing totals treated as zero', () => {
    const result = run({
      filters: { sort: 'favourites' },
      favoriteCounts: {
        glazes: [
          { id: 'g1', count: 4 },
          { id: 'g2', count: 4 },
        ],
        combinations: [
          { id: 'c1', count: 8 },
          { id: 'c2', count: 4 },
        ],
      },
    });
    expect(keys(result.items)).toEqual(['combination:c1', 'glaze:g2', 'combination:c2', 'glaze:g1', 'combination:c3', 'glaze:g3']);
    expect(result.counts).toEqual(run().counts);
  });
  it.each([
    [undefined, 'favourites', ['combination:c3', 'glaze:g2', 'combination:c2', 'combination:c1', 'glaze:g1', 'glaze:g3']],
    [undefined, 'newest', ['combination:c3', 'glaze:g2', 'combination:c2', 'combination:c1', 'glaze:g1', 'glaze:g3']],
    [undefined, 'az', ['glaze:g1', 'glaze:g2', 'glaze:g3', 'combination:c1', 'combination:c2', 'combination:c3']],
    ['combinations', 'favourites', ['combination:c3', 'combination:c2', 'combination:c1']],
    ['combinations', 'newest', ['combination:c3', 'combination:c2', 'combination:c1']],
    ['combinations', 'az', ['combination:c1', 'combination:c2', 'combination:c3']],
    ['glazes', 'used', ['glaze:g2', 'glaze:g1', 'glaze:g3']],
    ['glazes', 'newest', ['glaze:g2', 'glaze:g1', 'glaze:g3']],
    ['glazes', 'az', ['glaze:g1', 'glaze:g2', 'glaze:g3']],
  ] as const)('orders %s by %s', (type, sort, expected) => {
    const result = run({ filters: { type, sort } });
    expect(keys(result.items)).toEqual(expected);
    // Sorting changes no counts or filters.
    expect(result.counts).toEqual(run({ filters: { type } }).counts);
  });

  it('falls back to the type default for an inapplicable sort', () => {
    expect(keys(run({ filters: { sort: 'used' } }).items)).toEqual(keys(run().items));
    expect(keys(run({ filters: { type: 'combinations', sort: 'used' } }).items)).toEqual(keys(run({ filters: { type: 'combinations' } }).items));
    expect(keys(run({ filters: { type: 'glazes', sort: 'favourites' } }).items)).toEqual(keys(run({ filters: { type: 'glazes' } }).items));
  });

  it('uses display code, not glaze name, for A–Z', () => {
    const glazes = [glazeOf('a', 'Z-1', { name: 'Alpha' }), glazeOf('b', 'A-1', { name: 'Zed' })];
    expect(keys(run({ filters: { type: 'glazes', sort: 'az' } }, glazes, []).items)).toEqual(['glaze:b', 'glaze:a']);
  });

  it('breaks every sort tie by identity, independently of input order, including mixed A–Z', () => {
    const glazes = [glazeOf('g2', 'PC-1'), glazeOf('g1', 'PC-1')];
    const combos = [combo('c2', 'Amaco PC-1', []), combo('c1', 'Amaco PC-1', [])];
    for (const sort of ['favourites', 'newest', 'az', 'used'] as const) {
      for (const type of [undefined, 'combinations', 'glazes'] as const) {
        const expected =
          type === 'glazes'
            ? ['glaze:g1', 'glaze:g2']
            : type === 'combinations'
              ? ['combination:c1', 'combination:c2']
              : ['combination:c1', 'combination:c2', 'glaze:g1', 'glaze:g2'];
        expect(keys(run({ filters: { type, sort } }, glazes, combos).items)).toEqual(expected);
        expect(keys(run({ filters: { type, sort } }, [...glazes].reverse(), [...combos].reverse()).items)).toEqual(expected);
      }
    }
  });

  it('orders A–Z by base letters: accents and case tie, then kind and ID decide', () => {
    const titled = (id: string, title: string) => combination({ id, title, steps: [] });
    const combos = [
      titled('c6', 'Zürich'),
      titled('c5', 'zebra'),
      titled('c4', 'ÉCLAIR'),
      titled('c3', 'eclair'),
      titled('c2', 'Éclair'),
      titled('c1', 'apple'),
      titled('c7', 'Apple 2'),
      titled('c8', 'Äpfel'),
    ];
    const glazes = [glazeOf('g1', 'Z', { manufacturer: { ...g1.manufacturer, name: 'Eclair' } })];
    const expected = [
      'combination:c8', // Äpfel before apple: the third letters decide, the accent does not.
      'combination:c1',
      'combination:c7',
      'combination:c2',
      'combination:c3',
      'combination:c4',
      'glaze:g1',
      'combination:c5',
      'combination:c6',
    ];
    expect(keys(run({ filters: { sort: 'az' } }, glazes, combos).items)).toEqual(expected);
    expect(keys(run({ filters: { sort: 'az' } }, glazes, [...combos].reverse()).items)).toEqual(expected);
  });

  it('orders by date with invalid, empty and missing dates last, tied by identity', () => {
    const dated = (id: string, publishedAt: string | null, createdAt?: string) =>
      combination({ id, title: id, steps: [], publishedAt, createdAt: createdAt as string });
    const combos = [
      dated('z-missing', null, undefined),
      dated('y-invalid', 'yesterday-ish', undefined),
      dated('b-empty', '', 'not a date'),
      dated('old', null, '2026-01-01T00:00:00Z'),
      dated('new', '2026-03-01T00:00:00Z', '2026-01-01T00:00:00Z'),
      dated('same-b', '2026-02-01T00:00:00Z'),
      dated('same-a', '2026-02-01T01:00:00+01:00'),
    ];
    const expected = ['new', 'same-a', 'same-b', 'old', 'b-empty', 'y-invalid', 'z-missing'].map((id) => `combination:${id}`);
    for (const list of [combos, [...combos].reverse()]) {
      expect(keys(run({ filters: { sort: 'newest' } }, [], list).items)).toEqual(expected);
      expect(keys(run({ filters: { sort: 'favourites' } }, [], list).items)).toEqual(expected);
    }
    const glazes = [glazeOf('none', 'A', { createdAt: '' }), glazeOf('dated', 'B', { createdAt: '2026-01-01T00:00:00Z' })];
    expect(keys(mostUsed(glazes))).toEqual(['glaze:dated', 'glaze:none']);
  });

  it('compares titles as plain English text: digits one by one, punctuation counted, no letter expanded', () => {
    const titled = (id: string, title: string) => combination({ id, title, steps: [] });
    const az = (...titles: string[]) =>
      run(
        { filters: { sort: 'az' } },
        [],
        titles.map((title, index) => titled(`c${index}`, title)),
      ).items.map((entry) => (entry.item as Combination).title);
    expect(az('Apple 2', 'Apple 10')).toEqual(['Apple 10', 'Apple 2']);
    expect(az('coop', 'cook', 'co-op')).toEqual(['co-op', 'cook', 'coop']);
    expect(az('Müller', 'Muffin')).toEqual(['Muffin', 'Müller']);
  });

  it('counts a missing total or use as zero, below any listed one and level with a listed zero', () => {
    const older = combo('older', 'A', [], { createdAt: '2026-01-01T00:00:00Z' });
    const zero = combo('zero', 'B', [], { createdAt: '2026-02-01T00:00:00Z' });
    const newer = combo('newer', 'C', [], { createdAt: '2026-03-01T00:00:00Z' });
    const favoriteCounts = {
      glazes: [],
      combinations: [
        { id: 'older', count: 1 },
        { id: 'zero', count: 0 },
      ],
    };
    expect(keys(run({ filters: { sort: 'favourites' }, favoriteCounts }, [], [older, zero, newer]).items)).toEqual([
      'combination:older',
      'combination:newer',
      'combination:zero',
    ]);

    const glazes = [older, newer].map((item) => ({ ...glazeOf(item.id, item.title), createdAt: item.createdAt }));
    expect(keys(mostUsed(glazes, 'older', 1))).toEqual(['glaze:older', 'glaze:newer']);
  });

  describe('date cache', () => {
    afterEach(() => vi.restoreAllMocks());

    it('parses each item once, also one without a date, however often it is compared', () => {
      const items = [{ createdAt: '2026-01-01T00:00:00Z' }, { createdAt: 'not a date' }, { createdAt: '' }, {}, { createdAt: '2026-02-01T00:00:00Z' }];
      const parse = vi.spyOn(Date, 'parse');
      const match = vi.spyOn(RegExp.prototype, 'exec');
      for (let round = 0; round < 3; round++) {
        [...items].sort(newestFirst);
        items.forEach((item) => isNew(listedTime(item), 0));
      }
      // Only the two dates reach `Date.parse`; the shape check runs once per item with text.
      expect(parse).toHaveBeenCalledTimes(2);
      expect(match).toHaveBeenCalledTimes(3);
    });

    it('reads a replacement afresh: a new object with the same ID has its own date', () => {
      const draft = combination({ id: 'same', publishedAt: null, createdAt: '2026-01-01T00:00:00Z' });
      const other = combination({ id: 'other', publishedAt: null, createdAt: '2026-02-01T00:00:00Z' });
      expect(keys(run({ filters: { sort: 'newest' } }, [], [draft, other]).items)).toEqual(['combination:other', 'combination:same']);
      const publishedLater = { ...draft, publishedAt: '2026-03-01T00:00:00Z' };
      expect(keys(run({ filters: { sort: 'newest' } }, [], [publishedLater, other]).items)).toEqual(['combination:same', 'combination:other']);
    });
  });

  it('compares distinct visible combinations before photos', () => {
    const glazes = [
      glazeOf('one', 'A', { images: [imageInfo({ id: 'a' })] }),
      glazeOf('two', 'B', { images: [imageInfo({ id: 'b' })] }),
      glazeOf('three', 'C'),
    ];
    const combos = [combo('a', 'A', ['one', 'one', 'two', 'three']), combo('b', 'B', ['two', 'three']), combo('c', 'C', ['three'])];
    expect(keys(run({ filters: { type: 'glazes', sort: 'used' } }, glazes, combos).items)).toEqual(['glaze:three', 'glaze:two', 'glaze:one']);
  });

  it('drops inapplicable sorts on type links and keeps common sorts', () => {
    expect(typeRoute({ ...home, type: 'glazes', sort: 'used' })).toEqual(home);
    expect(typeRoute({ ...home, sort: 'favourites' }, 'glazes')).toEqual({ ...home, type: 'glazes', sort: 'favourites' });
    expect(typeRoute({ ...home, sort: 'az' }, 'glazes')).toEqual({
      ...home,
      type: 'glazes',
      sort: 'az',
    });
    expect(typeRoute({ ...home, type: 'glazes', sort: 'newest' }, 'combinations')).toEqual({
      ...home,
      type: 'combinations',
    });
  });
});

it('treats packaging-only glazes as waiting for result photos when sorting', () => {
  const jar = { ...imageInfo({ id: 'jar' }), kind: 'PACKAGING' as const };
  const packaging: ExploreItem = { kind: 'glaze', item: glazeOf('g1', 'P-1', { images: [jar] }) };
  const result: ExploreItem = {
    kind: 'glaze',
    item: glazeOf('g2', 'P-2', { images: [imageInfo({ id: 'tile' })] }),
  };
  expect(hasPhoto(packaging)).toBe(false);
  expect(hasPhoto(result)).toBe(true);
  expect(hasPhoto(packaging)).toBe(false);
  expect(hasPhoto(result)).toBe(true);
});

describe('drafts', () => {
  const draft = combo('d1', 'Unfinished blue', ['g1', 'g3'], {
    own: true,
    draft: true,
    createdAt: '2026-09-30T00:00:00Z',
  });
  const mine = combo('m1', 'Mine published', ['g3'], { own: true });
  const go = (filters: ExploreInput['filters']) => run({ filters }, [g1, g2, g3], [c1, c2, c3, mine, draft]);

  it("lists the author's drafts only under Mine", () => {
    expect(keys(go({}).items)).not.toContain('combination:d1');
    expect(keys(go({ type: 'combinations' }).items)).not.toContain('combination:d1');
    expect(keys(go({ q: 'unfinished' }).items)).toEqual([]);
    expect(keys(go({ glaze: 'g3' }).items)).not.toContain('combination:d1');
    expect(keys(go({ quick: 'new' }).items)).not.toContain('combination:d1');
    expect(keys(go({ quick: 'waiting' }).items)).toEqual(['glaze:g2', 'combination:m1', 'glaze:g3']);
    expect(keys(go({ quick: 'mine' }).items).sort()).toEqual(['combination:d1', 'combination:m1']);
    expect(go({ quick: 'mine' }).chips.find((chip) => chip.view === 'mine')?.count).toBe(2);
    expect(go({}).counts.combinations).toBe(4);
  });

  it('never counts drafts as glaze usage or as waiting for photos', () => {
    expect(glazeUsage([draft, mine]).get('g3')).toBe(1);
    expect(glazeUsage([draft]).has('g1')).toBe(false);
    expect(isWaiting(draft)).toBe(false);
    expect(isWaiting(mine)).toBe(true);
    expect(published([c1, draft, mine])).toEqual([c1, mine]);
  });

  it('never counts a draft as missing one glaze for I can make now', () => {
    // g1 owned: the draft (g1, g3) misses only g3, like c2 (g2) and mine (g3).
    const stock = [{ glazeId: 'g1', quantityG: 100 }];
    const result = run({ filters: { quick: 'canMake' }, stock }, [g1, g2, g3], [c2, mine, draft]);
    expect(result.oneMissing).toBe(2);
  });
});

describe('publication date', () => {
  const now = Date.parse('2026-06-15T12:00:00Z');
  const day = 86_400_000;
  const ago = (days: number) => new Date(now - days * day).toISOString();
  // Started 90 days ago, published 2 days ago.
  const late = combo('late', 'Published late', ['g1'], {
    createdAt: ago(90),
    publishedAt: ago(2),
  });
  // Published 20 days ago; created at the same moment (a direct create).
  const direct = combo('direct', 'Direct', ['g1'], { createdAt: ago(20), publishedAt: ago(20) });
  // A listing saved before publication dates has none: the creation time stands in.
  const legacy = combo('legacy', 'Legacy', ['g1'], { createdAt: ago(5) });
  const draft = combo('draft', 'Draft', ['g1'], {
    own: true,
    draft: true,
    createdAt: ago(1),
    publishedAt: null,
  });
  const glazes = [glazeOf('g1', 'PC-1', { createdAt: ago(10) })];
  const go = (filters: ExploreInput['filters']) => run({ filters, now, favorites: noFavorites }, glazes, [late, direct, legacy, draft]);

  it('chooses the publication, else the creation date', () => {
    expect(listedAt(late)).toBe(ago(2));
    expect(listedAt(legacy)).toBe(ago(5));
    expect(listedAt(draft)).toBe(ago(1));
    expect(listedAt({ createdAt: ago(3) })).toBe(ago(3));
    expect(listedAt({ createdAt: ago(3), publishedAt: '' })).toBe(ago(3));
    expect(listedAt({})).toBeUndefined();
    expect(listedAt(glazes[0])).toBe(ago(10));
  });

  it('counts a draft published weeks later as new, and a glaze by its creation', () => {
    expect(isNew(listedTime(late), now)).toBe(true);
    expect(isNew(listedTime({ ...late, publishedAt: ago(15) }), now)).toBe(false);
    expect(isNew(listedTime(direct), now)).toBe(false);
    expect(isNew(listedTime(legacy), now)).toBe(true);
    expect(isNew(listedTime(draft), now)).toBe(true);
    expect(isNew(listedTime(glazes[0]), now)).toBe(true);
    expect(isNew(listedTime({ createdAt: ago(20), publishedAt: 'not a date' }), now)).toBe(false);
  });

  it('lists New by publication and leaves the draft to Mine', () => {
    expect(keys(go({ quick: 'new' }).items)).toEqual(['combination:late', 'combination:legacy', 'glaze:g1']);
    expect(keys(go({ quick: 'new', type: 'combinations' }).items)).toEqual(['combination:late', 'combination:legacy']);
  });

  it('orders Newest by publication, not creation', () => {
    expect(keys(go({ sort: 'newest' }).items)).toEqual(['combination:late', 'combination:legacy', 'glaze:g1', 'combination:direct']);
    // The default order is photos first, then the same newest-first order.
    expect(keys(go({}).items)).toEqual(keys(go({ sort: 'newest' }).items));
    expect(keys(go({ type: 'combinations', sort: 'favourites' }).items)).toEqual(['combination:late', 'combination:legacy', 'combination:direct']);
  });

  it("keeps sorting the author's drafts under Mine by their creation", () => {
    const older = combo('older', 'Older draft', [], {
      own: true,
      draft: true,
      createdAt: ago(40),
      publishedAt: null,
    });
    const own = { ...late, own: true };
    const result = run({ filters: { quick: 'mine' }, now, favorites: noFavorites }, glazes, [older, draft, own]);
    // The draft (started 1 day ago) is newer than the publication 2 days ago; the older draft is last.
    expect(keys(result.items)).toEqual(['combination:draft', 'combination:late', 'combination:older']);
  });

  it('sorts glazes with listings from before publication dates by creation', () => {
    const items = go({ type: 'glazes', sort: 'newest' }).items;
    expect(keys(items)).toEqual(['glaze:g1']);
  });
});

describe('an empty library', () => {
  const draft = { draft: true };
  it("is not changed by the author's own drafts", () => {
    expect(isLibraryEmpty(undefined, [], [draft])).toBe(true);
    expect(isLibraryEmpty('combinations', [], [draft, draft])).toBe(true);
    expect(isLibraryEmpty('combinations', [{}], [draft])).toBe(true);
    expect(isLibraryEmpty('glazes', [], [draft])).toBe(true);
  });
  it('ends with the first published combination or glaze', () => {
    expect(isLibraryEmpty(undefined, [], [draft, {}])).toBe(false);
    expect(isLibraryEmpty(undefined, [{}], [draft])).toBe(false);
    expect(isLibraryEmpty('combinations', [], [{ draft: false }])).toBe(false);
    expect(isLibraryEmpty('glazes', [{}], [])).toBe(false);
  });
});

describe('final-firing filters', () => {
  const ox6 = combo('f1', 'Ox six', ['g1'], { cone: '6', atmosphere: 'OXIDATION' });
  const red6 = combo('f2', 'Red six', ['g2'], { cone: '6', atmosphere: 'REDUCTION' });
  const ox04 = combo('f3', 'Low ox', ['g3'], { cone: '04', atmosphere: 'OXIDATION' });
  const draft6 = combo('f4', 'Draft six', ['g1'], { cone: '6', own: true, draft: true });
  const none = combo('f5', 'Unrecorded', ['g1']);
  const all = [ox6, red6, ox04, draft6, none];
  const go = (filters: ExploreInput['filters'], stock: ExploreInput['stock'] = []) => run({ filters, stock }, [g1, g2, g3], all);
  const sorted = (items: ExploreItem[]) => keys(items).sort();

  it('matches exact cones and atmospheres, a missing value never', () => {
    expect(matchesFiring(ox6, { cone: '6' })).toBe(true);
    expect(matchesFiring(ox04, { cone: '4' })).toBe(false);
    expect(matchesFiring(none, { atmosphere: 'OXIDATION' })).toBe(false);
    expect(matchesFiring(none, {})).toBe(true);
  });

  it('narrows All to the combinations fired that way, leaving the glazes out', () => {
    expect(sorted(go({ cone: '6' }).items)).toEqual(['combination:f1', 'combination:f2']);
    expect(sorted(go({ atmosphere: 'OXIDATION' }).items)).toEqual(['combination:f1', 'combination:f3']);
    expect(keys(go({ cone: '6', atmosphere: 'REDUCTION' }).items)).toEqual(['combination:f2']);
    expect(keys(go({ cone: '10' }).items)).toEqual([]);
    expect(sorted(go({ type: 'combinations', cone: '6' }).items)).toEqual(['combination:f1', 'combination:f2']);
  });

  it('counts each type link as it would list, ignoring the filters for Glazes', () => {
    const counts = go({ cone: '6' }).counts;
    expect(counts).toEqual({ all: 2, combinations: 2, glazes: 3 });
    // A hand-edited Glazes link with a cone lists every glaze.
    expect(keys(go({ type: 'glazes', cone: '6' }).items)).toHaveLength(3);
  });

  it('keeps drafts under Mine only and combines with search and quick views', () => {
    expect(sorted(go({ cone: '6', quick: 'mine' }).items)).toEqual(['combination:f4']);
    expect(keys(go({ cone: '6', q: 'red' }).items)).toEqual(['combination:f2']);
    const stock = [{ glazeId: 'g1', quantityG: 100 }];
    expect(keys(go({ cone: '6', quick: 'canMake' }, stock).items)).toEqual(['combination:f1']);
    // f2 misses g2 only, like f3 misses g3; the cone keeps f2 alone.
    expect(go({ cone: '6', quick: 'canMake' }, stock).oneMissing).toBe(1);
  });

  it('hides and ignores "On my shelf" while a firing filter narrows All', () => {
    const stock = [{ glazeId: 'g1', quantityG: 100 }];
    const result = go({ cone: '6', quick: 'shelf' }, stock);
    expect(result.quick).toBe('all');
    expect(result.chips.map((chip) => chip.view)).not.toContain('shelf');
    expect(effectiveType({ cone: '6' })).toBe('combinations');
    expect(effectiveType({ type: 'glazes', cone: '6' })).toBe('glazes');
    expect(effectiveType({})).toBeUndefined();
  });

  it('sets and clears filters in the link, dropping "On my shelf" and leaving them out for Glazes', () => {
    const route = { ...home, q: 'x', quick: 'shelf' as const };
    expect(firingRoute(route, { cone: '6' })).toEqual({ ...home, q: 'x', cone: '6' });
    expect(firingRoute({ ...home, cone: '6', atmosphere: 'OTHER' }, { cone: undefined })).toEqual({
      ...home,
      atmosphere: 'OTHER',
    });
    expect(firingRoute({ ...home, quick: 'mine' }, { atmosphere: 'REDUCTION' })).toEqual({
      ...home,
      quick: 'mine',
      atmosphere: 'REDUCTION',
    });
    const fired = {
      ...home,
      cone: '6',
      atmosphere: 'OXIDATION' as const,
      quick: 'favourites' as const,
    };
    expect(typeRoute(fired, 'glazes')).toEqual({ ...home, type: 'glazes', quick: 'favourites' });
    expect(typeRoute(fired, 'combinations')).toEqual({ ...fired, type: 'combinations' });
    expect(typeRoute({ ...home, type: 'glazes', quick: 'shelf' }, undefined)).toEqual({
      ...home,
      quick: 'shelf',
    });
    expect(typeRoute({ ...home, type: 'combinations', cone: '6', quick: 'canMake' }, undefined)).toEqual({
      ...home,
      cone: '6',
      quick: 'canMake',
    });
  });
});

describe('picture-first discovery', () => {
  const entries: ExploreItem[] = [
    { kind: 'combination', item: c1 },
    { kind: 'glaze', item: g1 },
    { kind: 'combination', item: c2 },
    { kind: 'glaze', item: glaze({ id: 'packaging', images: [imageInfo({ kind: 'PACKAGING' })] }) },
  ];
  it('defers empty/packaging-only previews, then appends them without moving pictured entries', () => {
    expect(keys(photoBrowse(entries, {}, 'all').items)).toEqual(['glaze:g1', 'combination:c2']);
    expect(photoBrowse(entries, {}, 'all').deferred).toBe(2);
    expect(keys(photoBrowse(entries, {}, 'all', true).items)).toEqual(['glaze:g1', 'combination:c2', 'combination:c1', 'glaze:packaging']);
    expect(photoBrowse(entries, {}, 'all', true).deferred).toBe(0);
    expect(photoBrowse(entries, { q: '  ' }, 'new').deferred).toBe(2);
  });
  it('keeps search, explicit glaze lookups and personal views complete and in their chosen order', () => {
    expect(photoBrowse(entries, { q: 'blue' }, 'all').items).toBe(entries);
    expect(photoBrowse(entries, { glaze: 'g1' }, 'all').items).toBe(entries);
    for (const quick of ['mine', 'waiting', 'favourites', 'shelf', 'canMake'] as const) {
      expect(photoBrowse(entries, {}, quick)).toEqual({ items: entries, deferred: 0 });
    }
  });
});

describe('a listing kept between runs', () => {
  const stockOf = (...glazeIds: string[]) => glazeIds.map((glazeId) => ({ glazeId, quantityG: 100 }));
  const own = combo('own', 'Own', ['g1'], { own: true, createdAt: '2026-09-30T00:00:00Z' });
  const draft = combo('draft', 'Draft', ['g1'], { own: true, draft: true });
  const combos = [c1, c2, c3, own, draft];
  const glazes = [g1, g2, g3];
  /** Every run shares the arrays, so everything kept per listing is live; only `input` differs. */
  const session = (input: Partial<ExploreInput>) => run(input, glazes, combos);
  const chip = (result: ReturnType<typeof run>, view: string) => result.chips.find((item) => item.view === view)?.count;

  it('follows the stock, whatever view asks', () => {
    const filters: ExploreInput['filters'] = { quick: 'canMake' };
    expect(keys(session({ filters, stock: stockOf('g1') }).items)).toEqual(['combination:own']);
    expect(keys(session({ filters, stock: stockOf('g1', 'g2') }).items)).toEqual(['combination:own', 'combination:c2', 'combination:c1']);
    expect(session({ filters, stock: stockOf('g1', 'g2') }).oneMissing).toBe(1);
    expect(keys(session({ filters, stock: [] }).items)).toEqual([]);
    expect(keys(session({ filters, stock: [{ glazeId: 'g1', quantityG: 0 }] }).items)).toEqual([]);
    expect(keys(session({ filters, stock: stockOf('g1') }).items)).toEqual(['combination:own']);
  });

  it('follows the buddies and the clubs in and out of the scope', () => {
    const filters: ExploreInput['filters'] = { quick: 'canMake' };
    const stock = [...stockOf('g1'), { glazeId: 'g2', quantityG: 100, clubId: 'club' }];
    const holders: BuddyHolders = new Map([['g2', []]]);
    const names = ['combination:own', 'combination:c2', 'combination:c1'];
    expect(keys(session({ filters, stock }).items)).toEqual(['combination:own']);
    expect(keys(session({ filters, stock, includeClubs: true }).items)).toEqual(names);
    expect(keys(session({ filters, stock, includeClubs: false }).items)).toEqual(['combination:own']);
    expect(keys(session({ filters, stock, buddyHolders: holders }).items)).toEqual(names);
    expect(keys(session({ filters, stock, buddyHolders: undefined }).items)).toEqual(['combination:own']);
  });

  it('follows the favourites and their totals', () => {
    const filters: ExploreInput['filters'] = { quick: 'favourites' };
    expect(chip(session({ favorites: { glazeIds: ['g1'], combinationIds: [] } }), 'favourites')).toBe(1);
    expect(keys(session({ filters, favorites: { glazeIds: [], combinationIds: ['c1'] } }).items)).toEqual(['combination:c1']);
    expect(keys(session({ filters, favorites: noFavorites }).items)).toEqual([]);
    const sort: ExploreInput['filters'] = { sort: 'favourites', type: 'glazes' };
    const counted = (id: string) => ({ glazes: [{ id, count: 3 }], combinations: [] });
    expect(keys(session({ filters: sort, favoriteCounts: counted('g3') }).items)[0]).toBe('glaze:g3');
    expect(keys(session({ filters: sort, favoriteCounts: counted('g1') }).items)[0]).toBe('glaze:g1');
    expect(keys(session({ filters: sort, favoriteCounts: undefined }).items)[0]).toBe('glaze:g2');
  });

  it('drops the account on sign-out and takes the next one', () => {
    const filters: ExploreInput['filters'] = { quick: 'mine' };
    expect(keys(session({ filters }).items)).toEqual(['combination:own', 'combination:draft']);
    const guest = session({ filters, favorites: null, stock: [] });
    expect(guest.quick).toBe('all');
    expect(guest.chips).toEqual([]);
    expect(keys(guest.items)).not.toContain('combination:draft');
    const next = { ...own, own: false };
    const list = [c1, c2, c3, next];
    expect(keys(run({ filters }, glazes, list).items)).toEqual([]);
  });

  it('takes a replaced item and a removed one with the new array, the glaze correction too', () => {
    const replaced = { ...c1, title: 'Renamed', images: [imageInfo({ id: 'new' })], draft: true };
    const list = combos.map((item) => (item === c1 ? replaced : item)).filter((item) => item !== c2);
    const filters: ExploreInput['filters'] = { sort: 'az' };
    expect(keys(session({ filters }).items)).toContain('combination:c1');
    expect(keys(run({ filters }, glazes, list).items)).not.toContain('combination:c1');
    expect(keys(run({ filters }, glazes, list).items)).not.toContain('combination:c2');
    expect(run({}, glazes, list).usage.get('g2')).toBe(1);
    const corrected = glazes.map((item) => (item === g3 ? { ...item, code: 'AA-1', manufacturer: { ...item.manufacturer, name: '' } } : item));
    expect(keys(run({ filters: { sort: 'az', type: 'glazes' } }, corrected, combos).items)[0]).toBe('glaze:g3');
  });

  it('counts New from the clock of each run, on rows that stay', () => {
    const at = (date: string) => session({ now: Date.parse(date), filters: { quick: 'new' } });
    expect(keys(at('2026-10-01T00:00:00Z').items)).toEqual(['combination:own']);
    expect(keys(at('2026-11-01T00:00:00Z').items)).toEqual([]);
  });

  it('never lets a chip change what the search or tags kept', () => {
    const filters = { q: 'green', tags: ['satin'] };
    const narrowed = session({ filters });
    expect(keys(session({ filters: { ...filters, quick: 'canMake' }, stock: stockOf('g1', 'g2') }).items)).toEqual(['combination:c1']);
    expect(session({ filters }).items).toEqual(narrowed.items);
    expect(keys(session({ filters: { ...filters, q: 'triple' } }).items)).toEqual([]);
  });
});
