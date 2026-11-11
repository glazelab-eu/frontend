import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import SourceLinks from './SourceLinks.svelte';
import { setLocale } from '../../lib/i18n';
import { dictionaries } from '../../test/dictionaries';

const url = 'https://code.example.test/glazelab';
const links = (body: string) => [...body.matchAll(/<a[^>]*href="([^"]+)"[^>]*>\s*([^<]+?)\s*</g)].map(([, href, text]) => [href, text]);

/** Server-rendered: the component reads only its prop, never the connection, so what shows online also shows offline. */
describe('SourceLinks', () => {
  afterEach(() => setLocale('en'));

  it('hides the source link while no URL is configured or known, and still links the notices', () => {
    for (const sourceUrl of [undefined, null, '']) {
      expect(links(render(SourceLinks, { props: { sourceUrl } }).body)).toEqual([['/THIRD-PARTY-LICENSES.txt', 'Licences']]);
    }
  });

  it('shows the configured source URL next to the notices', () => {
    expect(links(render(SourceLinks, { props: { sourceUrl: url } }).body)).toEqual([
      [url, 'Source code'],
      ['/THIRD-PARTY-LICENSES.txt', 'Licences'],
    ]);
  });

  it('never links a URL that is not http(s)', () => {
    expect(render(SourceLinks, { props: { sourceUrl: 'javascript:alert(1)' } }).body).not.toContain('javascript:');
  });

  it('names both links in every language', async () => {
    for (const language of ['en', 'de', 'pt-PT', 'it', 'es'] as const) {
      await setLocale(language);
      const texts = links(render(SourceLinks, { props: { sourceUrl: url } }).body).map(([, text]) => text);
      expect(texts, language).toEqual([dictionaries[language]['app.sourceCode'], dictionaries[language]['app.licences']]);
    }
  });
});
