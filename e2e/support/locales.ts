import de from '../../src/lib/i18n/de.json' with { type: 'json' };
import en from '../../src/lib/i18n/en.json' with { type: 'json' };
import es from '../../src/lib/i18n/es.json' with { type: 'json' };
import it from '../../src/lib/i18n/it.json' with { type: 'json' };
import ptPT from '../../src/lib/i18n/pt-PT.json' with { type: 'json' };

/** Every dictionary of the app by locale, for specs that run in each language (`t()` reads English only). */
export const dictionaries = { en, de, es, it, 'pt-PT': ptPT };
export type Locale = keyof typeof dictionaries;
/** Every language of the app. */
export const locales = Object.keys(dictionaries) as Locale[];
/** Every language but English. */
export const translated = locales.filter((locale) => locale !== 'en');

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A name in any language: the key's text in every dictionary, `{placeholders}` filled from `values`, from the start of the
 * name (`exact` also to its end). For checks that run once per language without naming it.
 */
export function anyLanguage(key: keyof typeof en, values: Record<string, string> = {}, exact = false): RegExp {
  const texts = locales.map((locale) => escaped(dictionaries[locale][key].replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole)));
  return new RegExp(`^(${texts.join('|')})${exact ? '$' : ''}`);
}
