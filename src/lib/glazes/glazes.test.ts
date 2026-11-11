import { afterEach, describe, expect, it, vi } from 'vitest';
import { amaco, customStep, glaze, glazeStep } from '../../test/fixtures';
import {
  combinationTitle,
  filterCombinations,
  filterGlazes,
  filterManufacturers,
  glazeCode,
  glazeMap,
  glazeTitle,
  manufacturerLabel,
  manufacturersOf,
  referencedGlazeTitle,
  stepTitle,
  stockedFirst,
  variationSource,
  variationsOf,
  idleSlices,
  warmSearch,
} from './glazes';
import { withGlazeNames } from '../sync/sync';
import type { Combination } from '../api/models';

const botz = { id: 'm2', shortId: 'BOTZ', name: 'Botz' };
const mayco = { id: 'm3', shortId: 'MAYCO', name: 'Mayco' };
const spectrum = { id: 'm4', shortId: 'SPEC', name: 'Spectrum' };
const coyote = { id: 'm5', shortId: 'COY', name: 'Coyote' };
const coyoteClay = { id: 'm6', shortId: 'CCC', name: 'Coyote Clay & Color' };
const glazes = [
  glaze({ manufacturer: amaco, name: 'Blue Rutile', code: 'PC-20', notes: 'Cone 6, glossy' }),
  glaze({ manufacturer: botz, name: 'Seladon', code: '9353' }),
  glaze({ manufacturer: mayco, name: 'Ancient Jasper', code: 'PC-21' }),
  glaze({ manufacturer: spectrum, name: 'Café Crème', code: '1100' }),
  glaze({ manufacturer: coyote, name: 'Rutile Blue', code: 'MBG120' }),
];
const names = (query: string, options?: { notes: boolean }) => filterGlazes(glazes, query, options).map((item) => item.name);

describe('glazeCode', () => {
  it("shows the manufacturer's name, then the manufacturer code", () => {
    expect(glazeCode(glazes[0])).toBe('Amaco PC-20');
    expect(glazeCode(glazes[1])).toBe('Botz 9353');
    expect(glazeCode(glaze({ manufacturer: coyoteClay, name: 'Blue', code: 'PC-20' }))).toBe('Coyote Clay & Color PC-20');
  });

  it('shows the code alone for glazes saved offline before manufacturers', () => {
    expect(glazeCode({ manufacturer: { name: '' }, code: 'PC-20' })).toBe('PC-20');
    expect(glazeCode({ manufacturer: { name: '' }, code: '' })).toBe('');
  });

  it.each([
    ['around the manufacturer name', ' Amaco ', 'Amaco PC-20'],
    ['a manufacturer name of only blanks', '   ', 'PC-20'],
  ])('trims blanks %s', (_case, name, shown) => {
    expect(glazeCode({ manufacturer: { name }, code: 'PC-20' })).toBe(shown);
  });

  it('titles a glaze with its code and name', () => {
    expect(glazeTitle(glazes[0])).toBe('Amaco PC-20 Blue Rutile');
  });

  it('titles steps and stock entries by their loaded glaze, else by their own names', () => {
    const loaded = glazeMap([{ ...glazes[0], id: 'g1' }]);
    expect(referencedGlazeTitle(loaded, { glazeId: 'g1', manufacturer: 'Old', name: 'Old name' })).toBe('Amaco PC-20 Blue Rutile');
    expect(referencedGlazeTitle(loaded, { glazeId: 'g2', manufacturer: 'Mayco', name: 'Jasper' })).toBe('Mayco Jasper');
  });

  it('trims the manufacturer of a glaze that is not loaded', () => {
    expect(referencedGlazeTitle(glazeMap([]), { glazeId: 'g2', manufacturer: ' Mayco ', name: 'Jasper' })).toBe('Mayco Jasper');
    expect(referencedGlazeTitle(glazeMap([]), { glazeId: 'g2', manufacturer: '  ', name: 'Jasper' })).toBe('Jasper');
  });

  it.each([
    ['a title is shown trimmed', '  Blue over green ', 'Blue over green'],
    ['a title of only blanks reads as none', '   ', 'Untitled'],
    ['no title reads as none', '', 'Untitled'],
  ])('combinationTitle: %s', (_case, title, shown) => {
    expect(combinationTitle({ title }, 'Untitled')).toBe(shown);
  });

  it('titles a step by its glaze, or a custom step by its label', () => {
    const loaded = glazeMap([{ ...glazes[0], id: 'g1' }]);
    const applied = glazeStep({ glazeId: 'g1', manufacturer: 'Old', name: 'Old' });
    const firing = customStep({ label: 'Glaze firing' });
    expect(stepTitle(loaded, applied)).toBe('Amaco PC-20 Blue Rutile');
    expect(stepTitle(loaded, firing)).toBe('Glaze firing');
  });
});

