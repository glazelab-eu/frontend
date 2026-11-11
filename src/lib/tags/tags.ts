/**
 * Tag rules, mirroring the backend's model/Tags.java (same limits, same test table): lower case
 * words of letters, marks and digits joined by single hyphens. Accents are kept (glänzend and
 * glanzend are different tags); only the Unicode form is unified (NFC). Tags are user content and
 * never translated.
 */
export const tagMaxLength = 40;
export const maxTagsPerItem = 20;

/** "  Satin Matte ", "satin_matte" and "satin--matte" all become satin-matte; may return ''. */
export function normalizeTag(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '');
}

/** Why a typed tag cannot be added to an item with these tags, or null when it can. */
export function tagProblem(tag: string, tags: string[]): 'empty' | 'tooLong' | 'tooMany' | null {
  if (!tag) return 'empty';
  if (tag.length > tagMaxLength) return 'tooLong';
  return !tags.includes(tag) && tags.length >= maxTagsPerItem ? 'tooMany' : null;
}

/** What typed but unconfirmed tag text means for an item with these tags. */
export type PendingTag =
  { kind: 'none' } | { kind: 'add'; tag: string } | { kind: 'present'; tag: string } | { kind: 'invalid'; problem: 'empty' | 'tooLong' | 'tooMany' };

export function pendingTag(text: string, tags: string[]): PendingTag {
  if (!text.trim()) return { kind: 'none' };
  const tag = normalizeTag(text);
  if (tag && tags.includes(tag)) return { kind: 'present', tag };
  const problem = tagProblem(tag, tags);
  return problem ? { kind: 'invalid', problem } : { kind: 'add', tag };
}

/**
 * A form's tags once its pending tag text is saved with it: a valid new tag is added, an already
 * added one is ignored. Null while the text cannot become a tag, which blocks the form.
 */
export function withPendingTag(tags: string[], text: string): string[] | null {
  const pending = pendingTag(text, tags);
  if (pending.kind === 'invalid') return null;
  return pending.kind === 'add' ? withTag(tags, pending.tag) : tags;
}

/** Tags with or without one more, in the server's order. */
export function withTag(tags: string[], tag: string): string[] {
  return tags.includes(tag) ? tags : [...tags, tag].sort();
}

export interface TagCount {
  tag: string;
  count: number;
}

type Tagged = { tags: string[] };

/** The tags a glaze or combination has in the loaded listings (none while it is not loaded). */
export function tagsOf(
  lists: { glazes: (Tagged & { id: string })[]; combinations: (Tagged & { id: string })[] },
  target: { type: 'glaze' | 'combination'; id: string },
): string[] {
  const items = target.type === 'glaze' ? lists.glazes : lists.combinations;
  return items.find((item) => item.id === target.id)?.tags ?? [];
}

/** Every tag of the loaded items, most used first, then alphabetically. */
export function countTags(...lists: Tagged[][]): TagCount[] {
  const counts = new Map<string, number>();
  for (const items of lists) for (const { tags } of items) for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * Existing tags for typed text, keeping the counts' order: tags that start with the normalized
 * text first, then tags with a later word that does (matte finds satin-matte). Empty text lists
 * the most used tags.
 */
export function suggestTags(counts: TagCount[], text: string, exclude: string[] = [], limit = 8): TagCount[] {
  const query = normalizeTag(text);
  const available = counts.filter(({ tag }) => !exclude.includes(tag));
  if (!query) return available.slice(0, limit);
  const starts = available.filter(({ tag }) => tag.startsWith(query));
  const words = available.filter(({ tag }) => !tag.startsWith(query) && tag.includes(`-${query}`));
  return [...starts, ...words].slice(0, limit);
}

/**
 * What the tag input offers for typed text: the typed tag if it exists, then existing tags starting
 * with it (so Enter picks an existing tag over a near-duplicate), then the typed tag as a new one,
 * then tags with a later word starting with it. Nothing while no tag can be added.
 */
export function tagOptions(counts: TagCount[], text: string, tags: string[]): (TagCount & { isNew: boolean })[] {
  const tag = normalizeTag(text);
  if ((text.trim() && !tag) || tagProblem(tag, tags) === 'tooMany') return [];
  const existing = suggestTags(counts, text, tags).map((option) => ({ ...option, isNew: false }));
  const fresh = tag && !tagProblem(tag, tags) && !tags.includes(tag) && !existing.some((o) => o.tag === tag) ? [{ tag, count: 0, isNew: true }] : [];
  const starts = existing.filter((option) => option.tag.startsWith(tag));
  return [
    ...starts.filter((option) => option.tag === tag),
    ...starts.filter((option) => option.tag !== tag),
    ...fresh,
    ...existing.filter((option) => !option.tag.startsWith(tag)),
  ];
}

/** Positions of the items carrying each tag, ascending: built once per list, not per keystroke or per visit to Explore. Never edit the list. */
export type TagIndex = Map<string, number[]>;

const tagIndexes = new WeakMap<object, TagIndex>();

export function buildTagIndex(items: readonly Tagged[]): TagIndex {
  const known = tagIndexes.get(items);
  if (known) return known;
  const index: TagIndex = new Map();
  items.forEach(({ tags }, position) => {
    for (const tag of tags) {
      const positions = index.get(tag);
      if (positions) positions.push(position);
      else index.set(tag, [position]);
    }
  });
  tagIndexes.set(items, index);
  return index;
}

/** The items carrying every selected tag, in listing order, by intersecting the index's lists. */
export function filterByTags<T>(items: T[], index: TagIndex, selected: string[]): T[] {
  if (!selected.length) return items;
  const lists = selected.map((tag) => index.get(tag) ?? []).sort((a, b) => a.length - b.length);
  let result = lists[0];
  for (const list of lists.slice(1)) {
    const next: number[] = [];
    for (let i = 0, j = 0; i < result.length && j < list.length;) {
      if (result[i] === list[j]) {
        next.push(result[i]);
        i++;
        j++;
      } else if (result[i] < list[j]) i++;
      else j++;
    }
    result = next;
  }
  return result.map((position) => items[position]);
}
