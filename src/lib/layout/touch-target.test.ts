/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const sources = (readdirSync(root, { recursive: true, encoding: 'utf8' }) as string[]).filter((path) => /\.(svelte|css)$/.test(path));
const css = read('style.css');

describe('touch targets', () => {
  it('defines the 44 px token once and sizes touch screens from the pointer, not the window width', () => {
    expect(css).toMatch(/--touch-target:\s*2\.75rem;/);
    expect(css).toMatch(/--touch-target-compact:\s*2\.5rem;/);
    expect(css).toMatch(/@media \(pointer: coarse\)/);
    for (const path of sources) expect(read(path), path).not.toMatch(/@media[^{]*(?:pointer:\s*coarse[^{]*width|width[^{]*pointer:\s*coarse)/);
  });

  it('never repeats the literal: a size of 2.75rem is the token', () => {
    const literal = sources.filter((path) => path !== 'style.css').filter((path) => /\b2\.75rem\b/.test(read(path)));
    expect(literal).toEqual([]);
    expect(css.match(/\b2\.75rem\b/g)).toHaveLength(1);
  });

  it('keeps touch rules in pointer: coarse blocks that use the token, never a fixed 44 px', () => {
    for (const path of sources) {
      const text = read(path);
      expect(text, path).not.toMatch(/\b44px\b/);
      for (const block of text.split(/@media \(pointer:\s*coarse\)/).slice(1)) {
        expect(block, path).not.toMatch(/(?:min-)?(?:width|height|block-size|inline-size):\s*2\.75rem/);
      }
    }
  });

  it('gives each file at most one touch block, as the last rule of its styles, and no other pointer query', () => {
    for (const path of sources) {
      const text = read(path);
      const styles = (path.endsWith('.css') ? text : (text.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? '')).replace(/\/\*[\s\S]*?\*\//g, '');
      expect(styles, path).not.toMatch(/any-pointer|hover:\s*none|pointer:\s*fine/);
      const starts = [...styles.matchAll(/@media[^{]*pointer:\s*coarse[^{]*\{/g)];
      expect(starts.length, path).toBeLessThanOrEqual(1);
      if (!starts.length) continue;
      let end = starts[0].index + starts[0][0].length;
      for (let depth = 1; depth > 0 && end < styles.length; end++) depth += styles[end] === '{' ? 1 : styles[end] === '}' ? -1 : 0;
      expect(styles.slice(end).trim(), path).toBe('');
    }
  });
});
