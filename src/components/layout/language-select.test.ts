import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import LanguageSelect from './LanguageSelect.svelte';

describe('LanguageSelect', () => {
  it('offers every language in its own name and language, English first, then by that name', () => {
    const body = render(LanguageSelect).body;
    const options = [...body.matchAll(/<option[^>]*value="([^"]+)"[^>]*lang="([^"]+)"[^>]*>\s*([^<]+?)\s*</g)].map(([, value, lang, name]) => [
      value,
      lang,
      name,
    ]);
    expect(options).toEqual([
      ['en', 'en', 'English'],
      ['de', 'de', 'Deutsch'],
      ['es', 'es', 'Español'],
      ['it', 'it', 'Italiano'],
      ['pt-PT', 'pt-PT', 'Português'],
    ]);
  });
});
