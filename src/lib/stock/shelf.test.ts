import { describe, expect, it } from 'vitest';
import type { Glaze, Step, StockItem } from '../api/models';
import { customStep, glaze, glazeStep, stockItem } from '../../test/fixtures';
import {
  entryFor,
  filterByOwner,
  filterShelf,
  freeOwners,
  glazeEntries,
  glazeShelfState,
  firstRows,
  SHELF_FIRST_ROWS,
  shelfRowLimit,
  groupShelf,
  isUsedUp,
  missingSummary,
  oneJarInput,
  changesJarSize,
  stockAddFor,
  parseGrams,
  shelfChoices,
  shelfGlazeIds,
  shelfOwnerFor,
  targetClub,
  formOwnerFor,
  shelfMatch,
  shelfRowCount,
  shelfToCompare,
  stockDraftFor,
  DEFAULT_JAR_G,
  quickAddInput,
  stockFormDirty,
  stockFormInput,
  stockFormTotal,
  stockInputFor,
  usedUpInput,
  isAddition,
  withSavedStock,
  withStockEntry,
} from './shelf';

const steps = (...list: Step[]) => ({ steps: list });
const shelf = (...ids: string[]) => new Set(ids);

describe('shelfGlazeIds', () => {
  it('lists glazes with more than 0 g, personal or club', () => {
    expect(
      shelfGlazeIds([
        { glazeId: 'g1', quantityG: 500 },
        { glazeId: 'g2', quantityG: 0 },
        { glazeId: 'g3', quantityG: 1 },
        { glazeId: 'g1', quantityG: 0 },
      ]),
    ).toEqual(new Set(['g1', 'g3']));
  });
});

describe('shelfToCompare', () => {
  it('has nothing to compare without any stock, and compares used-up stock as empty', () => {
    expect(shelfToCompare([])).toBeUndefined();
    expect(shelfToCompare([{ glazeId: 'g1', quantityG: 0 }])).toEqual(new Set());
    expect(shelfToCompare([{ glazeId: 'g1', quantityG: 9 }])).toEqual(new Set(['g1']));
  });
});

describe('shelfMatch', () => {
  const three = steps(glazeStep({ glazeId: 'g1' }), glazeStep({ glazeId: 'g2', position: 2 }), glazeStep({ glazeId: 'g3', position: 3 }));

  it('has every glaze when all are owned', () => {
    const match = shelfMatch(three, shelf('g1', 'g2', 'g3', 'g9'));
    expect(match).toMatchObject({ total: 3, have: 3, missing: [] });
  });

  it('names the one missing glaze through its step', () => {
    const match = shelfMatch(three, shelf('g1', 'g3'));
    expect(match.total).toBe(3);
    expect(match.have).toBe(2);
    expect(match.missing.map((step) => step.glazeId)).toEqual(['g2']);
  });

  it('counts none, in step order', () => {
    const match = shelfMatch(three, shelf());
    expect(match.have).toBe(0);
    expect(match.missing.map((step) => step.glazeId)).toEqual(['g1', 'g2', 'g3']);
  });

  it('counts club stock like personal stock, and a glaze at 0 g as missing', () => {
    const owned = shelfGlazeIds([
      { glazeId: 'g1', quantityG: 200 }, // personal shelf
      { glazeId: 'g2', quantityG: 80 }, // a club's shelf: the same list
      { glazeId: 'g3', quantityG: 0 },
    ]);
    const match = shelfMatch(three, owned);
    expect(match.have).toBe(2);
    expect(match.missing.map((step) => step.glazeId)).toEqual(['g3']);
  });

  it('ignores custom steps between glaze steps', () => {
    const fired = steps(
      glazeStep({ glazeId: 'g1' }),
      customStep({ label: 'Bisque firing', position: 2 }),
      glazeStep({ glazeId: 'g2', position: 3 }),
      customStep({ label: 'Glaze firing', position: 4 }),
    );
    expect(shelfMatch(fired, shelf('g1')).total).toBe(2);
    expect(shelfMatch(fired, shelf('g1')).missing.map((step) => step.glazeId)).toEqual(['g2']);
  });

  it('counts a glaze used in two steps once', () => {
    const twice = steps(glazeStep({ glazeId: 'g1' }), glazeStep({ glazeId: 'g2', position: 2 }), glazeStep({ glazeId: 'g1', position: 3 }));
    expect(shelfMatch(twice, shelf('g2'))).toMatchObject({ total: 2, have: 1 });
    expect(shelfMatch(twice, shelf('g2')).missing).toHaveLength(1);
  });

  it('has nothing to match without glaze steps', () => {
    const only = steps(customStep({ label: 'Bisque firing' }));
    expect(shelfMatch(only, shelf('g1'))).toEqual({ total: 0, have: 0, missing: [] });
  });

  it('reads older steps without a type as glaze steps', () => {
    const old = { steps: [{ position: 1, glazeId: 'g1', coats: 1, manufacturer: 'A', name: 'x' }] };
    expect(shelfMatch(old as never, shelf('g1'))).toMatchObject({ total: 1, have: 1 });
  });
});

