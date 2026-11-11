/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The shelf UI's own files: its components and its page. */
const folders = [new URL('./', import.meta.url), new URL('../../pages/stock/', import.meta.url)];
const sources = folders.flatMap((folder) =>
  readdirSync(folder)
    .filter((name) => name.endsWith('.svelte'))
    .map((name) => ({ name, source: readFileSync(new URL(name, folder), 'utf8') })),
);

describe('the club look of the shelf (USER 2026-11-08)', () => {
  it('reads the shelf files', () => {
    expect(sources.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['ShelfScope.svelte', 'ShelfSelect.svelte', 'ShelfList.svelte', 'StockPage.svelte']),
    );
  });

  it('has no side bar and no tint of its own: the boxes are ui/Callout', () => {
    const offenders = sources.filter(({ source }) => /border-(inline-start|left)\b|--peach/.test(source)).map(({ name }) => name);
    expect(offenders).toEqual([]);
    for (const name of ['ShelfScope.svelte', 'ShelfSelect.svelte', 'ShelfList.svelte'])
      expect(sources.find((file) => file.name === name)?.source, name).toMatch(/<Callout\b[^>]*tone="warm"|tone=\{scope\.kind === 'club' \? 'warm'/);
  });
});
