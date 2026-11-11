import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { locales } from '../i18n/locales';
import { maxTagsPerItem, normalizeTag, tagMaxLength } from '../tags/tags';
import { mergeScored, parseLabels, suggestedTags, tagFor, type LabelTags, type VisionLabels } from './labels';

const labelsFile = JSON.parse(readFileSync(new URL('../../../models/vision/labels.json', import.meta.url), 'utf8')) as VisionLabels;
const mug: LabelTags = { en: 'mug', de: 'becher', 'pt-PT': 'caneca', it: 'mug', es: 'mug' };
const small = (overrides: Partial<VisionLabels> = {}): VisionLabels => ({
  model: { id: 'm', source: 's', input: 224, mean: [0, 0, 0], std: [1, 1, 1], scale: 50, dimension: 2 },
  thresholds: { minProbability: 0.15, minCosine: 0.3, maxSuggestions: 3 },
  labels: [{ id: 'mug', tags: mug, embedding: [1, 0] }],
  ...overrides,
});

describe('the shipped label file', () => {
  const parsed = parseLabels(labelsFile);
  const suggestible = parsed.labels.filter((label) => label.tags);

  it('parses, with unit-length embeddings of the model dimension', () => {
    expect(parsed.model.dimension).toBe(512);
    for (const label of parsed.labels) {
      expect(label.embedding).toHaveLength(512);
      expect(Math.hypot(...label.embedding)).toBeCloseTo(1, 3);
    }
  });

  it('maps every suggested label to a valid, distinct tag in each language', () => {
    expect(suggestible.map((label) => label.id)).toEqual(
      expect.arrayContaining(['mug', 'cup', 'bowl', 'plate', 'vase', 'jug', 'teapot', 'planter', 'tile', 'tray', 'dish', 'sake-cup']),
    );
    for (const language of locales) {
      const tags = suggestible.map((label) => label.tags![language]);
      expect(new Set(tags).size, `${language} tags are distinct`).toBe(tags.length);
      for (const tag of tags) {
        expect(normalizeTag(tag), tag).toBe(tag);
        expect(tag.length).toBeGreaterThan(0);
        expect(tag.length).toBeLessThanOrEqual(tagMaxLength);
      }
    }
    expect(suggestible.length).toBeLessThanOrEqual(maxTagsPerItem);
  });

  it('has labels that are never suggested to take the probability of other kinds of photo', () => {
    expect(parsed.labels.some((label) => label.tags === null)).toBe(true);
  });
});

describe('parseLabels', () => {
  it('accepts a well-formed file and refuses broken ones', () => {
    expect(parseLabels(small()).labels).toHaveLength(1);
    expect(() => parseLabels(null)).toThrow(TypeError);
    expect(() => parseLabels({})).toThrow(TypeError);
    expect(() => parseLabels(small({ labels: [] }))).toThrow(TypeError);
    expect(() => parseLabels(small({ labels: [{ id: 'mug', tags: mug, embedding: [1] }] }))).toThrow(TypeError);
    expect(() => parseLabels(small({ labels: [{ id: 'mug', tags: mug, embedding: [1, Number.NaN] }] }))).toThrow(TypeError);
    expect(() => parseLabels(small({ labels: [{ id: 'mug', tags: { ...mug, de: 'Becher' }, embedding: [1, 0] }] }))).toThrow(TypeError);
    expect(() => parseLabels(small({ labels: [{ id: 'mug', tags: { en: 'mug', de: 'becher' } as LabelTags, embedding: [1, 0] }] }))).toThrow(TypeError);
    // A file from before Italian and Spanish (three languages) is refused rather than suggesting nothing in them.
    expect(() => parseLabels(small({ labels: [{ id: 'mug', tags: { en: 'mug', de: 'becher', 'pt-PT': 'caneca' } as LabelTags, embedding: [1, 0] }] }))).toThrow(
      TypeError,
    );
    expect(() => parseLabels(small({ thresholds: { minProbability: -1, minCosine: 0, maxSuggestions: 3 } }))).toThrow(TypeError);
    expect(() => parseLabels(small({ thresholds: { minProbability: 0.1, minCosine: 0, maxSuggestions: 0 } }))).toThrow(TypeError);
    expect(() => parseLabels(small({ model: { ...small().model, scale: 0 } }))).toThrow(TypeError);
  });

  it('lets a label without tags through', () => {
    expect(parseLabels(small({ labels: [{ id: 'other-person', tags: null, embedding: [0, 1] }] })).labels[0].tags).toBeNull();
  });
});