describe('missingSummary', () => {
  const loaded = new Map<string, Glaze>([['g1', glaze({ id: 'g1', code: 'PC-20', name: 'Blue Rutile' })]]);
  const missing = (...ids: string[]) => ids.map((id, index) => glazeStep({ glazeId: id, position: index + 1, name: id }));

  it.each([
    ['names no glaze when none is missing', [], undefined, { names: [], more: 0 }],
    ['names one missing glaze by its code', ['g1'], undefined, { names: ['Amaco PC-20'], more: 0 }],
    ['names two missing glazes by their codes', ['g1', 'g2'], undefined, { names: ['Amaco PC-20', 'Amaco g2'], more: 0 }],
    ['names the first two in step order and counts the rest', ['g1', 'g2', 'g3', 'g4'], undefined, { names: ['Amaco PC-20', 'Amaco g2'], more: 2 }],
    ['names the first three for a limit of 3', ['g1', 'g2', 'g3', 'g4'], 3, { names: ['Amaco PC-20', 'Amaco g2', 'Amaco g3'], more: 1 }],
  ])('%s', (_case, ids, limit, expected) => {
    expect(missingSummary(missing(...ids), loaded, limit)).toEqual(expected);
  });

  it('falls back to the names of the step for a glaze that is not loaded', () => {
    expect(missingSummary(missing('gone'), loaded).names).toEqual(['Amaco gone']);
  });
});

const entry = (id: string, over: Partial<StockItem> = {}) => stockItem({ id, glazeId: `g-${id}`, name: id, ...over });
const club = (id: string, clubId: string, clubName: string, over: Partial<StockItem> = {}) => entry(id, { userId: null, clubId, clubName, ...over });
const titleOf = (item: StockItem) => `${item.manufacturer} ${item.name}`;

describe('shelfRowLimit', () => {
  it('starts with the first rows, however long the list', () => {
    expect(shelfRowLimit(12, 0, 950)).toBe(12);
    expect(shelfRowLimit(12, 0, 5)).toBe(12);
    expect(shelfRowLimit(12, 0, 12)).toBe(12);
    expect(shelfRowLimit(12, 0, 13)).toBe(12);
  });

  it('lowers the limit with the rows, never below the first rows', () => {
    expect(shelfRowLimit(950, 950, 400)).toBe(400);
    expect(shelfRowLimit(950, 950, 3)).toBe(12);
    expect(shelfRowLimit(40, 950, 30)).toBe(30);
  });

  it('keeps a whole list whole when a few rows join', () => {
    expect(shelfRowLimit(16, 16, 17)).toBe(17);
    expect(shelfRowLimit(16, 16, 28)).toBe(28);
    expect(shelfRowLimit(5, 5, 13)).toBe(13);
  });

  it('brings many new rows in slices, also after a filter that left a few', () => {
    expect(shelfRowLimit(16, 16, 29)).toBe(16);
    expect(shelfRowLimit(12, 3, 950)).toBe(12);
  });

  it('leaves a list on its way alone', () => {
    expect(shelfRowLimit(40, 950, 951)).toBe(40);
    expect(shelfRowLimit(40, 950, 950)).toBe(40);
  });
});

describe('firstRows', () => {
  const rows = (prefix: string, count: number, over = {}) => Array.from({ length: count }, (_, i) => entry(`${prefix}${i}`, over));
  const group = (key: string, items: number, usedUp = 0) => ({
    key,
    clubName: key,
    items: rows(key, items),
    usedUp: rows(`${key}-u`, usedUp, { quantityG: 0 }),
    usedUpCount: usedUp,
  });

  it('keeps the rows in order and leaves out the groups beyond the limit', () => {
    const shown = firstRows([group('a', 3), group('b', 3), group('c', 3)], 5);
    expect(shown.map((part) => [part.key, part.items.length])).toEqual([
      ['a', 3],
      ['b', 2],
    ]);
    expect(shown[1].items.map((item) => item.id)).toEqual(['b0', 'b1']);
  });

  it('keeps a group that fits as the same object and its rows as the same array', () => {
    const groups = [group('a', 3), group('b', 3)];
    const shown = firstRows(groups, 4);
    expect(shown[0]).toBe(groups[0]);
    expect(firstRows(groups, 6)).toEqual(groups);
    expect(firstRows(groups, 6)[1]).toBe(groups[1]);
  });

  it('lets a group’s used up rows arrive after its rows in stock, in slices, counted from the whole group', () => {
    const groups = [group('a', 2, 3), group('b', 1)];
    const parts = (limit: number) => firstRows(groups, limit).map((part) => [part.items.length, part.usedUp.length, part.usedUpCount]);
    expect(parts(2)).toEqual([[2, 0, 3]]);
    expect(parts(4)).toEqual([[2, 2, 3]]);
    expect(parts(5)).toEqual([[2, 3, 3]]);
    expect(parts(6)).toEqual([
      [2, 3, 3],
      [1, 0, 0],
    ]);
    // The rows in stock are whole once used up rows follow them: the same array, as for a group that fits.
    expect(firstRows(groups, 4)[0].items).toBe(groups[0].items);
  });

  it('brings a shelf of 300 used up rows in the slices of the list, never all at once, with their count from the start', () => {
    const groups = [group('personal', 150, 300), group('club', 80, 48)];
    const total = shelfRowCount(groups);
    let shown = firstRows(groups, SHELF_FIRST_ROWS);
    expect(shelfRowCount(shown)).toBe(SHELF_FIRST_ROWS);
    // As ShelfList's idle slices do: two more rows per step.
    for (let limit = SHELF_FIRST_ROWS + 2; limit < total + 2; limit += 2) {
      const next = firstRows(groups, limit);
      expect(shelfRowCount(next) - shelfRowCount(shown)).toBeLessThanOrEqual(2);
      expect(next[0].usedUpCount).toBe(300);
      expect(next[0].usedUp).toEqual(groups[0].usedUp.slice(0, next[0].usedUp.length));
      shown = next;
    }
    expect(shown).toEqual(groups);
    expect(firstRows(groups, 300)[0].usedUp).toHaveLength(150);
  });

  it('shows no used up rows of a group while none has arrived, and keeps their count', () => {
    expect(firstRows([group('a', 0, 3)], 2).map((part) => [part.key, part.items.length, part.usedUp.length, part.usedUpCount])).toEqual([['a', 0, 2, 3]]);
    expect(firstRows([group('a', 4, 3)], 2).map((part) => [part.items.length, part.usedUp.length, part.usedUpCount])).toEqual([[2, 0, 3]]);
  });

  it('counts every row and handles an empty shelf', () => {
    expect(shelfRowCount([group('a', 2, 3), group('b', 1)])).toBe(6);
    expect(shelfRowCount([])).toBe(0);
    expect(firstRows([], 12)).toEqual([]);
  });
});

