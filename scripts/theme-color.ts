/// <reference types="node" />
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

/** The token the header (`layout/AppNav`) paints its background with; a test keeps it in step with the component. */
export const HEADER_TOKEN = '--surface';
/** The token of the page background, which the installed app's splash screen shows. */
export const PAGE_TOKEN = '--canvas';
/** Placeholder for the colour in `index.html`'s `theme-color` meta tag. */
export const THEME_PLACEHOLDER = '__THEME_COLOR__';

/** The `#rrggbb` value of a `--token: #rrggbb;` declaration in the stylesheet. */
export function cssColor(css: string, token: string): string {
  const match = new RegExp(`${token}:\\s*(#[0-9a-f]{6})\\s*;`, 'i').exec(css);
  if (!match) throw new Error(`style.css has no ${token} colour in #rrggbb form`);
  return match[1].toLowerCase();
}

/**
 * The colours of the installed app, read from the design tokens so they cannot drift from the page: `theme` (the manifest's `theme_color`
 * and the `theme-color` meta tag, which tint the status bar) is the header's background; `background` (`background_color`, the splash
 * screen) is the page background the app opens on.
 */
export function appColors(css: string = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')) {
  return { theme: cssColor(css, HEADER_TOKEN), background: cssColor(css, PAGE_TOKEN) };
}

export function themeColorMeta(html: string, color: string): string {
  if (!html.includes(THEME_PLACEHOLDER)) throw new Error(`index.html has no ${THEME_PLACEHOLDER} placeholder for the theme colour`);
  return html.replaceAll(THEME_PLACEHOLDER, color);
}

/** Fills the `theme-color` meta tag of `index.html` (dev server and build) from the same colour as the manifest. */
export function themeColor(color: string): Plugin {
  return {
    name: 'theme-color',
    transformIndexHtml: { order: 'pre', handler: (html) => themeColorMeta(html, color) },
  };
}
