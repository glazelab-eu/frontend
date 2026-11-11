/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');

/** The `#rgb` / `#rrggbb` value of a token declared in `:root`. */
function token(name: string): string {
  const match = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})\\s*;`).exec(css);
  if (!match) throw new Error(`${name} is not a #rgb or #rrggbb token in style.css`);
  const hex = match[1].slice(1);
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex;
  return `#${full.toLowerCase()}`;
}

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two tokens. */
function ratio(a: string, b: string): number {
  const [light, dark] = [luminance(token(a)), luminance(token(b))].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

// Text needs 4.5:1 (WCAG 1.4.3), the boundary of a field 3:1 (1.4.11).
/** The declarations of the first rule with exactly this selector in `style.css`. */
function rule(selector: string): string {
  const match = new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`style.css has no ${selector} rule`);
  return match[1];
}

const TEXT = 4.5;
const BOUNDARY = 3;
const PAGE = ['--canvas', '--surface'];
const TINTS = ['--sage', '--blue', '--peach', '--danger-bg', '--warning-bg', '--favorite-bg'];

describe('colour contrast of the design tokens', () => {
  it('reads tokens and computes WCAG ratios', () => {
    expect(token('--paper')).toBe('#ffffff');
    expect(ratio('--paper', '--ink')).toBeGreaterThan(10);
    expect(ratio('--canvas', '--canvas')).toBe(1);
  });

  it.each([
    ['--ink', [...PAGE, '--paper', ...TINTS]],
    ['--muted', [...PAGE, '--paper', ...TINTS]],
    ['--accent', [...PAGE, '--paper', '--sage', '--blue', '--peach']],
    ['--warm-ink', PAGE],
    ['--danger-ink', [...PAGE, '--paper', '--danger-bg']],
    ['--warning-ink', [...PAGE, '--warning-bg']],
    ['--favorite-ink', [...PAGE, '--favorite-bg']],
  ])('%s is readable on its backgrounds', (foreground, backgrounds) => {
    for (const background of backgrounds) expect(ratio(foreground, background), `${foreground} on ${background}`).toBeGreaterThanOrEqual(TEXT);
  });

  it('keeps the full-screen photo viewer readable on its dark ground and its controls visible', () => {
    for (const text of ['--viewer-ink', '--viewer-muted'])
      for (const ground of ['--viewer-bg', '--viewer-control']) expect(ratio(text, ground), `${text} on ${ground}`).toBeGreaterThanOrEqual(TEXT);
    // The round controls' rim against the ground and against a dark photo is not needed (the glyph and the fill carry them); the rim against the ground is.
    expect(ratio('--viewer-line', '--viewer-bg')).toBeGreaterThanOrEqual(BOUNDARY);
    expect(ratio('--viewer-ink', '--viewer-control')).toBeGreaterThanOrEqual(BOUNDARY);
    expect(ratio('--viewer-ink', '--viewer-bg')).toBeGreaterThanOrEqual(BOUNDARY);
  });

  it('draws the line of every ui/Callout tone against its tint and the page, and its club glyph on the warm tint', () => {
    // components/ui/Callout.svelte: warm = --warm-ink on --peach, sage = --accent on --sage (the shelf's club and personal boxes).
    for (const [line, tint] of [
      ['--warm-ink', '--peach'],
      ['--accent', '--sage'],
    ]) {
      expect(ratio(line, tint), `${line} on ${tint}`).toBeGreaterThanOrEqual(BOUNDARY);
      for (const background of PAGE) expect(ratio(line, background), `${line} on ${background}`).toBeGreaterThanOrEqual(BOUNDARY);
    }
    const callout = readFileSync(new URL('../../components/ui/Callout.svelte', import.meta.url), 'utf8');
    expect(callout).toMatch(/\.callout--warm \{\s*border-color: var\(--warm-ink\);\s*background: var\(--peach\);/);
    expect(callout).toMatch(/\.callout--sage \{\s*border-color: var\(--accent\);\s*background: var\(--sage\);/);
  });

  it('text on the accent and danger buttons is readable', () => {
    for (const background of ['--accent', '--accent-hover', '--danger-ink', '--danger-hover'])
      expect(ratio('--paper', background), `--paper on ${background}`).toBeGreaterThanOrEqual(TEXT);
  });

  it('draws the boundary of a field against every background it sits on', () => {
    for (const background of ['--paper', ...PAGE])
      expect(ratio('--control-border', background), `--control-border on ${background}`).toBeGreaterThanOrEqual(BOUNDARY);
  });

  it('keeps the shared .button readable and its boundary visible on the page and on cards', () => {
    const button = rule('.button');
    expect(button).toMatch(/text-decoration:\s*none;/);
    expect(button).toMatch(/background:\s*var\(--surface\);/);
    expect(button).toMatch(/color:\s*var\(--ink\);/);
    expect(button).toMatch(/border:\s*0\.0625rem solid var\(--control-border\);/);
    // The outlined secondary button: its text on its own fill, its boundary on the canvas and on a card.
    expect(ratio('--ink', '--surface')).toBeGreaterThanOrEqual(TEXT);
    for (const background of PAGE) expect(ratio('--control-border', background), `.button border on ${background}`).toBeGreaterThanOrEqual(BOUNDARY);
  });

  it('keeps the shared .icon-button readable, its boundary visible and its selected state on its own colours', () => {
    const button = rule('.icon-button');
    expect(button).toMatch(/background:\s*var\(--surface\);/);
    expect(button).toMatch(/color:\s*var\(--accent\);/);
    expect(button).toMatch(/border:\s*0\.0625rem solid var\(--control-border\);/);
    expect(ratio('--accent', '--surface')).toBeGreaterThanOrEqual(BOUNDARY);
    expect(ratio('--favorite-ink', '--favorite-bg')).toBeGreaterThanOrEqual(BOUNDARY);
    expect(ratio('--viewer-ink', '--viewer-control')).toBeGreaterThanOrEqual(BOUNDARY);
  });

  it('keeps the outlined danger button (Delete combination, glaze removal) visible on the page and on cards', () => {
    for (const background of PAGE) {
      expect(ratio('--danger-ink', background), `danger border on ${background}`).toBeGreaterThanOrEqual(BOUNDARY);
      expect(ratio('--danger-ink', background), `danger text on ${background}`).toBeGreaterThanOrEqual(TEXT);
    }
    // A solid button carries its fill as its border, so the new grey border never frames a green or red button.
    expect(rule('.button--primary')).toMatch(/border-color:\s*var\(--accent\);/);
    expect(rule('.button--danger')).toMatch(/border-color:\s*var\(--danger-ink\);/);
  });

  it('keeps the boundary of every component-level .button override as strong as the shared rule', () => {
    // A component may resize a .button but never fade its border back to the 1.2:1 --border (24-9).
    const overrides: [string, string][] = [
      ['components/glazes/GlazeBarcodes.svelte', '.glaze-barcodes__button'],
      ['components/glazes/AddGlazeDialog.svelte', '.add-glaze__action'],
      ['components/routing/RouteStatus.svelte', '.route-status__secondary'],
      ['components/stock/ShelfControls.svelte', '.shelf-controls__button'],
      ['components/stock/GlazeShelf.svelte', '.glaze-shelf__actions .button'],
      ['components/stock/ScanSheet.svelte', '.scan-sheet__step'],
      ['components/stock/ScanSheet.svelte', '.scan-sheet__other'],
      ['pages/catalog/DiscoverPage.svelte', '.filters__open'],
      ['pages/catalog/DiscoverPage.svelte', '.filters__scan'],
      ['pages/stock/StockPage.svelte', '.stock-scan__button'],
    ];
    for (const [file, selector] of overrides) {
      const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
      const escaped = selector.replace(/[.]/g, '\\.');
      const match = new RegExp(`(?:^|\\n|,\\s*)\\s*${escaped}\\s*(?:,[^{]*)?\\{([^}]*)\\}`).exec(source);
      // A rule that is gone (the .button border applies) passes; one that is kept must not set --border.
      expect(match?.[1] ?? '', `${file} ${selector}`).not.toMatch(/var\(--border\)/);
    }
  });

  it('puts no outlined .button on a tinted notice: the install and scanner-reload buttons are solid', () => {
    for (const [file, tint] of [
      ['components/layout/InstallPrompt.svelte', '--blue'],
      ['components/scanning/BarcodeScanner.svelte', '--warning-bg'],
    ]) {
      expect(ratio('--control-border', tint), `an outlined button would sit under ${BOUNDARY}:1 on ${tint}`).toBeLessThan(BOUNDARY);
      expect(ratio('--accent', tint), `solid button on ${tint}`).toBeGreaterThanOrEqual(BOUNDARY);
      const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
      const outlined = [...source.matchAll(/class="button"/g)].length;
      const onTint = file.includes('InstallPrompt')
        ? /class="button button--primary"\s+onclick=\{onOpen\}/
        : /class="button button--primary"\s+onclick=\{\(event\)[^]*?reloadApp/;
      expect(source, file).toMatch(onTint);
      expect(outlined, `${file} outlined buttons`).toBe(file.includes('InstallPrompt') ? 1 : 0);
    }
  });
});
