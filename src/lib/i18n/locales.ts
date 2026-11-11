/** Every language of the app, in the language menu's order: English first, then by its own name. */
export const locales = ['en', 'de', 'es', 'it', 'pt-PT'] as const;
export type Locale = (typeof locales)[number];
