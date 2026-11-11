import { describe, expect, it, vi } from 'vitest';
import { createLocaleLoader } from './loader';
import type { Locale } from './locales';
import type { Dictionary } from './messages';

const dictionary = (word: string) => ({ 'language.label': word }) as unknown as Dictionary;

/** A loader whose fetches stay open until the test settles them. */
function setup() {
  const fetches: { locale: Locale; resolve: () => void; reject: (cause: unknown) => void }[] = [];
  const loaderFor = (locale: Locale, word: string) =>
    vi.fn(
      () =>
        new Promise<{ default: Dictionary }>((resolve, reject) => {
          fetches.push({ locale, resolve: () => resolve({ default: dictionary(word) }), reject });
        }),
    );
  const loaders = { de: loaderFor('de', 'Sprache'), it: loaderFor('it', 'Lingua') };
  const shown: Locale[] = ['en'];
  const added: [Locale, Dictionary][] = [];
  const failures: Locale[] = [];
  const languages = createLocaleLoader({
    loaders,
    add: (locale, words) => added.push([locale, words]),
    apply: (locale) => shown.push(locale),
    failed: (locale) => failures.push(locale),
  });
  const current = () => shown.at(-1);
  return { languages, loaders, fetches, added, failures, current };
}

describe('createLocaleLoader', () => {
  it('switches only once the dictionary is in place', async () => {
    const { languages, fetches, added, current } = setup();
    const choice = languages.select('de');
    expect(current()).toBe('en');
    expect(added).toEqual([]);
    fetches[0].resolve();
    expect(await choice).toBe(true);
    expect(added).toEqual([['de', dictionary('Sprache')]]);
    expect(current()).toBe('de');
  });

  it('keeps the shown language and reports a failed load, and tries again on the next choice', async () => {
    const { languages, loaders, fetches, failures, current } = setup();
    const choice = languages.select('de');
    fetches[0].reject(new TypeError('Failed to fetch dynamically imported module'));
    expect(await choice).toBe(false);
    expect(current()).toBe('en');
    expect(failures).toEqual(['de']);
    expect(languages.isLoaded('de')).toBe(false);

    const again = languages.select('de');
    expect(loaders.de).toHaveBeenCalledTimes(2);
    fetches[1].resolve();
    expect(await again).toBe(true);
    expect(current()).toBe('de');
  });

  it('fetches a language once: a second request while it loads shares the fetch, a later one switches at once', async () => {
    const { languages, loaders, fetches, current } = setup();
    const first = languages.select('de');
    const second = languages.load('de');
    expect(loaders.de).toHaveBeenCalledTimes(1);
    fetches[0].resolve();
    await Promise.all([first, second]);
    await languages.select('en');
    expect(current()).toBe('en');
    // Already loaded: the switch happens synchronously, before the promise settles, and nothing is fetched.
    void languages.select('de');
    expect(current()).toBe('de');
    expect(loaders.de).toHaveBeenCalledTimes(1);
  });

  it('applies only the last of overlapping choices, and a superseded failure stays silent', async () => {
    const { languages, fetches, failures, current } = setup();
    const german = languages.select('de');
    const italian = languages.select('it');
    fetches[1].resolve();
    expect(await italian).toBe(true);
    fetches[0].reject(new Error('offline'));
    expect(await german).toBe(false);
    expect(current()).toBe('it');
    expect(failures).toEqual([]);
  });

  it('never lets an older choice whose dictionary arrives later replace the last one (review)', async () => {
    const { languages, fetches, current } = setup();
    const german = languages.select('de');
    const italian = languages.select('it');
    // The older choice arrives first, while the last one still loads: nothing switches yet.
    fetches[0].resolve();
    expect(await german).toBe(false);
    expect(current()).toBe('en');
    fetches[1].resolve();
    expect(await italian).toBe(true);
    expect(current()).toBe('it');
  });

  it('drops a pending choice once a loaded language was chosen after it (review)', async () => {
    const { languages, fetches, current } = setup();
    const german = languages.select('de');
    expect(await languages.select('en')).toBe(true);
    fetches[0].resolve();
    expect(await german).toBe(false);
    expect(current()).toBe('en');
  });

  it('ignores an unknown language and a language without a dictionary', async () => {
    const { languages, failures, current } = setup();
    expect(await languages.select('xx')).toBe(false);
    expect(await languages.select('es')).toBe(false);
    expect(current()).toBe('en');
    expect(failures).toEqual(['es']);
  });

  it('needs no fetch for English', async () => {
    const { languages, loaders, current } = setup();
    expect(await languages.select('en')).toBe(true);
    expect(current()).toBe('en');
    expect(loaders.de).not.toHaveBeenCalled();
  });
});