describe('filterGlazes', () => {
  it('keeps every glaze for an empty query', () => {
    expect(filterGlazes(glazes, '  ')).toBe(glazes);
  });

  it.each([
    ['pc-2', ['Blue Rutile', 'Ancient Jasper']],
    ['amaco-pc-20', ['Blue Rutile']],
    ['9353', ['Seladon']],
    ['Amaco PC-20', ['Blue Rutile']],
    ['AMACO-PC-20', ['Blue Rutile']],
    ['PC-20', ['Blue Rutile']],
    ['pc20', ['Blue Rutile']],
    ['PC 20', ['Blue Rutile']],
    ['Botz 9353', ['Seladon']],
    ['amacopc20', ['Blue Rutile']],
    ['AMACO PC 20', ['Blue Rutile']],
    ['PC 21', ['Ancient Jasper']],
  ])('finds the code typed as %j, with or without the manufacturer and other separators', (query, found) => {
    expect(names(query)).toEqual(found);
  });

  it.each([
    ['BOTZ', ['Seladon']],
    ['spec', ['Café Crème']],
    ['coyote', ['Rutile Blue']],
    ['blue amaco', ['Blue Rutile']],
    ['rutile coyote', ['Rutile Blue']],
    ['blue botz', []],
    ['cafe creme', ['Café Crème']],
    ['crème', ['Café Crème']],
  ])('finds %j by the manufacturer name or short ID, every word in any field, ignoring accents', (query, found) => {
    expect(names(query)).toEqual(found);
  });

  describe('Italian and Spanish names (LANG-1)', () => {
    const latin = [
      glaze({ manufacturer: amaco, name: 'Ñandú', code: 'ES-1' }),
      glaze({ manufacturer: amaco, name: 'Perla', code: 'IT-1' }),
      glaze({ manufacturer: amaco, name: 'Pérola', code: 'PT-1' }),
      glaze({ manufacturer: amaco, name: 'Città', code: 'IT-2' }),
      glaze({ manufacturer: amaco, name: 'Caffè Nero', code: 'IT-3' }),
      glaze({ manufacturer: amaco, name: 'Verde Oliva', code: 'IT-4' }),
    ];
    const found = (query: string) => filterGlazes(latin, query).map((item) => item.name);

    it.each([
      ['nandu', ['Ñandú']],
      ['ñandú', ['Ñandú']],
      ['ÑANDÚ', ['Ñandú']],
      ['citta', ['Città']],
      ['città', ['Città']],
      ['caffe', ['Caffè Nero']],
      ['caffè nero', ['Caffè Nero']],
      ['perola', ['Pérola']],
      ['pérola', ['Pérola']],
      ['perla', ['Perla']],
      ['verde', ['Verde Oliva']],
    ])('finds %j with or without the accent or tilde', (query, expected) => {
      expect(found(query)).toEqual(expected);
    });
  });

  it('matches tags', () => {
    const tagged = [{ ...glazes[1], tags: ['satin-matte'] }, ...glazes];
    expect(filterGlazes(tagged, 'satin matte').map((item) => item.name)).toEqual(['Seladon']);
  });

  it('searches notes only when asked', () => {
    expect(names('glossy')).toEqual([]);
    expect(names('glossy', { notes: true })).toEqual(['Blue Rutile']);
  });

  it('ranks code matches, then word starts, then the listing order', () => {
    const x = { id: 'x', shortId: 'XX', name: 'X' };
    const list = [
      glaze({ manufacturer: x, name: 'Shino co', code: 'AB-1' }),
      glaze({ manufacturer: x, name: 'Deco', code: 'ZZ-1' }),
      glaze({ manufacturer: x, name: 'Celadon', code: 'CO-5' }),
    ];
    expect(filterGlazes(list, 'co').map((item) => item.name)).toEqual(['Celadon', 'Shino co', 'Deco']);
  });
});

