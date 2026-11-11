import en from '../lib/i18n/en.json';
import de from '../lib/i18n/de.json';
import es from '../lib/i18n/es.json';
import it from '../lib/i18n/it.json';
import pt from '../lib/i18n/pt-PT.json';
import type { Locale } from '../lib/i18n/locales';
import type { Dictionary } from '../lib/i18n/messages';

/** Every dictionary at once, for tests only: the app loads the languages other than English lazily (`lib/i18n/messages.ts`). */
export const dictionaries = { en, de, es, it, 'pt-PT': pt } satisfies Record<Locale, Dictionary>;
