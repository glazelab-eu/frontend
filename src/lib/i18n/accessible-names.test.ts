import { describe, expect, it } from 'vitest';
import { dictionaries } from '../../test/dictionaries';
import { icuArguments } from '../../test/icu';

/**
 * The keys that become accessible names, read from the markup, checked in every language: a missing, empty or unparsable
 * translation would give a nameless button or link (or one that shows raw `{braces}`) in that language only, which the
 * English axe run cannot see (frontend guide "Accessibility").
 *
 * Seen: every message key quoted inside the braces of a naming attribute or prop in `.svelte` files: `aria-label`, `alt`,
 * `title` (also `ModalShell`'s dialog name), `label`, `ariaLabel` and the `…Label` props of the ui components, ternaries
 * included (`aria-label={busy ? $t('a') : $t('b')}`, `$t(open ? 'a' : 'b')`). Not seen: names built in script code and passed
 * on as a variable (`aria-label={label}` where `label` comes from a `$derived`), keys picked from a map (`$t(labels[kind])`),
 * `aria-labelledby` (it points at an element whose text is ordinary content) and the visible text of buttons and links.
 */
const NAMING = /(?:^|\s)(aria-label|alt|title|label|ariaLabel|[a-z]\w*Label)=\{/g;

const sources = import.meta.glob(['/src/**/*.svelte'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const english: Record<string, string> = dictionaries.en;
const languages = Object.keys(dictionaries) as (keyof typeof dictionaries)[];

/** The text between the opening brace at `start` and its closing brace. */
function braced(text: string, start: number): string {
  let depth = 0;
  for (let end = start; end < text.length; end++) {
    if (text[end] === '{') depth++;
    else if (text[end] === '}' && --depth === 0) return text.slice(start + 1, end);
  }
  return text.slice(start + 1);
}

function namingKeys(): Map<string, string> {
  const found = new Map<string, string>();
  for (const [file, text] of Object.entries(sources)) {
    for (const match of text.matchAll(NAMING)) {
      const value = braced(text, match.index + match[0].length - 1);
      for (const literal of value.matchAll(/'([\w.-]+)'|"([\w.-]+)"/g)) {
        const key = literal[1] ?? literal[2];
        if (Object.hasOwn(english, key) && !found.has(key)) found.set(key, `${file} ${match[1]}`);
      }
    }
  }
  return found;
}

describe('accessible names in every language', () => {
  const keys = namingKeys();

  it('finds the naming keys of the markup', () => {
    expect(keys.size).toBeGreaterThan(150);
    for (const key of ['feedback.removePhoto', 'feedback.photo', 'feedback.title', 'clubs.wishlist.markAcquiredFor', 'images.galleryNavigation'])
      expect([...keys.keys()]).toContain(key);
  });

  it.each(languages)('%s has a non-empty, well-formed text for every accessible name', (language) => {
    const dictionary: Record<string, string> = dictionaries[language];
    const problems: string[] = [];
    for (const [key, where] of keys) {
      const text = dictionary[key];
      if (typeof text !== 'string' || !text.trim()) {
        problems.push(`${key} is missing or empty (${where})`);
        continue;
      }
      try {
        icuArguments(text);
      } catch (error) {
        problems.push(`${key} does not parse: ${String(error)} (${where})`);
      }
    }
    expect(problems).toEqual([]);
  });
});
