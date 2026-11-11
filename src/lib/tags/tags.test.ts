import { describe, expect, it } from 'vitest';
import { buildTagIndex, countTags, filterByTags, normalizeTag, pendingTag, suggestTags, tagOptions, tagProblem, withPendingTag, withTag } from './tags';

describe('normalizeTag', () => {
  // The same table as backend src/test/java/eu/glazelab/api/model/TagsTest.java; change both together.
  it.each([
    ['  Satin Matte ', 'satin-matte'],
    ['satin_matte', 'satin-matte'],
    ['satin--matte', 'satin-matte'],
    ['Satin-Matte', 'satin-matte'],
    ['Glänzend', 'glänzend'],
    ['glanzend', 'glanzend'],
    ['Çor  Azul', 'çor-azul'],
    ['Café', 'café'],
    ['Cone 6 / Oxidation', 'cone-6-oxidation'],
    ['UPPER.case', 'upper-case'],
    ['#food-safe!', 'food-safe'],
    ['tenmoku_2', 'tenmoku-2'],
    ['ΟΔΟΣ', 'οδος'],
    ['日本 釉薬', '日本-釉薬'],
    ['--', ''],
    ['🔥', ''],
    ['   ', ''],
  ])('[%s] -> [%s]', (input, expected) => {
    expect(normalizeTag(input)).toBe(expected);
  });
});

describe('tag limits', () => {
  it('matches the server: 40 characters and 20 tags per item', () => {
    expect(tagProblem('a'.repeat(40), [])).toBeNull();
    expect(tagProblem('a'.repeat(41), [])).toBe('tooLong');
    expect(tagProblem('', [])).toBe('empty');
    const twenty = Array.from({ length: 20 }, (_, index) => `t${index}`);
    expect(tagProblem('one-more', twenty)).toBe('tooMany');
    // Adding a tag the item already has changes nothing, so it is never one too many.
    expect(tagProblem('t3', twenty)).toBeNull();
  });

  it('adds a tag once, in sorted order', () => {
    expect(withTag(['glossy', 'satin'], 'matte')).toEqual(['glossy', 'matte', 'satin']);
    expect(withTag(['glossy'], 'glossy')).toEqual(['glossy']);
  });
});

describe('pending tag text', () => {
  const twenty = Array.from({ length: 20 }, (_, index) => `t${index}`);

  // Enter with the suggestion list closed and saving a form both resolve the typed text this way.
  it.each([
    ['', [], { kind: 'none' }],
    ['   ', [], { kind: 'none' }],
    ['Satin Matte', [], { kind: 'add', tag: 'satin-matte' }],
    ['satin_matte', ['glossy'], { kind: 'add', tag: 'satin-matte' }],
    ['Glossy', ['glossy'], { kind: 'present', tag: 'glossy' }],
    ['t3', twenty, { kind: 'present', tag: 't3' }],
    ['!!', [], { kind: 'invalid', problem: 'empty' }],
    ['x'.repeat(41), [], { kind: 'invalid', problem: 'tooLong' }],
    ['one more', twenty, { kind: 'invalid', problem: 'tooMany' }],
  ])('[%s] with %j -> %j', (text, tags, expected) => {
    expect(pendingTag(text, tags)).toEqual(expected);
  });

  it('saves a valid pending tag with the form and blocks only text that cannot become one', () => {
    expect(withPendingTag(['glossy'], 'Satin Matte')).toEqual(['glossy', 'satin-matte']);
    expect(withPendingTag(['glossy'], ' GLOSSY ')).toEqual(['glossy']);
    expect(withPendingTag(['glossy'], '')).toEqual(['glossy']);
    expect(withPendingTag([], '🔥')).toBeNull();
    expect(withPendingTag([], 'x'.repeat(41))).toBeNull();
    expect(withPendingTag(twenty, 'one more')).toBeNull();
  });
});

