/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync(new URL('./DiscoverPage.svelte', import.meta.url), 'utf8');
const script = page.slice(0, page.indexOf('</script>'));
const explored = script.slice(script.indexOf('let result = $derived('), script.indexOf('let quick = $derived(result.quick)'));

/** A store update that changes none of Explore's inputs (a toast, an unchanged sync state) must derive nothing: guide "Delta cost". */
describe("Explore's inputs in DiscoverPage", () => {
  it('reads each store field it derives from through one derived, once', () => {
    for (const field of ['stock', 'buddies', 'buddyAvailability', 'favoriteCounts', 'favorites', 'glazes', 'combinations', 'sync']) {
      expect(page.match(new RegExp(`\\$appStore\\.${field}\\b`, 'g')), field).toHaveLength(1);
      expect(script, field).toContain(`let ${field} = $derived($appStore.${field});`);
    }
  });

  it('gives `explore` no store value and no `user` object, as both change with every load', () => {
    expect(explored).toContain('explore({');
    expect(explored).not.toMatch(/\$appStore/);
    expect(explored).not.toMatch(/\buser\b/);
  });
});
