import { locales, type Locale } from '../i18n/locales';
import { normalizeTag, tagProblem } from '../tags/tags';
import { type Scored, type Thresholds } from './scoring';

/** The tag of a label in each language the app has: the word a person writing in that language would type. */
export type LabelTags = Record<Locale, string>;

export interface VisionLabel {
  id: string;
  /** Null for a label that is never suggested: it only takes probability from the others (a person, a landscape, a jar ...). */
  tags: LabelTags | null;
  embedding: number[];
}

/** `models/vision/labels.json`, made by `scripts/vision-model.py`; loaded together with the model. */
export interface VisionLabels {
  model: { id: string; source: string; input: number; mean: number[]; std: number[]; scale: number; dimension: number };
  thresholds: Thresholds;
  labels: VisionLabel[];
}

const isNumbers = (value: unknown, length?: number): value is number[] =>
  Array.isArray(value) && (length === undefined || value.length === length) && value.every((item) => typeof item === 'number' && Number.isFinite(item));

/** The parsed label file; throws when it is not shaped as expected (a half-downloaded or foreign file is never used). */
export function parseLabels(value: unknown): VisionLabels {
  const file = value as VisionLabels | null;
  const model = file?.model;
  if (!model || typeof model.input !== 'number' || !isNumbers(model.mean, 3) || !isNumbers(model.std, 3) || !(model.scale > 0) || !(model.dimension > 0)) {
    throw new TypeError('labels: bad model');
  }
  const thresholds = file.thresholds;
  if (!thresholds || !(thresholds.minProbability >= 0) || !Number.isFinite(thresholds.minCosine) || !(thresholds.maxSuggestions >= 1)) {
    throw new TypeError('labels: bad thresholds');
  }
  if (!Array.isArray(file.labels) || !file.labels.length) throw new TypeError('labels: none');
  for (const label of file.labels) {
    if (typeof label?.id !== 'string' || !isNumbers(label.embedding, model.dimension)) throw new TypeError('labels: bad label');
    if (
      label.tags !== null &&
      !locales.every((locale) => typeof label.tags?.[locale] === 'string' && normalizeTag(label.tags[locale]) === label.tags[locale])
    ) {
      throw new TypeError(`labels: bad tags of ${label.id}`);
    }
  }
  return file;
}

/**
 * The tag a chip adds for a label. The tag of the writer's language, unless the loaded tags already hold the label's
 * word in another language (a library that already says "mug" is not given a second "caneca"): then that existing tag.
 */
export function tagFor(tags: LabelTags, locale: Locale, existing: readonly string[]): string {
  const own = tags[locale] ?? tags.en;
  if (existing.includes(own)) return own;
  return locales.map((language) => tags[language]).find((tag) => existing.includes(tag)) ?? own;
}

export interface SuggestedTag {
  /** The label the tag comes from. */
  label: string;
  tag: string;
}

/**
 * The chips for scored labels: the tag of each suggested label for this language, without the tags the item has
 * already and without a tag the item cannot take (it has too many). The tags are shaped by the shared tag rules.
 */
export function suggestedTags(
  suggestions: readonly Pick<Scored, 'id'>[],
  labels: readonly Pick<VisionLabel, 'id' | 'tags'>[],
  locale: Locale,
  itemTags: readonly string[],
  knownTags: readonly string[],
): SuggestedTag[] {
  const result: SuggestedTag[] = [];
  for (const { id } of suggestions) {
    const tags = labels.find((label) => label.id === id)?.tags;
    if (!tags) continue;
    const tag = normalizeTag(tagFor(tags, locale, knownTags));
    if (itemTags.includes(tag) || result.some((chip) => chip.tag === tag)) continue;
    if (tagProblem(tag, [...itemTags]) !== null) continue;
    result.push({ label: id, tag });
  }
  return result;
}

/** Merges the suggestions of several photos: each label once, with its best probability, best first. */
export function mergeScored(lists: readonly (readonly Scored[])[]): Scored[] {
  const best = new Map<string, Scored>();
  for (const list of lists) for (const item of list) if ((best.get(item.id)?.probability ?? -1) < item.probability) best.set(item.id, item);
  return [...best.values()].sort((a, b) => b.probability - a.probability);
}