describe('ranking by word starts', () => {
  const x = { id: 'x', shortId: 'XX', name: 'X' };
  const ranked = (query: string, ...itemNames: string[]) =>
    filterGlazes(
      itemNames.map((name) => glaze({ manufacturer: x, name, code: 'Q1' })),
      query,
    ).map((item) => item.name);

  it('puts a match at the start of any word of the text before a match inside a word', () => {
    expect(ranked('blue', 'Doubleblue', 'Rutile Blue')).toEqual(['Rutile Blue', 'Doubleblue']);
  });

  it('counts a word-start match only when every word of the query starts a word', () => {
    expect(ranked('blue ru', 'Rutile Doubleblue', 'Blue Rutile')).toEqual(['Blue Rutile', 'Rutile Doubleblue']);
  });

  const titled = (query: string, ...titles: string[]) =>
    filterCombinations(
      titles.map((title) => ({ id: title, title, tags: [], steps: [] })),
      query,
      new Map(),
    ).map((item) => item.title);

  it('counts the start of the text and each separator as a word start, also after a match inside a word', () => {
    expect(titled('tin', 'satin', 'tin')).toEqual(['tin', 'satin']);
    for (const separator of [' ', '-', '·']) expect(titled('tin', 'satin', `x${separator}tin`)).toEqual([`x${separator}tin`, 'satin']);
    expect(titled('tin', 'satin', 'satin tin')).toEqual(['satin tin', 'satin']);
  });

  it('never counts a word holding a separator as a word start', () => {
    for (const word of ['tin-gr', 'tin·gr']) expect(titled(word, `x${word}`, word)).toEqual([`x${word}`, word]);
  });
});

describe('filterCombinations', () => {
  const loaded = glazeMap([
    glaze({ id: 'rutile', manufacturer: amaco, name: 'Blue Rutile', code: 'PC-20' }),
    glaze({ id: 'jasper', manufacturer: mayco, name: 'Ancient Jasper', code: 'PC-21' }),
    glaze({ id: 'seladon', manufacturer: botz, name: 'Seladon', code: '9353' }),
  ]);
  const layer = (glazeId: string, manufacturer: string, name: string, method = '', notes = '') => ({
    glazeId,
    manufacturer,
    name,
    method,
    notes,
  });
  const combinations = [
    {
      title: 'River',
      description: 'Pooling in the well',
      author: 'Ben Leach',
      tags: ['glossy'],
      steps: [layer('seladon', 'Botz', 'Seladon'), layer('jasper', 'Mayco', 'Ancient Jasper')],
    },
    {
      title: 'Blue over brown',
      description: null,
      author: 'Ada Lovelace',
      tags: ['satin-matte', 'cone-6'],
      steps: [layer('rutile', 'Amaco', 'Blue Rutile', 'Dip', 'thick on the rim'), layer('gone', 'Old brand', 'Removed glaze')],
    },
    { title: 'Untitled', author: null, tags: [], steps: [layer('jasper', 'Mayco', 'Jasper')] },
  ];
  const titles = (query: string) => filterCombinations(combinations, query, loaded).map((item) => item.title);

  it.each([
    ['', ['River', 'Blue over brown', 'Untitled']],
    ['PC-20', ['Blue over brown']],
    ['pc20', ['Blue over brown']],
    ['PC 20', ['Blue over brown']],
    ['Amaco PC-20', ['Blue over brown']],
    ['AMACO-PC-20', ['Blue over brown']],
    ['pc-2', ['River', 'Blue over brown', 'Untitled']],
    ['Ada', ['Blue over brown']],
    ['satin matte', ['Blue over brown']],
    ['cone-6', ['Blue over brown']],
    ['thick rim', ['Blue over brown']],
    ['dip', ['Blue over brown']],
    ['pooling', ['River']],
    ['removed glaze', ['Blue over brown']],
    ['jasper botz', ['River']],
    ['nothing like this', []],
  ])('[%s] finds %j', (query, expected) => {
    expect(titles(query)).toEqual(expected);
  });

  it('searches the label and details of custom steps', () => {
    const list = [
      ...combinations,
      {
        title: 'Two firings',
        author: null,
        tags: [],
        steps: [
          { type: 'CUSTOM' as const, label: 'Bisque firing', notes: 'cone 04 slow', glazeId: null },
          { type: 'CUSTOM' as const, label: 'Re-firing', glazeId: null },
        ],
      },
    ];
    const found = (query: string) => filterCombinations(list, query, loaded).map((c) => c.title);
    expect(found('bisque')).toEqual(['Two firings']);
    expect(found('slow cone')).toEqual(['Two firings']);
    expect(found('null')).toEqual([]);
  });

  it('ranks combinations with a matching glaze step code first', () => {
    const list = [
      { title: 'Notes about 9353', tags: [], steps: [layer('jasper', 'Mayco', 'Jasper')] },
      { title: 'Seladon', tags: [], steps: [layer('seladon', 'Botz', 'Seladon')] },
    ];
    expect(filterCombinations(list, '9353', loaded).map((item) => item.title)).toEqual(['Seladon', 'Notes about 9353']);
  });
});

