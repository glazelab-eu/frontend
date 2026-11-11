import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { locales, setLocale } from '../../lib/i18n';
import { dictionaries } from '../../test/dictionaries';
import TermsView from './TermsView.svelte';

const view = () => render(TermsView, { props: { loadContact: async () => 'operator@example.test' } }).body;

describe('TermsView', () => {
  afterEach(() => setLocale('en'));

  it('says above the terms of every translation that the English text binds, and nothing of the kind in English', async () => {
    await setLocale('en');
    expect(view()).not.toContain('data-terms-translation');
    for (const language of locales.filter((value) => value !== 'en')) {
      await setLocale(language);
      const body = view();
      const note = body.indexOf(dictionaries[language]['terms.translationNote']);
      expect(note, language).toBeGreaterThan(-1);
      expect(note, `${language}: before the first section`).toBeLessThan(body.indexOf(dictionaries[language]['terms.section.hobby.title']));
    }
  });
});
