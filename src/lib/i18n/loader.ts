import { locales, type Locale } from './locales';
import type { Dictionary } from './messages';

export const isLocale = (value: unknown): value is Locale => (locales as readonly unknown[]).includes(value);

export interface LocaleLoaderOptions {
  /** English is already in place; the others come from here. */
  loaders: Partial<Record<Locale, () => Promise<{ default: Dictionary }>>>;
  /** Hands a loaded dictionary to the formatter. */
  add: (locale: Locale, dictionary: Dictionary) => void;
  /** Switches the shown language (and remembers it); runs only once its dictionary is in place. */
  apply: (locale: Locale) => void;
  /** A chosen language could not be loaded (offline and never cached, a chunk of an older build): the shown one stays. */
  failed: (locale: Locale, cause: unknown) => void;
}

/**
 * Lazily loaded languages (LANG-2): each dictionary is fetched once, a failed fetch is forgotten so the next choice tries again,
 * and a switch happens only after its dictionary arrived, in one step, so no frame mixes two languages. Of overlapping choices only
 * the last one applies.
 */
export function createLocaleLoader({ loaders, add, apply, failed }: LocaleLoaderOptions) {
  const loaded = new Set<Locale>(['en']);
  const loading = new Map<Locale, Promise<void>>();
  let latest = 0;

  function load(locale: Locale): Promise<void> {
    if (loaded.has(locale)) return Promise.resolve();
    let pending = loading.get(locale);
    if (!pending) {
      const loader = loaders[locale];
      pending = (loader ? loader() : Promise.reject(new Error(`No dictionary for ${locale}`)))
        .then((module) => {
          add(locale, module.default);
          loaded.add(locale);
        })
        .finally(() => loading.delete(locale));
      loading.set(locale, pending);
    }
    return pending;
  }

  /** Answers whether the language is now shown; a loaded one switches synchronously, before the promise settles. */
  async function select(value: unknown): Promise<boolean> {
    if (!isLocale(value)) return false;
    const request = ++latest;
    if (!loaded.has(value)) {
      try {
        await load(value);
      } catch (cause) {
        if (request === latest) failed(value, cause);
        return false;
      }
    }
    if (request !== latest) return false;
    apply(value);
    return true;
  }

  return { load, select, isLoaded: (locale: Locale) => loaded.has(locale) };
}