describe('groupShelf', () => {
  it('lists the personal shelf first, then clubs by name, each split into in stock and used up', () => {
    const groups = groupShelf(
      [
        club('c1', 'k2', 'Zeta Studio'),
        entry('b'),
        club('c2', 'k1', 'Alpha Studio', { quantityG: 0 }),
        entry('a'),
        entry('z', { quantityG: 0 }),
        club('c3', 'k1', 'Alpha Studio'),
      ],
      titleOf,
    );
    expect(groups.map((group) => [group.key, group.clubName])).toEqual([
      ['personal', null],
      ['k1', 'Alpha Studio'],
      ['k2', 'Zeta Studio'],
    ]);
    expect(groups[0].items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(groups[0].usedUp.map((item) => item.id)).toEqual(['z']);
    expect(groups[1].items.map((item) => item.id)).toEqual(['c3']);
    expect(groups[1].usedUp.map((item) => item.id)).toEqual(['c2']);
    expect(groups.map((group) => group.usedUpCount)).toEqual([1, 1, 0]);
  });

  it('has no personal group without personal entries and orders titles with numbers naturally', () => {
    const groups = groupShelf(
      [club('b', 'k1', 'Kiln', { name: 'PC-10' }), club('a', 'k1', 'Kiln', { name: 'PC-9' }), club('c', 'k1', 'Kiln', { name: 'PC-9', id: 'a0' })],
      titleOf,
    );
    expect(groups.map((group) => group.key)).toEqual(['k1']);
    expect(groups[0].items.map((item) => item.id)).toEqual(['a', 'a0', 'b']);
  });

  it('breaks ties by ID within a group and by owner ID between clubs of one name, whatever the input order', () => {
    const groups = groupShelf(
      [club('b', 'k2', 'Kiln', { name: 'PC-9' }), club('a', 'k2', 'Kiln', { name: 'PC-9', id: 'a9' }), club('c', 'k1', 'Kiln', { name: 'PC-9' })],
      titleOf,
    );
    expect(groups.map((group) => group.key)).toEqual(['k1', 'k2']);
    expect(groups[1].items.map((item) => item.id)).toEqual(['a9', 'b']);
  });

  describe('title order, as `localeCompare` with `numeric` gave it', () => {
    const order = (titles: string[]) =>
      groupShelf(
        titles.map((name, index) => entry(String(index).padStart(3, '0'), { name })),
        titleOf,
      )[0].items.map((item) => item.name);

    it('puts numbers in numeric order, also after a shared prefix; leading zeros tie (`A1` and `A01`, by ID)', () => {
      expect(order(['PC-10', 'PC-9', 'PC-100', 'PC-2', 'A1', 'A01', 'A2', '10', '9'])).toEqual([
        '9',
        '10',
        'A1',
        'A01',
        'A2',
        'PC-2',
        'PC-9',
        'PC-10',
        'PC-100',
      ]);
    });

    it('sorts accents and case beside the base letter, lower case first, not by code point', () => {
      expect(order(['Zinc', 'éclair', 'Eclair', 'eclair', 'Ézé', 'ash', 'Ash', 'Äsche', 'Asche'])).toEqual([
        'Asche',
        'Äsche',
        'ash',
        'Ash',
        'eclair',
        'Eclair',
        'éclair',
        'Ézé',
        'Zinc',
      ]);
    });

    it('breaks a tie of equal titles by ID, whatever the input order', () => {
      const tied = groupShelf([entry('b', { name: 'Same' }), entry('c', { name: 'Same' }), entry('a', { name: 'Same' })], titleOf);
      expect(tied[0].items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    });

    it('agrees with `localeCompare` on any pair', () => {
      const words = ['PC-9', 'PC-10', 'pc-9', 'Pc 9', 'Ände', 'ande', 'Ande', 'Ñu', 'nu', 'ß', 'ss', '', ' ', '1', '01', '1.5', 'ａ', 'a'];
      const names = order(words);
      const expected = [...words].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }) || words.indexOf(a) - words.indexOf(b));
      expect(names).toEqual(expected);
    });
  });

  it('orders the used up entries by title too', () => {
    const [group] = groupShelf([entry('b', { name: 'Zinc', quantityG: 0 }), entry('a', { name: 'Ash', quantityG: 0 })], titleOf);
    expect(group.usedUp.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('treats an empty list as no groups and 0 g as used up', () => {
    expect(groupShelf([], titleOf)).toEqual([]);
    expect(isUsedUp(entry('a', { quantityG: 0 }))).toBe(true);
    expect(isUsedUp(entry('a', { quantityG: 1 }))).toBe(false);
  });
});

describe('filterShelf', () => {
  const glazes = new Map<string, Glaze>([['g-a', glaze({ id: 'g-a', code: 'PC-20', name: 'Blue Rutile' })]]);
  const list = [entry('a'), entry('b', { manufacturer: 'Mayco', name: 'Red' })];
  it('matches the display code with or without separators, and falls back to the entry names', () => {
    expect(filterShelf(list, glazes, 'pc20').map((item) => item.id)).toEqual(['a']);
    expect(filterShelf(list, glazes, 'rutile').map((item) => item.id)).toEqual(['a']);
    expect(filterShelf(list, glazes, 'mayco red').map((item) => item.id)).toEqual(['b']);
    expect(filterShelf(list, glazes, 'nothing')).toEqual([]);
    expect(filterShelf(list, glazes, '  ')).toBe(list);
  });
});

describe('jar arithmetic', () => {
  it('parses whole grams only', () => {
    expect(parseGrams(450)).toBe(450);
    expect(parseGrams('450')).toBe(450);
    expect(parseGrams(0)).toBe(0);
    expect(parseGrams('')).toBeNull();
    expect(parseGrams(null)).toBeNull();
    expect(parseGrams(-1)).toBeNull();
    expect(parseGrams(1.5)).toBeNull();
    expect(parseGrams('abc')).toBeNull();
    expect(parseGrams(0, { min: 1 })).toBeNull();
    expect(parseGrams(100001, { min: 1, max: 100000 })).toBeNull();
  });

  it.each([
    [0, { max: 100_000 }, 0],
    [100_000, { max: 100_000 }, 100_000],
    [100_001, { max: 100_000 }, null],
    [1, { min: 1 }, 1],
    [0, { min: 1 }, null],
    [1_000_000_000, {}, 1_000_000_000],
    [1_000_000_001, {}, null],
  ])('parseGrams(%j, %j) is %j: both limits are inclusive', (value, limits, grams) => {
    expect(parseGrams(value, limits)).toBe(grams);
  });

  it.each([
    ['', null],
    [' ', null],
    ['  ', null],
    ['\t', null],
    ['\n', null],
    ['0', 0],
    ['0.0', 0],
    [' 0 ', 0],
    [' 450 ', 450],
    ['\t450\n', 450],
    ['100000', 100_000],
    ['1000000000', 1_000_000_000],
    ['1000000001', null],
    ['-1', null],
    ['1.5', null],
    ['1,5', null],
    ['abc', null],
  ])('parseGrams(%j) is %j: text with no value is no amount, not 0 g', (value, grams) => {
    expect(parseGrams(value)).toBe(grams);
  });

  it('adding a jar needs a jar size of at least 1 g', () => {
    const empty = stockItem({ quantityG: 100, jarSizeG: null });
    expect(stockFormTotal(empty, { mode: 'jar', amount: null, jar: 0 })).toBeNull();
    expect(stockFormTotal(empty, { mode: 'jar', amount: null, jar: 1 })).toBe(101);
    expect(stockFormTotal(empty, { mode: 'jar', amount: null, jar: 100_000 })).toBe(100_100);
    expect(stockFormTotal(empty, { mode: 'jar', amount: null, jar: 100_001 })).toBeNull();
  });

  it.each([
    [
      'adds the stored size and keeps it',
      entry('a', { quantityG: 450, jarSizeG: 500 }),
      undefined,
      { glazeId: 'g-a', addG: 500, ownerType: 'personal', clubId: null, jarSizeG: 500 },
    ],
    [
      'on a used up entry restocks one jar',
      entry('a', { quantityG: 0, jarSizeG: 250 }),
      undefined,
      { glazeId: 'g-a', addG: 250, ownerType: 'personal', clubId: null, jarSizeG: 250 },
    ],
    [
      'for a club entry names the club; a stored size wins over a typed one',
      club('c', 'k1', 'Kiln', { quantityG: 10, jarSizeG: 1000 }),
      5,
      { glazeId: 'g-c', addG: 1000, ownerType: 'club', clubId: 'k1', jarSizeG: 1000 },
    ],
  ])('+1 jar %s', (_case, item, typed, expected) => {
    // Strict: an addition of one jar to what the server holds (never a total from this device's copy). The size goes
    // along (a row another device removed is recreated with it) but never asks to replace a stored one (STOCK-2).
    expect(oneJarInput(item, typed)).toStrictEqual(expected);
  });

  it('+1 jar without a stored size needs the size asked for, and stores it', () => {
    const open = entry('a', { quantityG: 100 });
    expect(oneJarInput(open)).toBeNull();
    expect(oneJarInput(open, 0)).toBeNull();
    expect(oneJarInput(open, 500)).toStrictEqual({ glazeId: 'g-a', addG: 500, jarSizeG: 500, ownerType: 'personal', clubId: null });
  });

  it('+1 jar for a club entry names the club; a stored size wins over a typed one', () => {
    const input = oneJarInput(club('c', 'k1', 'Kiln', { quantityG: 10, jarSizeG: 1000 }), 5);
    expect(input).toEqual({
      glazeId: 'g-c',
      addG: 1000,
      ownerType: 'club',
      clubId: 'k1',
      jarSizeG: 1000,
    });
    expect(input).not.toHaveProperty('replaceJarSize');
  });

  it('leaves the limit of the total to the server, which knows the amount', () => {
    expect(oneJarInput(entry('a', { quantityG: 999_999_999, jarSizeG: 5 }))).toMatchObject({ addG: 5 });
    expect(isAddition(oneJarInput(entry('a', { jarSizeG: 5 }))!)).toBe(true);
    expect(isAddition(usedUpInput(entry('a')))).toBe(false);
  });

  it('used up saves 0 g without a jar size, for either owner', () => {
    expect(usedUpInput(entry('a', { jarSizeG: 500 }))).toEqual({
      glazeId: 'g-a',
      quantityG: 0,
      ownerType: 'personal',
      clubId: null,
    });
    expect(usedUpInput(club('c', 'k1', 'Kiln'))).toMatchObject({ ownerType: 'club', clubId: 'k1' });
    expect(stockInputFor(entry('a'), 5, 400)).toMatchObject({ quantityG: 5, jarSizeG: 400 });
  });
});

describe('withSavedStock', () => {
  const list = [entry('a', { jarSizeG: 500 }), entry('b')];
  it('patches the amount and keeps the jar size unless the save carried one', () => {
    const next = withSavedStock(list, 'a', { quantityG: 0 })!;
    expect(next.map((item) => [item.quantityG, item.jarSizeG])).toEqual([
      [0, 500],
      [100, null],
    ]);
    expect(withSavedStock(list, 'b', { quantityG: 5, jarSizeG: 250 })![1].jarSizeG).toBe(250);
    expect(list[0].quantityG).toBe(100);
  });
  it('answers null for an entry that is not listed', () => {
    expect(withSavedStock(list, 'new', { quantityG: 5 })).toBeNull();
  });
});

describe('withStockEntry', () => {
  const list = [entry('a', { quantityG: 250, jarSizeG: 250 }), entry('b')];
  it("takes the server's entry after an addition, whatever this device held", () => {
    const answered = entry('a', { quantityG: 750, jarSizeG: 250, canRemove: true });
    const next = withStockEntry(list, answered)!;
    expect(next[0]).toBe(answered);
    expect(next[1]).toBe(list[1]);
    expect(list[0].quantityG).toBe(250);
  });
  it('answers null for an entry that is not listed', () => {
    expect(withStockEntry(list, entry('new'))).toBeNull();
  });
});

describe('stock form', () => {
  const mine = entry('a', { quantityG: 450, jarSizeG: 500 });
  const kiln = club('c', 'k1', 'Kiln', { glazeId: 'g-a', quantityG: 1500, jarSizeG: null });
  const list = [mine, kiln];

  it('finds the entry of the chosen owner only', () => {
    expect(entryFor(list, 'g-a', 'personal')).toBe(mine);
    expect(entryFor(list, 'g-a', 'k1')).toBe(kiln);
    expect(entryFor(list, 'g-a', 'k2')).toBeUndefined();
    expect(entryFor(list, 'other', 'personal')).toBeUndefined();
  });

  it('pre-fills the current amount and jar size, and starts a new entry at the default amount without a jar size', () => {
    expect(stockDraftFor(mine)).toEqual({ mode: 'set', amount: 450, jar: 500, startJar: 500, startAmount: 450 });
    expect(stockDraftFor(kiln)).toEqual({ mode: 'set', amount: 1500, jar: null, startJar: null, startAmount: 1500 });
    expect(stockDraftFor(undefined)).toEqual({ mode: 'set', amount: DEFAULT_JAR_G, jar: null, startJar: null, startAmount: null });
  });

  it('an untouched new entry saves at once as an addition of the default amount', () => {
    expect(stockFormInput('g-x', 'k1', undefined, stockDraftFor(undefined))).toStrictEqual({
      glazeId: 'g-x',
      addG: DEFAULT_JAR_G,
      ownerType: 'club',
      clubId: 'k1',
    });
  });

  it('is dirty only when the amount or jar size differs from where the form started', () => {
    // A new entry: the default amount alone is nothing to lose.
    const fresh = stockDraftFor(undefined);
    expect(stockFormDirty(fresh)).toBe(false);
    expect(stockFormDirty({ ...fresh, amount: 300 })).toBe(true);
    expect(stockFormDirty({ ...fresh, amount: null })).toBe(true);
    expect(stockFormDirty({ ...fresh, jar: 500 })).toBe(true);
    // An existing entry: its own amount and size are the start.
    const draft = stockDraftFor(mine);
    expect(stockFormDirty(draft)).toBe(false);
    expect(stockFormDirty({ ...draft, amount: DEFAULT_JAR_G })).toBe(true);
    expect(stockFormDirty({ ...draft, jar: null })).toBe(true);
  });

  it('a new entry cleared of its amount is incomplete; 0 g is a valid amount (a set: there is nothing to add)', () => {
    const draft = stockDraftFor(undefined);
    expect(stockFormInput('g-x', 'personal', undefined, { ...draft, amount: null })).toBeNull();
    expect(stockFormInput('g-x', 'personal', undefined, { ...draft, amount: 0 })).toEqual({
      glazeId: 'g-x',
      quantityG: 0,
      ownerType: 'personal',
      clubId: null,
    });
  });

  it('the one-click add saves one default jar on the personal shelf', () => {
    // An addition: an entry another device made meanwhile gets the jar on top.
    expect(quickAddInput('g-x')).toEqual({ glazeId: 'g-x', addG: DEFAULT_JAR_G, ownerType: 'personal', clubId: null, jarSizeG: DEFAULT_JAR_G });
    expect(DEFAULT_JAR_G).toBe(250);
    expect(quickAddInput('g-x', 'club-1')).toEqual({ glazeId: 'g-x', addG: DEFAULT_JAR_G, ownerType: 'club', clubId: 'club-1', jarSizeG: DEFAULT_JAR_G });
  });

  it('needs a glaze', () => {
    expect(stockFormInput('', 'personal', undefined, { mode: 'set', amount: 5, jar: null })).toBeNull();
  });

  it('sets the amount and sends the jar size only when it changed', () => {
    expect(stockFormInput('g-a', 'personal', mine, { mode: 'set', amount: 300, jar: 500 })).toEqual({
      glazeId: 'g-a',
      quantityG: 300,
      ownerType: 'personal',
      clubId: null,
    });
    expect(stockFormInput('g-a', 'personal', mine, { mode: 'set', amount: 300, jar: 1000 })).toEqual({
      glazeId: 'g-a',
      quantityG: 300,
      ownerType: 'personal',
      clubId: null,
      jarSizeG: 1000,
    });
    expect(stockFormInput('g-a', 'k1', kiln, stockDraftFor(kiln))).toEqual({
      glazeId: 'g-a',
      quantityG: 1500,
      ownerType: 'club',
      clubId: 'k1',
    });
    expect(stockFormInput('g-a', 'personal', mine, { mode: 'set', amount: 300, jar: 0 })).toBeNull();
  });

  it('adds a jar to what the server holds and stores the size it added', () => {
    const draft = { mode: 'jar', amount: 450, jar: 500 } as const;
    // The preview counts from this device's copy; the save is an addition, never that total.
    expect(stockFormTotal(mine, draft)).toBe(950);
    expect(stockFormInput('g-a', 'personal', mine, draft)).toStrictEqual({
      glazeId: 'g-a',
      addG: 500,
      jarSizeG: 500,
      ownerType: 'personal',
      clubId: null,
    });
    // A club's entry has no size yet: typing one adds that many grams and stores it (no replacement to ask for).
    expect(stockFormInput('g-a', 'k1', kiln, { mode: 'jar', amount: 1500, jar: 250 })).toStrictEqual({
      glazeId: 'g-a',
      addG: 250,
      jarSizeG: 250,
      ownerType: 'club',
      clubId: 'k1',
    });
    // Jar mode without an entry is the plain amount, added (the form offers no jar mode then).
    expect(stockFormInput('g-a', 'personal', undefined, { mode: 'jar', amount: 300, jar: 250 })).toStrictEqual({
      glazeId: 'g-a',
      addG: 300,
      jarSizeG: 250,
      ownerType: 'personal',
      clubId: null,
    });
  });

  it('replaces the jar size only when the person typed another one than the entry shows (STOCK-2)', () => {
    // mine shows a 500 g jar: an untouched field never overwrites a size another device stored meanwhile.
    expect(stockFormInput('g-a', 'personal', mine, { ...stockDraftFor(mine), mode: 'jar' })).not.toHaveProperty('replaceJarSize');
    expect(stockFormInput('g-a', 'personal', mine, { mode: 'jar', amount: 450, jar: 1000 })).toStrictEqual({
      glazeId: 'g-a',
      addG: 1000,
      jarSizeG: 1000,
      ownerType: 'personal',
      clubId: null,
      replaceJarSize: true,
    });
    expect(changesJarSize(mine, 1000)).toBe(true);
    expect(changesJarSize(mine, 500)).toBe(false);
    expect(changesJarSize(kiln, 250)).toBe(false);
    expect(changesJarSize(undefined, 250)).toBe(false);
    expect(changesJarSize(mine, null)).toBe(false);
  });

  it('asks for a replacement only together with a size (STOCK-2 review)', () => {
    expect(stockAddFor({ glazeId: 'g-a', clubId: null }, 250, 1000, true)).toMatchObject({ jarSizeG: 1000, replaceJarSize: true });
    expect(stockAddFor({ glazeId: 'g-a', clubId: null }, 250, null, true)).toStrictEqual({ glazeId: 'g-a', addG: 250, ownerType: 'personal', clubId: null });
  });

  it('a form started without an entry adds its amount, so an entry another device made keeps its grams (FE-6)', () => {
    const draft = stockDraftFor(undefined);
    expect(stockFormInput('g-a', 'personal', undefined, { ...draft, amount: 250 })).toStrictEqual({
      glazeId: 'g-a',
      addG: 250,
      ownerType: 'personal',
      clubId: null,
    });
    // A refresh brought another device's entry after the form was filled: still an addition, with the typed size stored only where none is.
    expect(stockFormInput('g-a', 'personal', mine, { ...draft, amount: 250, jar: 1000 })).toStrictEqual({
      glazeId: 'g-a',
      addG: 250,
      jarSizeG: 1000,
      ownerType: 'personal',
      clubId: null,
    });
    // 0 g with a size is a size-only save; 0 g alone a set.
    expect(stockFormInput('g-a', 'personal', mine, { ...draft, amount: 0, jar: 1000 })).toStrictEqual({
      glazeId: 'g-a',
      jarSizeG: 1000,
      ownerType: 'personal',
      clubId: null,
    });
    // An entry removed by a refresh after the form was filled from it comes back with the typed amount on top of nothing.
    expect(stockFormInput('g-a', 'personal', undefined, { ...stockDraftFor(mine), amount: 300 })).toMatchObject({ addG: 300 });
  });

  it('sends only what changed against the form start, never an amount or size a refresh replaced (STOCK-3, FE-9)', () => {
    const draft = stockDraftFor(mine);
    // Another device added a jar and changed the size after the form was filled.
    const refreshed = { ...mine, quantityG: 950, jarSizeG: 1000 };
    // Only the jar size changed: a size-only save keeps the 950 g.
    expect(stockFormInput('g-a', 'personal', refreshed, { ...draft, jar: 250 })).toStrictEqual({
      glazeId: 'g-a',
      jarSizeG: 250,
      ownerType: 'personal',
      clubId: null,
    });
    // Only the amount changed: the 1000 g jar stays.
    expect(stockFormInput('g-a', 'personal', refreshed, { ...draft, amount: 200 })).toStrictEqual({
      glazeId: 'g-a',
      quantityG: 200,
      ownerType: 'personal',
      clubId: null,
    });
    // Nothing changed: the amount shown is set, without a size.
    expect(stockFormInput('g-a', 'personal', refreshed, draft)).toStrictEqual({ glazeId: 'g-a', quantityG: 450, ownerType: 'personal', clubId: null });
    // A size typed on an entry that had none is a change.
    expect(stockFormInput('g-a', 'k1', kiln, { ...stockDraftFor(kiln), jar: 250 })).toStrictEqual({
      glazeId: 'g-a',
      jarSizeG: 250,
      ownerType: 'club',
      clubId: 'k1',
    });
    // Drafts without the start fields compare with the entry.
    expect(stockFormInput('g-a', 'personal', mine, { mode: 'set', amount: 450, jar: 250 })).toStrictEqual({
      glazeId: 'g-a',
      jarSizeG: 250,
      ownerType: 'personal',
      clubId: null,
    });
  });

  it('compares the jar with the size the form started from, not with a refreshed entry (STOCK-2 review)', () => {
    // The form opened on mine (500 g jar) and was left untouched; a refresh then brought the 1000 g jar another device
    // stored. The untouched 500 g must not ask to replace it.
    const draft = { ...stockDraftFor(mine), mode: 'jar' as const };
    const refreshed = { ...mine, quantityG: 950, jarSizeG: 1000 };
    expect(stockFormInput('g-a', 'personal', refreshed, draft)).toStrictEqual({
      glazeId: 'g-a',
      addG: 500,
      jarSizeG: 500,
      ownerType: 'personal',
      clubId: null,
    });
    // Another size typed in the form still replaces it.
    expect(stockFormInput('g-a', 'personal', refreshed, { ...draft, jar: 250 })).toMatchObject({ addG: 250, replaceJarSize: true });
    // The form opened on an entry without a size: a size typed there is stored only where the entry still has none.
    expect(stockFormInput('g-a', 'k1', { ...kiln, jarSizeG: 1000 }, { ...stockDraftFor(kiln), mode: 'jar', jar: 250 })).not.toHaveProperty('replaceJarSize');
  });

  it('adding a jar needs a jar size', () => {
    expect(stockFormTotal(kiln, { mode: 'jar', amount: 1500, jar: null })).toBeNull();
    expect(stockFormInput('g-a', 'k1', kiln, { mode: 'jar', amount: 1500, jar: 0 })).toBeNull();
  });
});

describe("a glaze's part of the shelf", () => {
  const same = (id: string, over: Partial<StockItem> = {}) => entry(id, { glazeId: 'g-x', ...over });
  const stock = [
    club('c2', 'k2', 'Zeta Studio', { glazeId: 'g-x', quantityG: 0 }),
    entry('other'),
    club('c1', 'k1', 'Alpha Studio', { glazeId: 'g-x', quantityG: 1500 }),
    same('mine', { quantityG: 450 }),
  ];

  it('collects only that glaze, personal first, then clubs by name', () => {
    expect(glazeEntries(stock, 'g-x').map((item) => item.id)).toEqual(['mine', 'c1', 'c2']);
    expect(glazeEntries(stock, 'g-none')).toEqual([]);
    expect(glazeEntries([], 'g-x')).toEqual([]);
  });

  it('keeps a used up entry in the list (its jar size and restock stay one tap away)', () => {
    expect(glazeEntries([same('a', { quantityG: 0 })], 'g-x').map((item) => item.id)).toEqual(['a']);
  });

  it('names the shelves without an entry, personal first, clubs in their order', () => {
    const clubs = [{ id: 'k1' }, { id: 'k2' }, { id: 'k3' }];
    expect(freeOwners([], clubs)).toEqual(['personal', 'k1', 'k2', 'k3']);
    expect(freeOwners(glazeEntries(stock, 'g-x'), clubs)).toEqual(['k3']);
    expect(freeOwners([same('mine')], [])).toEqual([]);
  });

  it('tells nothing stocked from in stock and used up', () => {
    expect(glazeShelfState([])).toBe('none');
    expect(glazeShelfState(glazeEntries(stock, 'g-x'))).toBe('stocked');
    expect(glazeShelfState([same('a', { quantityG: 0 })])).toBe('usedUp');
  });

  it('builds the saves of the glaze page from the same helpers as the shelf', () => {
    const [mine, , zeta] = glazeEntries(stock, 'g-x');
    expect(oneJarInput(mine)).toBeNull();
    expect(oneJarInput(mine, 500)).toMatchObject({ glazeId: 'g-x', addG: 500, jarSizeG: 500 });
    expect(usedUpInput(mine)).toMatchObject({
      glazeId: 'g-x',
      quantityG: 0,
      ownerType: 'personal',
    });
    // The add form sees no entry: its amount is added (FE-6).
    expect(stockFormInput('g-x', 'k3', undefined, { mode: 'set', amount: 250, jar: null })).toEqual({
      glazeId: 'g-x',
      addG: 250,
      ownerType: 'club',
      clubId: 'k3',
    });
    expect(oneJarInput(zeta, 500)).toMatchObject({ addG: 500, clubId: 'k2' });
  });
});

describe('shelf owner filter', () => {
  const kiln = { id: 'k1', name: 'Kiln' };
  const stock = [
    entry('a'),
    entry('b', { quantityG: 0 }),
    club('c1', 'k1', 'Kiln'),
    club('c2', 'k2', 'Atelier'),
    club('c3', 'k2', 'Atelier', { quantityG: 0 }),
  ];

  it('knows the personal shelf and the clubs of the account, and falls back to all shelves for anything else', () => {
    expect(shelfOwnerFor('personal', [])).toBe('personal');
    expect(shelfOwnerFor('k1', [kiln])).toBe('k1');
    expect(shelfOwnerFor('k9', [kiln])).toBeUndefined();
    expect(shelfOwnerFor('k1', [])).toBeUndefined();
    expect(shelfOwnerFor('', [kiln])).toBeUndefined();
    expect(shelfOwnerFor(undefined, [kiln])).toBeUndefined();
  });

  it("keeps one owner's entries, used up ones included, or all of them", () => {
    expect(filterByOwner(stock, undefined)).toBe(stock);
    expect(filterByOwner(stock, 'personal').map((item) => item.id)).toEqual(['a', 'b']);
    expect(filterByOwner(stock, 'k2').map((item) => item.id)).toEqual(['c2', 'c3']);
    expect(filterByOwner(stock, 'k9')).toEqual([]);
  });

  it('offers no choice without a club', () => {
    expect(shelfChoices(stock, [])).toEqual([]);
  });

  it('lists all shelves, personal and the clubs by name with the entries in stock', () => {
    const clubs = [kiln, { id: 'k2', name: 'atelier' }, { id: 'k3', name: 'Élan' }, { id: 'k4', name: 'Studio 10' }, { id: 'k5', name: 'Studio 2' }];
    expect(shelfChoices(stock, clubs, 'en').map(({ owner, clubName, count }) => [owner, clubName, count])).toEqual([
      [undefined, null, 3],
      ['personal', null, 1],
      ['k2', 'atelier', 1],
      ['k3', 'Élan', 0],
      ['k1', 'Kiln', 1],
      ['k5', 'Studio 2', 0],
      ['k4', 'Studio 10', 0],
    ]);
  });
});

describe('write targets', () => {
  const clubs = [{ id: 'k1', name: 'Kiln' }];
  it('names the club a write goes to, never one the account left', () => {
    expect(targetClub('k1', clubs)?.name).toBe('Kiln');
    expect(targetClub('personal', clubs)).toBeUndefined();
    expect(targetClub('gone', clubs)).toBeUndefined();
  });
  it('starts the form on the shown shelf, else on the personal one', () => {
    expect(formOwnerFor('k1', clubs)).toBe('k1');
    expect(formOwnerFor('personal', clubs)).toBe('personal');
    // All shelves and a club left meanwhile: never a club by leftover state.
    expect(formOwnerFor(undefined, clubs)).toBe('personal');
    expect(formOwnerFor('gone', clubs)).toBe('personal');
    expect(formOwnerFor('k1', [])).toBe('personal');
  });
});