describe('search matching', () => {
  const noir = glaze({ id: 'noir', manufacturer: amaco, name: 'Crème Brûlée', code: 'LG-10', tags: ['café-noir'], notes: 'Çok güzel on the shoulder' });
  const usable = glaze({ id: 'usable', manufacturer: mayco, name: 'Spring · Green', code: 'SW 100' });
  const list = [noir, usable];
  const names = (query: string, notes = false) => filterGlazes(list, query, { notes }).map((item) => item.name);
  const piece = {
    title: 'Élan',
    description: 'Pooling at the FOOT',
    author: 'Zoë Müller',
    tags: ['satin-matte'],
    steps: [
      { glazeId: 'noir', manufacturer: 'Amaco', name: 'Crème Brûlée', method: 'Dip', notes: 'två lager' },
      { type: 'CUSTOM' as const, label: 'Wax foot' },
    ],
  };
  const hits = (query: string) => filterCombinations([piece], query, glazeMap(list)).length;

  it.each([
    ['creme', ['Crème Brûlée']],
    ['CRÈME', ['Crème Brûlée']],
    ['brulee', ['Crème Brûlée']],
    ['Cre\u0300me', ['Crème Brûlée']],
    ['cafe', ['Crème Brûlée']],
    ['cafe-noir', ['Crème Brûlée']],
    ['lg10', ['Crème Brûlée']],
    ['LG 10', ['Crème Brûlée']],
    ['amaco-lg-10', ['Crème Brûlée']],
    ['Amaco LG-10', ['Crème Brûlée']],
    ['sw100', ['Spring · Green']],
    ['spring green', ['Spring · Green']],
    ['·', ['Spring · Green']],
    ['guzel', []],
  ])('finds glazes for [%s]: %j', (query, expected) => {
    expect(names(query)).toEqual(expected);
  });

  it('folds notes when they are searched', () => {
    expect(names('cok guzel', true)).toEqual(['Crème Brûlée']);
  });

  it.each([
    ['elan', 1],
    ['ÉLAN', 1],
    ['zoe', 1],
    ['muller', 1],
    ['MÜLLER zoë', 1],
    ['foot pooling', 1],
    ['satin-matte', 1],
    ['satin matte', 1],
    ['tva lager', 1],
    ['creme', 1],
    ['lg10', 1],
    ['amaco-lg-10', 1],
    ['wax', 1],
    ['null', 0],
    ['undefined', 0],
  ])('finds a combination for [%s]: %d', (query, expected) => {
    expect(hits(query)).toBe(expected);
  });

  it('ranks a word start before a match inside a word, and a word with a separator as inside', () => {
    const inside = glaze({ manufacturer: amaco, name: 'Tin-green', code: '1' });
    const start = glaze({ manufacturer: amaco, name: 'Green tin', code: '2' });
    const middle = glaze({ manufacturer: amaco, name: 'Satin', code: '3' });
    expect(filterGlazes([middle, inside, start], 'tin').map((item) => item.name)).toEqual(['Tin-green', 'Green tin', 'Satin']);
    // The two words are only a match inside the text: nothing starts with "tin-gr", so listing order decides.
    expect(filterGlazes([start, inside], 'tin-gr').map((item) => item.name)).toEqual(['Tin-green']);
    const both = [glaze({ manufacturer: amaco, name: 'xtin-gr', code: '4' }), glaze({ manufacturer: amaco, name: 'tin-gr', code: '5' })];
    expect(filterGlazes(both, 'tin-gr')).toEqual(both);
  });

  it('never lets a word match across two fields as if they were one', () => {
    expect(filterGlazes([glaze({ manufacturer: { ...amaco, name: 'Blue', shortId: 'B' }, name: 'Sky', code: '' })], 'bluesky')).toEqual([]);
  });
});

