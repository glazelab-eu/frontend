/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const components = (readdirSync(root, { recursive: true, encoding: 'utf8' }) as string[]).filter((path) => path.endsWith('.svelte'));
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const css = withoutComments(read('style.css'));

/** Every rule of a stylesheet as its selector list and its declarations, nested `@media` blocks flattened. */
function rules(styles: string): { selectors: string[]; body: string }[] {
  const found: { selectors: string[]; body: string }[] = [];
  const open: string[] = [];
  let text = '';
  for (const char of styles) {
    if (char === '{') {
      open.push(text.trim());
      text = '';
    } else if (char === '}') {
      const selector = open.pop() ?? '';
      if (!selector.startsWith('@')) found.push({ selectors: selector.split(',').map((part) => part.trim()), body: text });
      text = '';
    } else text += char;
  }
  return found;
}

const styleOf = (source: string) => withoutComments(source.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? '');

describe('shared button rows and visually hidden text', () => {
  it('defines .button-row, .button-row--end and .visually-hidden once in style.css, and the touch gap in its coarse block', () => {
    for (const name of ['.button-row', '.button-row--end', '.visually-hidden']) {
      const outside = css.replace(/@media \(pointer: coarse\) \{[\s\S]*$/, '');
      expect(
        rules(outside).filter((rule) => rule.selectors.includes(name)),
        name,
      ).toHaveLength(1);
    }
    const coarse = css.slice(css.indexOf('@media (pointer: coarse)'));
    expect(rules(coarse).find((rule) => rule.selectors.includes('.button-row'))?.body).toMatch(/gap:\s*var\(--touch-gap\)/);
  });

  it('keeps every copy out of the components', () => {
    for (const path of components) {
      const styles = styleOf(read(path));
      for (const rule of rules(styles)) {
        expect(
          rule.selectors.filter((selector) => /\.(button-row|visually-hidden)\b/.test(selector)),
          path,
        ).toEqual([]);
      }
      expect(styles, `${path}: use .visually-hidden`).not.toMatch(/clip-path:\s*inset\(50%\)/);
    }
  });

  it('lets no scoped class redefine the wrap, gap or end alignment of a row that carries .button-row', () => {
    for (const path of components) {
      const source = read(path);
      const partners = new Set<string>();
      for (const [, list] of source.matchAll(/class="([^"{]*\bbutton-row\b[^"{]*)"/g)) {
        for (const name of list.split(/\s+/)) if (name && !name.startsWith('button-row')) partners.add(name);
      }
      for (const rule of rules(styleOf(source))) {
        const own = rule.selectors.filter((selector) => partners.has(selector.slice(1)));
        if (!own.length) continue;
        expect(rule.body, `${path} ${own.join(', ')}`).not.toMatch(/(?:^|;|\s)(?:gap|row-gap|column-gap|flex-wrap)\s*:/);
        expect(rule.body, `${path} ${own.join(', ')}`).not.toMatch(/justify-content:\s*(?:flex-)?end\b/);
      }
    }
  });
});