describe('tagFor', () => {
  it("is the tag of the writer's language by default", () => {
    expect(tagFor(mug, 'en', [])).toBe('mug');
    expect(tagFor(mug, 'de', ['vase'])).toBe('becher');
    expect(tagFor(mug, 'pt-PT', [])).toBe('caneca');
    expect(tagFor(mug, 'it', [])).toBe('mug');
    expect(tagFor(mug, 'es', [])).toBe('mug');
  });

  it('keeps an existing tag of the label in another language instead of adding a second one', () => {
    expect(tagFor(mug, 'de', ['mug', 'vase'])).toBe('mug');
    expect(tagFor(mug, 'pt-PT', ['becher'])).toBe('becher');
    expect(tagFor(mug, 'es', ['caneca'])).toBe('caneca');
  });

  it("prefers an existing tag in the writer's own language", () => {
    expect(tagFor(mug, 'de', ['mug', 'becher'])).toBe('becher');
  });
});

describe('suggestedTags', () => {
  const labels = [
    { id: 'mug', tags: mug },
    { id: 'cup', tags: { en: 'cup', de: 'tasse', 'pt-PT': 'chávena', it: 'tazza', es: 'taza' } },
    { id: 'other-person', tags: null },
  ];
  const scored = [{ id: 'other-person' }, { id: 'mug' }, { id: 'cup' }, { id: 'unknown' }];

  it("gives the tags of the suggested labels in the writer's language, skipping labels without tags", () => {
    expect(suggestedTags(scored, labels, 'de', [], [])).toEqual([
      { label: 'mug', tag: 'becher' },
      { label: 'cup', tag: 'tasse' },
    ]);
  });

  it('gives the Italian and Spanish words, accents kept', () => {
    expect(suggestedTags(scored, labels, 'it', [], [])).toEqual([
      { label: 'mug', tag: 'mug' },
      { label: 'cup', tag: 'tazza' },
    ]);
    expect(
      suggestedTags([{ id: 'vase' }], [{ id: 'vase', tags: { en: 'vase', de: 'vase', 'pt-PT': 'vaso', it: 'vaso', es: 'jarrón' } }], 'es', [], []),
    ).toEqual([{ label: 'vase', tag: 'jarrón' }]);
  });

  it('leaves out tags the item already has', () => {
    expect(suggestedTags(scored, labels, 'en', ['mug'], ['mug'])).toEqual([{ label: 'cup', tag: 'cup' }]);
  });

  it('leaves out every tag when the item cannot take another (the limit)', () => {
    const full = Array.from({ length: maxTagsPerItem }, (_, index) => `tag-${index}`);
    expect(suggestedTags(scored, labels, 'en', full, [])).toEqual([]);
  });

  it('does not offer one tag twice', () => {
    const twins = [
      { id: 'a', tags: mug },
      { id: 'b', tags: mug },
    ];
    expect(suggestedTags([{ id: 'a' }, { id: 'b' }], twins, 'en', [], [])).toEqual([{ label: 'a', tag: 'mug' }]);
  });
});

describe('mergeScored', () => {
  it('keeps each label once with its best probability, best first', () => {
    const merged = mergeScored([
      [
        { id: 'mug', probability: 0.4, cosine: 0.3 },
        { id: 'cup', probability: 0.2, cosine: 0.3 },
      ],
      [
        { id: 'cup', probability: 0.5, cosine: 0.35 },
        { id: 'bowl', probability: 0.3, cosine: 0.3 },
      ],
    ]);
    expect(merged.map(({ id, probability }) => [id, probability])).toEqual([
      ['cup', 0.5],
      ['mug', 0.4],
      ['bowl', 0.3],
    ]);
    expect(mergeScored([])).toEqual([]);
  });
});