describe('search text kept per item', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const first = glaze({ id: 'g1', manufacturer: amaco, name: 'Blue Rutile', code: 'PC-20', notes: 'runs' });
  const second = glaze({ id: 'g2', manufacturer: mayco, name: 'Jasper', code: 'SW-1' });
  const step = (of: typeof first) => ({ glazeId: of.id, manufacturer: of.manufacturer.name, name: of.name, method: '', notes: '' });
  const piece = { id: 'c1', title: 'River', author: 'Ben', tags: ['glossy'], steps: [step(first)] };
  /** A combination that counts how often its text is built. */
  const counted = () => {
    const reads = { count: 0 };
    return {
      reads,
      item: {
        ...piece,
        get title() {
          reads.count++;
          return piece.title;
        },
      },
    };
  };

  it('builds an item only once however many keys are typed', () => {
    const { reads, item } = counted();
    const map = glazeMap([first]);
    for (const query of ['r', 'ri', 'riv', 'river', 'x']) filterCombinations([item], query, map);
    expect(reads.count).toBe(1);
  });

  it('keeps the text across maps that answer the same glazes', () => {
    const { reads, item } = counted();
    filterCombinations([item], 'river', glazeMap([first]));
    filterCombinations([item], 'river', glazeMap([first, second]));
    expect(reads.count).toBe(1);
  });

  it('asks a map for the glazes once, not on every key', () => {
    const map = glazeMap([first]);
    filterCombinations([piece], 'river', map);
    const get = vi.spyOn(map, 'get');
    filterCombinations([piece], 'rive', map);
    filterCombinations([piece], 'riv', map);
    expect(get).not.toHaveBeenCalled();
  });

  it('sees a replaced combination at once', () => {
    const map = glazeMap([first]);
    expect(filterCombinations([piece], 'river', map)).toEqual([piece]);
    const renamed = { ...piece, title: 'Ocean', author: null, tags: ['matte'], steps: [] };
    expect(filterCombinations([renamed], 'river', map)).toEqual([]);
    expect(filterCombinations([renamed], 'ben', map)).toEqual([]);
    expect(filterCombinations([renamed], 'matte', map)).toEqual([renamed]);
    expect(filterCombinations([renamed], 'pc20', map)).toEqual([]);
    // The old object stays right for whoever still holds it.
    expect(filterCombinations([piece], 'river', map)).toEqual([piece]);
  });

  it('sees a replaced glaze', () => {
    const map = glazeMap([first]);
    expect(filterGlazes([first], 'pc20')).toEqual([first]);
    const coded = { ...first, code: 'PC-99', tags: ['new-tag'] };
    expect(filterGlazes([coded], 'pc20')).toEqual([]);
    expect(filterGlazes([coded], 'pc99')).toEqual([coded]);
    expect(filterGlazes([coded], 'new-tag')).toEqual([coded]);
    expect(map.get('g1')).toBe(first);
  });

  it('follows a glaze code or short ID change in a combination that stays the same object', () => {
    // withGlazeNames copies names only: this correction keeps the combination object.
    const recoded = { ...first, code: 'PC-99', manufacturer: { ...amaco, shortId: 'NEWAMA' } };
    const [same] = withGlazeNames([piece as unknown as Combination], [recoded]);
    expect(same as unknown).toBe(piece);
    expect(filterCombinations([piece], 'pc20', glazeMap([first]))).toEqual([piece]);
    const map = glazeMap([recoded]);
    expect(filterCombinations([piece], 'pc20', map)).toEqual([]);
    expect(filterCombinations([piece], 'pc99', map)).toEqual([piece]);
    expect(filterCombinations([piece], 'newama-pc-99', map)).toEqual([piece]);
    expect(filterCombinations([piece], 'pc20', glazeMap([first]))).toEqual([piece]);
  });

  it('follows a glaze rename through the steps', () => {
    const renamed = { ...first, name: 'Teal Rutile' };
    const [updated] = withGlazeNames([piece as unknown as Combination], [renamed]);
    expect(updated as unknown).not.toBe(piece);
    const map = glazeMap([renamed]);
    expect(filterCombinations([updated], 'teal', map)).toEqual([updated]);
    expect(filterCombinations([updated], 'blue', map)).toEqual([]);
  });

  it('follows a manufacturer rename', () => {
    const renamed = { ...first, manufacturer: { ...amaco, name: 'Kiln Works' } };
    const [updated] = withGlazeNames([piece as unknown as Combination], [renamed]);
    const map = glazeMap([renamed]);
    expect(filterCombinations([updated], 'kiln pc-20', map)).toEqual([updated]);
    expect(filterGlazes([renamed], 'kiln')).toEqual([renamed]);
    expect(filterGlazes([first], 'kiln')).toEqual([]);
  });

  it('follows a glaze that leaves or joins the listing', () => {
    expect(filterCombinations([piece], 'pc20', glazeMap([first]))).toEqual([piece]);
    expect(filterCombinations([piece], 'pc20', new Map())).toEqual([]);
    expect(filterCombinations([piece], 'blue rutile', new Map())).toEqual([piece]);
    expect(filterCombinations([piece], 'pc20', glazeMap([first]))).toEqual([piece]);
  });

  it('follows a correction of any glaze of a combination, not only the first', () => {
    const both = { ...piece, id: 'c2', steps: [step(first), step(second)] };
    expect(filterCombinations([both], 'sw1', glazeMap([first, second]))).toEqual([both]);
    const recoded = { ...second, code: 'SW-2' };
    expect(filterCombinations([both], 'sw1', glazeMap([first, recoded]))).toEqual([]);
    expect(filterCombinations([both], 'sw2', glazeMap([first, recoded]))).toEqual([both]);
  });

  it('keeps the text across maps when a step before a found one names no loaded glaze', () => {
    let reads = 0;
    const lost = {
      ...piece,
      steps: [step(second), step(first)],
      get title() {
        reads++;
        return piece.title;
      },
    };
    filterCombinations([lost], 'river', glazeMap([first]));
    filterCombinations([lost], 'river', glazeMap([first]));
    expect(reads).toBe(1);
  });

  it('asks a second map answering the same glazes once too', () => {
    const item = { ...piece, id: 'c3' };
    const [one, other] = [glazeMap([first]), glazeMap([first])];
    filterCombinations([item], 'river', one);
    filterCombinations([item], 'river', other);
    const get = vi.spyOn(other, 'get');
    filterCombinations([item], 'rive', other);
    expect(get).not.toHaveBeenCalled();
  });

  it('makes the codes of a glaze once for all its texts', () => {
    let reads = 0;
    const counting = { ...first };
    Object.defineProperty(counting, 'code', {
      get() {
        reads++;
        return first.code;
      },
    });
    filterGlazes([counting], 'x');
    const withCodes = reads;
    filterGlazes([counting], 'x', { notes: true });
    expect(reads - withCodes).toBeLessThan(withCodes);
  });

  describe('with a short ID other than the manufacturer name', () => {
    const named = { id: 'm9', shortId: 'AM', name: 'Amaco' };
    const coded = glaze({ id: 'g9', manufacturer: named, name: 'Sky', code: 'PC-20' });

    it('finds a glaze by its code in each form, and in text only one form holds', () => {
      for (const query of ['amacopc20', 'ampc20', 'pc20', 'm-pc']) expect(filterGlazes([coded], query), query).toEqual([coded]);
    });

    it('finds a combination by the text of its loaded glaze when the step names less', () => {
      const bare = { id: 'c9', title: 'River', tags: [], steps: [{ glazeId: coded.id, manufacturer: '', name: '', method: '', notes: '' }] };
      for (const query of ['maco', 'm-pc']) expect(filterCombinations([bare], query, glazeMap([coded])), query).toEqual([bare]);
    });

    it("finds a combination by the step's own manufacturer while its glaze is not loaded", () => {
      const named = { id: 'c10', title: 'River', tags: [], steps: [{ glazeId: 'gone', manufacturer: 'Amaco', name: '', method: '', notes: '' }] };
      expect(filterCombinations([named], 'amaco', new Map())).toEqual([named]);
    });
  });

  it('keeps the texts with and without notes apart for one glaze', () => {
    expect(filterGlazes([first], 'runs', { notes: true })).toEqual([first]);
    expect(filterGlazes([first], 'runs')).toEqual([]);
    expect(filterGlazes([first], 'runs', { notes: true })).toEqual([first]);
  });

  describe('warmSearch', () => {
    /** Runs idle callbacks by hand, with a clock that passes one slice per two items. */
    const idle = () => {
      const queue: (() => void)[] = [];
      vi.stubGlobal('requestIdleCallback', (run: () => void) => queue.push(run));
      return queue;
    };

    it('makes the text in the background, so the first key finds it', () => {
      const queue = idle();
      const { reads, item } = counted();
      warmSearch([first, second], [item], glazeMap([first, second]));
      expect(reads.count).toBe(0);
      while (queue.length) queue.shift()!();
      expect(reads.count).toBe(1);
      expect(filterCombinations([item], 'river', glazeMap([first, second]))).toEqual([item]);
      expect(reads.count).toBe(1);
    });

    it('prepares glaze notes as Explore searches them', () => {
      const queue = idle();
      const noted = { ...first };
      const notes = vi.fn(() => 'runs');
      Object.defineProperty(noted, 'notes', { get: notes });
      warmSearch([noted], [], new Map());
      queue.shift()!();
      expect(notes).toHaveBeenCalledTimes(1);
      expect(filterGlazes([noted], 'runs', { notes: true })).toEqual([noted]);
      expect(notes).toHaveBeenCalledTimes(1);
    });

    it('works in slices and stops when cancelled', () => {
      const queue = idle();
      let now = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => (now += 3));
      const pieces = Array.from({ length: 6 }, counted);
      const cancel = warmSearch(
        [],
        pieces.map((entry) => entry.item),
        new Map(),
      );
      const made = () => pieces.filter((entry) => entry.reads.count > 0).length;
      queue.shift()!();
      expect(made()).toBeGreaterThan(0);
      expect(made()).toBeLessThan(6);
      const soFar = made();
      expect(queue).toHaveLength(1);
      cancel();
      queue.shift()!();
      expect(made()).toBe(soFar);
      expect(queue).toHaveLength(0);
    });

    it('stops a slice with the idle time left, at 40 ms at most, and never waits for idle time for ever', () => {
      const requests: { run: (deadline: IdleDeadline) => void; timeout?: number }[] = [];
      vi.stubGlobal('requestIdleCallback', (run: (deadline: IdleDeadline) => void, options?: IdleRequestOptions) => {
        requests.push({ run, timeout: options?.timeout });
      });
      let now = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => (now += 10));
      const pieces = Array.from({ length: 12 }, counted);
      warmSearch(
        [],
        pieces.map((entry) => entry.item),
        new Map(),
      );
      const made = () => pieces.filter((entry) => entry.reads.count > 0).length;
      const slice = (remaining: number) => requests.shift()!.run({ didTimeout: false, timeRemaining: () => remaining });
      expect(requests[0].timeout).toBeGreaterThan(0);
      slice(15);
      expect(made()).toBe(2);
      slice(50);
      expect(made()).toBe(6);
    });

    it('stops at once when a step cancels it, as a flush can by leaving the page', () => {
      const requests: ((deadline: IdleDeadline) => void)[] = [];
      vi.stubGlobal('requestIdleCallback', (run: (deadline: IdleDeadline) => void) => requests.push(run));
      let steps = 0;
      const cancel = idleSlices(() => {
        steps++;
        cancel();
        return false;
      });
      requests.shift()!({ didTimeout: false, timeRemaining: () => 50 });
      expect(steps).toBe(1);
      expect(requests).toHaveLength(0);
    });

    it('takes a shorter slice where the caller asks for one', () => {
      const requests: ((deadline: IdleDeadline) => void)[] = [];
      vi.stubGlobal('requestIdleCallback', (run: (deadline: IdleDeadline) => void) => requests.push(run));
      let now = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => (now += 10));
      let steps = 0;
      idleSlices(() => ++steps >= 5, 20);
      requests.shift()!({ didTimeout: false, timeRemaining: () => 50 });
      expect(steps).toBe(2);
    });

    it('falls back to a timer without idle callbacks', () => {
      vi.useFakeTimers();
      vi.stubGlobal('requestIdleCallback', undefined);
      const { reads, item } = counted();
      warmSearch([], [item], new Map());
      expect(reads.count).toBe(0);
      vi.runAllTimers();
      vi.useRealTimers();
      expect(reads.count).toBe(1);
    });

    it('does not change what a replaced item finds', () => {
      const queue = idle();
      warmSearch([first], [piece], glazeMap([first]));
      while (queue.length) queue.shift()!();
      const recoded = { ...first, code: 'PC-99' };
      expect(filterCombinations([piece], 'pc20', glazeMap([recoded]))).toEqual([]);
      expect(filterCombinations([piece], 'pc99', glazeMap([recoded]))).toEqual([piece]);
    });
  });
});

