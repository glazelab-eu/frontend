import { derived, get, type Readable } from 'svelte/store';
import { addMessages, init, locale, t as format, number } from 'svelte-i18n';
import { en, loaders, type MessageKey } from './messages';
import { serverMessages } from './server-messages';
import { locales, type Locale } from './locales';
import { createLocaleLoader, isLocale } from './loader';

export { locales, isLocale, type Locale };

export type Params = Record<string, string | number>;
type Translate = (key: MessageKey, options?: { values?: Params; locale?: Locale }) => string;

const STORED = 'glazelab:locale';
/** The longest a start waits for the saved language before it shows English (the language follows when it arrives). */
export const START_LIMIT_MS = 4000;

addMessages('en', en);
void init({ fallbackLocale: 'en', initialLocale: 'en' });

// Keep message keys checked by TypeScript; formatting and reactivity belong to svelte-i18n.
export const t: Readable<Translate> = format;
export { locale, number as formatNumber };
export type { MessageKey };
export const translate: Translate = (key, options) => get(t)(key, options);

const failureListeners = new Set<(locale: Locale) => void>();
const languages = createLocaleLoader({
  loaders,
  add: (value, dictionary) => addMessages(value, dictionary),
  apply: (value) => {
    locale.set(value);
    try {
      localStorage.setItem(STORED, value);
    } catch {
      /* Preference storage is optional. */
    }
  },
  failed: (value) => failureListeners.forEach((listener) => listener(value)),
});

/**
 * Shows a language once its dictionary is loaded (at once when it already is) and remembers it. Answers false, keeping the shown
 * language, for an unknown value or a dictionary that could not be loaded (then `onLocaleFailure` listeners hear of it).
 */
export const setLocale = (value: string): Promise<boolean> => languages.select(value);

/** Loads a language's dictionary without switching to it (a `translate(…, { locale })` needs it in place); rejects when it fails. */
export const loadLocale = (value: Locale): Promise<void> => languages.load(value);

/** Reports a language whose dictionary could not be loaded; returns the cleanup. */
export function onLocaleFailure(listener: (locale: Locale) => void): () => void {
  failureListeners.add(listener);
  return () => failureListeners.delete(listener);
}

/**
 * Before the first render (`main.ts`): loads the saved language, so the app starts in it (offline from the service worker's
 * precache). It never rejects and never waits longer than `limit`: a slow or failed load starts in English, and a slow one
 * switches when it arrives. A failure keeps the saved preference, so the next start tries again.
 */
export function startLocale(limit = START_LIMIT_MS): Promise<void> {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORED);
  } catch {
    /* Default to English. */
  }
  if (!saved || saved === 'en' || !isLocale(saved)) return Promise.resolve();
  return new Promise((done) => {
    const timer = setTimeout(done, limit);
    void languages.select(saved).finally(() => {
      clearTimeout(timer);
      done();
    });
  });
}

/** Keeps the document's language in step with the shown one; returns the cleanup. */
export function initializeLocale() {
  return locale.subscribe((value) => {
    document.documentElement.lang = value ?? 'en';
  });
}

export const isMessageKey = (value: string): value is MessageKey => Object.hasOwn(en, value);

const FIELD_PREFIX = /^[\w.]+: /;

/**
 * A known server message, also inside a validation error that names its field ("code: …"). An unknown one names a form problem
 * only when it names a field; anything else (a failed load, a default error body outside the API's handler) is a failed request.
 */
function serverMessage(message: string): MessageKey {
  const known = (text: string) => (Object.hasOwn(serverMessages, text) ? serverMessages[text] : undefined);
  return known(message) ?? known(message.replace(FIELD_PREFIX, '')) ?? (FIELD_PREFIX.test(message) ? 'errors.invalidForm' : 'errors.requestFailed');
}

/** Translates an error: a message key set by the app, or a server message. */
export const errorText = derived(t, (format) => (message: string) => format(isMessageKey(message) ? message : serverMessage(message)));
