/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const components = (readdirSync(root, { recursive: true, encoding: 'utf8' }) as string[]).filter((path) => path.endsWith('.svelte'));

/** Every `<button>` of a component: its attributes and what it shows. */
function buttons(path: string): { attributes: string; content: string }[] {
  const button = /<button\b((?:[^>"'{]|"[^"]*"|'[^']*'|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})*)>([\s\S]*?)<\/button>/g;
  return [...read(path).matchAll(button)].map(([, attributes, content]) => ({ attributes, content }));
}

/** What a button shows as text: no tags or block syntax, a literal without its quotes, an entity as one glyph. */
function visibleText(content: string): string {
  return content
    .replace(/<[^>]*>/g, '')
    .replace(/\{[#:/][^}]*\}/g, '')
    .replace(/\{\s*['"`]([^'"`]*)['"`]\s*\}/g, '$1')
    .replace(/&[a-z0-9#]+;/gi, '×')
    .trim();
}

const everyButton = components.flatMap((path) => buttons(path).map((button) => ({ path, ...button, text: visibleText(button.content) })));
const iconOnly = everyButton.filter(({ content, text }) => /<Icon\b/.test(content) && !text);

describe('icon buttons', () => {
  it('finds the buttons of a component, also with arrow functions in their attributes', () => {
    expect(buttons('components/glazes/GlazeRow.svelte').map(({ attributes }) => /glaze-row__quick/.test(attributes))).toContain(true);
    // The rules below look at these: a pattern that stopped matching would pass them all.
    expect(iconOnly.length).toBeGreaterThan(20);
  });

  it('shows no typed glyph or inline drawing on a button: `ui/Icon` is the one set of glyphs', () => {
    // One or two symbols, or a lone x: a label has letters. A drawing beside visible text is a text button (the scan button's label).
    const typed = everyButton.filter(({ content, text }) => (/<svg/.test(content) && !text) || /^(?:[^\p{L}\p{N}{}\s]{1,2}|x)$/iu.test(text));
    expect(typed.map(({ path, text }) => `${path}: ${text}`)).toEqual([]);
  });

  it('gives every button that shows only an icon the shared `.icon-button` class and an accessible name', () => {
    for (const { path, attributes } of iconOnly) {
      expect(attributes, path).toMatch(/(?<![\w-])icon-button(?![\w-])/);
      expect(attributes, path).toMatch(/aria-label=/);
    }
  });

  it('sizes the glyph by its class, not by an element selector', () => {
    expect(read('style.css')).not.toMatch(/\.icon-button[^{}]*\ssvg\b/);
    expect(read('components/ui/Icon.svelte')).toMatch(/class="icon-button__glyph"/);
  });
});