describe('tag suggestions', () => {
  const counts = countTags([{ tags: ['satin-matte', 'cone-6'] }, { tags: ['cone-6', 'glossy'] }], [{ tags: ['cone-6', 'matte', 'satin-matte'] }]);

  it('counts tags over all listings, most used first', () => {
    expect(counts).toEqual([
      { tag: 'cone-6', count: 3 },
      { tag: 'satin-matte', count: 2 },
      { tag: 'glossy', count: 1 },
      { tag: 'matte', count: 1 },
    ]);
  });

  it('suggests prefixes first, then later words, without the excluded tags', () => {
    expect(suggestTags(counts, 'Mat').map(({ tag }) => tag)).toEqual(['matte', 'satin-matte']);
    expect(suggestTags(counts, 'satin m').map(({ tag }) => tag)).toEqual(['satin-matte']);
    expect(suggestTags(counts, '', ['cone-6'], 2).map(({ tag }) => tag)).toEqual(['satin-matte', 'glossy']);
    expect(suggestTags(counts, 'glanz')).toEqual([]);
  });

  it('offers existing tags before the typed one, and nothing while no tag can be added', () => {
    const offered = (text: string, tags: string[] = []) => tagOptions(counts, text, tags).map(({ tag, isNew }) => (isNew ? `new ${tag}` : tag));
    expect(offered('Mat')).toEqual(['matte', 'new mat', 'satin-matte']);
    expect(offered('matte')).toEqual(['matte', 'satin-matte']);
    expect(offered('glossy', ['glossy'])).toEqual([]);
    expect(offered('')).toEqual(['cone-6', 'satin-matte', 'glossy', 'matte']);
    expect(offered('!!')).toEqual([]);
    expect(offered('x'.repeat(41))).toEqual([]);
    expect(
      offered(
        'glossy',
        Array.from({ length: 20 }, (_, index) => `t${index}`),
      ),
    ).toEqual([]);
  });
});

describe('tag filtering', () => {
  const items = [
    { id: 'a', tags: ['cone-6', 'glossy'] },
    { id: 'b', tags: ['cone-6', 'satin-matte'] },
    { id: 'c', tags: ['glossy'] },
    { id: 'd', tags: ['cone-6', 'glossy', 'runny'] },
  ];
  const index = buildTagIndex(items);
  const ids = (selected: string[]) => filterByTags(items, index, selected).map(({ id }) => id);

  it('intersects the selected tags and keeps the listing order', () => {
    expect(ids([])).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(['glossy'])).toEqual(['a', 'c', 'd']);
    expect(ids(['glossy', 'cone-6'])).toEqual(['a', 'd']);
    expect(ids(['cone-6', 'glossy', 'runny'])).toEqual(['d']);
    expect(ids(['glossy', 'unknown'])).toEqual([]);
  });

  // 5,000 items with 3-8 tags each from 300 tags, frequent ones more common (as real tags are).
  const many = (() => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const vocabulary = Array.from({ length: 300 }, (_, n) => `tag-${n}`);
    const pick = () => vocabulary[Math.floor(vocabulary.length * random() ** 2)];
    return Array.from({ length: 5000 }, (_, n) => ({
      id: `item-${n}`,
      tags: [...new Set(Array.from({ length: 3 + Math.floor(random() * 6) }, pick))],
    }));
  })();
  const built = buildTagIndex(many);
  const scan = (selected: string[]) => many.filter(({ tags }) => selected.every((tag) => tags.includes(tag)));
  const selections = [['tag-0'], ['tag-0', 'tag-1'], ['tag-0', 'tag-1', 'tag-5'], ['tag-250']];

  it('filters a few thousand items through the index like a plain scan', () => {
    for (const selected of selections) expect(filterByTags(many, built, selected)).toEqual(scan(selected));
  });

  // Timing is opt-in (BENCH=1 npx vitest run src/lib/tags): it takes about 200 ms and logs to the console.
  it.runIf(process.env.BENCH)('filters a few thousand items in well under a frame (benchmark)', () => {
    const time = (runs: number, action: () => unknown) => {
      const start = performance.now();
      for (let run = 0; run < runs; run++) action();
      return (performance.now() - start) / runs;
    };
    const build = time(20, () => buildTagIndex(many));
    const filters = selections.map((selected) => ({
      selected: selected.join('+'),
      matches: filterByTags(many, built, selected).length,
      indexMs: time(500, () => filterByTags(many, built, selected)),
      scanMs: time(100, () => scan(selected)),
    }));
    console.log(
      `tag index over ${many.length} items: build ${build.toFixed(3)} ms; ` +
        filters.map(({ selected, matches, indexMs, scanMs }) => `${selected} (${matches}) ${indexMs.toFixed(4)} ms vs scan ${scanMs.toFixed(3)} ms`).join('; '),
    );
    // Generous bounds so slow CI machines pass; a frame is 16 ms.
    expect(build).toBeLessThan(50);
    for (const { indexMs } of filters) expect(indexMs).toBeLessThan(5);
  });
});

describe('buildTagIndex per list', () => {
  it('answers one index for one list, also for a page that mounts again', () => {
    const items = [{ tags: ['satin'] }];
    expect(buildTagIndex(items)).toBe(buildTagIndex(items));
    expect(buildTagIndex([...items])).not.toBe(buildTagIndex(items));
  });
});
