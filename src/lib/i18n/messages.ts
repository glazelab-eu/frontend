import en from './en.json';
import type { Locale } from './locales';

export type MessageKey = keyof typeof en;
export type Dictionary = Record<MessageKey, string>;

/** The fallback, in the main bundle: every key is typed from it and a missing translation shows it. */
export { en };

/**
 * The other languages, one chunk each, loaded when chosen (`loader.ts`); the service worker precaches the chunks, so a saved
 * language starts offline. Never import these files statically outside tests (`src/test/dictionaries.ts`).
 */
export const loaders: Record<Exclude<Locale, 'en'>, () => Promise<{ default: Dictionary }>> = {
  de: () => import('./de.json'),
  es: () => import('./es.json'),
  it: () => import('./it.json'),
  'pt-PT': () => import('./pt-PT.json'),
};