describe('stockedFirst', () => {
  const list = ['a', 'b', 'c', 'd'].map((id) => ({ id }));

  it('offers glazes on a shelf with more than 0 g first, each part in listing order', () => {
    const stock = [
      { glazeId: 'd', quantityG: 450 },
      { glazeId: 'b', quantityG: 1500 },
      { glazeId: 'c', quantityG: 0 },
      { glazeId: 'b', quantityG: 0 },
    ];
    expect(stockedFirst(list, stock).map(({ id }) => id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('counts a single gram as stock', () => {
    expect(stockedFirst(list, [{ glazeId: 'c', quantityG: 1 }]).map(({ id }) => id)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('keeps the listing order without stock', () => {
    expect(stockedFirst(list, []).map(({ id }) => id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps stocked glazes first among the search matches', () => {
    const found = filterGlazes(
      stockedFirst(
        [
          glaze({ id: 'g1', manufacturer: amaco, name: 'Blue Rutile', code: 'PC-20' }),
          glaze({ id: 'g2', manufacturer: coyote, name: 'Rutile Blue', code: 'MBG120' }),
        ],
        [{ glazeId: 'g2', quantityG: 100 }],
      ),
      'blue rut',
    );
    expect(found.map(({ id }) => id)).toEqual(['g2', 'g1']);
  });
});

describe('manufacturers', () => {
  it('lists the manufacturers of the loaded glazes once each, by name', () => {
    const legacy = { id: '', shortId: '', name: 'Old brand' };
    const list = [
      glaze({ manufacturer: mayco, name: 'A', code: '1' }),
      glaze({ manufacturer: amaco, name: 'B', code: '2' }),
      glaze({ manufacturer: mayco, name: 'C', code: '3' }),
    ];
    expect(manufacturersOf([...list, glaze({ manufacturer: legacy, name: 'D', code: '4' })])).toEqual([amaco, mayco]);
  });

  it('filters by short ID first, then by name', () => {
    const all = [amaco, botz, mayco, spectrum, coyote];
    expect(filterManufacturers(all, 'co')).toEqual([coyote, amaco, mayco]);
    expect(filterManufacturers(all, 'ma')).toEqual([mayco, amaco]);
    expect(filterManufacturers(all, 'spectrum')).toEqual([spectrum]);
    expect(filterManufacturers(all, '')).toBe(all);
  });

  it('finds a short ID without its separators', () => {
    const hyphened = { id: 'm7', shortId: 'A-M', name: 'Clay' };
    expect(filterManufacturers([hyphened], 'am')).toEqual([hyphened]);
  });

  it('labels a manufacturer with its short ID', () => {
    expect(manufacturerLabel(amaco)).toBe('Amaco (AMACO)');
  });
});

describe('variations', () => {
  const original = { id: 'c1', basedOnId: null };
  const first = { id: 'c2', basedOnId: 'c1' };
  const second = { id: 'c3', basedOnId: 'c1' };
  const unrelated = { id: 'c4', basedOnId: 'c2' };
  const all = [second, first, original, unrelated];

  it('lists the variations of a combination in listing order', () => {
    expect(variationsOf(all, 'c1')).toEqual([second, first]);
    expect(variationsOf(all, 'c2')).toEqual([unrelated]);
    expect(variationsOf(all, 'c3')).toEqual([]);
  });

  it('finds a source only when the listing offers it', () => {
    expect(variationSource(all, first)).toBe(original);
    expect(variationSource(all, original)).toBeUndefined();
    // A source the viewer may not see (a draft) or that was deleted is absent from the listing.
    expect(variationSource([first], first)).toBeUndefined();
    expect(variationSource(all, { basedOnId: undefined })).toBeUndefined();
  });
});

describe('glazeMap per list', () => {
  it('answers one map for one list, also for a page that mounts again, and a new one for a new list', () => {
    const list = [{ id: 'g1' }];
    expect(glazeMap(list)).toBe(glazeMap(list));
    expect(glazeMap([...list])).not.toBe(glazeMap(list));
    expect(glazeMap(list).get('g1')).toBe(list[0]);
  });
});
