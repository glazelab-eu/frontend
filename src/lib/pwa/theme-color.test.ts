/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { appColors, cssColor, HEADER_TOKEN, PAGE_TOKEN, THEME_PLACEHOLDER, themeColorMeta } from '../../../scripts/theme-color';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const css = read('src/style.css');

describe('installed app colours', () => {
  it('reads #rrggbb tokens and refuses anything else', () => {
    expect(cssColor('a { --x: #ABCDEF; }', '--x')).toBe('#abcdef');
    expect(() => cssColor('a { --x: red; }', '--x')).toThrow();
    expect(() => cssColor('a { --y: #fff; }', '--y')).toThrow();
  });

  it('uses the colour the header paints its background with as the theme colour', () => {
    const header = /\.app-nav\s*\{[^}]*?background:\s*var\((--[a-z-]+)\)/.exec(read('src/components/layout/AppNav.svelte'));
    expect(header?.[1]).toBe(HEADER_TOKEN);
    expect(appColors(css).theme).toBe(cssColor(css, header![1]));
  });

  it('uses the page background as the splash colour', () => {
    const page = /:root\s*\{[^}]*?\n\s*background:\s*var\((--[a-z-]+)\)/.exec(css);
    expect(page?.[1]).toBe(PAGE_TOKEN);
    expect(appColors(css).background).toBe(cssColor(css, page![1]));
  });

  it('writes the theme colour into the index.html meta tag and nowhere else', () => {
    const html = read('index.html');
    expect(html.split(THEME_PLACEHOLDER)).toHaveLength(2);
    expect(html).toMatch(new RegExp(`name="theme-color"\\s+content="${THEME_PLACEHOLDER}"`));
    const filled = themeColorMeta(html, appColors(css).theme);
    expect(filled).not.toContain(THEME_PLACEHOLDER);
    expect(filled).toMatch(/name="theme-color"\s+content="#[0-9a-f]{6}"/);
    expect(() => themeColorMeta('<html></html>', '#ffffff')).toThrow();
  });

  it('keeps hard-coded colours out of the Vite config, so the manifest cannot drift', () => {
    const config = read('vite.config.ts');
    expect(config).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(config).toContain('theme_color: colors.theme');
    expect(config).toContain('background_color: colors.background');
  });
});
