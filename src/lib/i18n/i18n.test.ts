import { get } from 'svelte/store';
import { addMessages } from 'svelte-i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dictionaries } from '../../test/dictionaries';
import type { MessageKey } from './messages';
import { icuArguments } from '../../test/icu';
import { errorText, initializeLocale, locale, locales, setLocale, startLocale, translate } from './index';
import { loaders } from './messages';
import { serverMessages } from './server-messages';

const english = dictionaries.en;
const keys = Object.keys(english) as MessageKey[];
const languages = Object.keys(dictionaries) as (keyof typeof dictionaries)[];

describe('language files', () => {
  it('has a dictionary for every language of the menu and no other', async () => {
    expect([...languages].sort()).toEqual([...locales].sort());
  });

  it.each(languages)('%s has the English key set', async (language) => {
    expect(Object.keys(dictionaries[language]).sort()).toEqual([...keys].sort());
  });

  // A plural selector that is not a CLDR category of the language ("uno" for "one") formats without an error but always falls back
  // to `other` ("1 mani"); the formatting test cannot see that (LANG-1 review).
  it.each(languages)('%s uses only plural categories of its language', async (language) => {
    const categories = new Set<string>(new Intl.PluralRules(language).resolvedOptions().pluralCategories);
    const selectors = (message: string) => {
      const found: string[] = [];
      for (const start of message.matchAll(/\{\s*\w+\s*,\s*(?:plural|selectordinal)\s*,/g)) {
        let depth = 1;
        let word = '';
        for (let index = start.index + start[0].length; index < message.length && depth > 0; index++) {
          const char = message[index];
          if (char === '{') {
            if (depth === 1 && word.trim()) found.push(word.trim().split(/\s+/).pop()!);
            depth++;
            word = '';
          } else if (char === '}') {
            depth--;
            word = '';
          } else if (depth === 1) word += char;
        }
      }
      return found;
    };
    const dictionary: Record<string, string> = dictionaries[language];
    const wrong = keys.flatMap((key) =>
      selectors(dictionary[key])
        .filter((selector) => !/^=\d+$/.test(selector) && !/^offset:/.test(selector) && !categories.has(selector))
        .map((selector) => `${key}: ${selector}`),
    );
    expect(selectors(english['combination.coatCount'])).toEqual(['one', 'other']);
    expect(wrong).toEqual([]);
  });

  // The arguments come from the ICU parser, so a renamed plural or select argument and a nested `{name}` count too.
  it.each(languages)('%s has non-empty translations with the English ICU arguments', async (language) => {
    const dictionary: Record<string, string> = dictionaries[language];
    for (const key of keys) {
      const translation = dictionary[key];
      expect(translation.trim(), `Missing ${language} translation: ${key}`).not.toBe('');
      expect(icuArguments(translation), `${language}: ${key}`).toEqual(icuArguments(english[key]));
    }
  });
});

describe('message key usage', () => {
  const sources = import.meta.glob(['/src/**/*.{ts,svelte}', '!/src/**/*.test.ts', '!/src/lib/generated/**'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;
  const code = Object.values(sources).join('\n');
  const literals = new Set([...code.matchAll(/'([^'\n]+)'/g)].map((match) => match[1]));

  it('uses every key in en.json', async () => {
    expect(keys.filter((key) => !literals.has(key))).toEqual([]);
  });

  it('defines every key passed to $t, translate or notify', async () => {
    const used = [...code.matchAll(/(?:\$t|translate|notify)\(\s*'([^']+)'/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(100);
    expect(used.filter((key) => !Object.hasOwn(english, key))).toEqual([]);
  });

  // axe's label-content-name-mismatch (frontend guide "Accessibility"): a control named by `aria-label` whose only content is
  // a text must have that text in its name, in every language. The pairs are read from the markup: `aria-label={$t('A', …)}` on a
  // tag whose content is just `{$t('B', …)}`; placeholders are filled with the same sample in both.
  it('puts the visible text into the accessible name of every labelled control, in every language', async () => {
    const pairs: [string, string, string][] = [];
    for (const [file, text] of Object.entries(sources)) {
      if (!file.endsWith('.svelte')) continue;
      for (const match of text.matchAll(/aria-label=\{\$t\('([\w.]+)'/g)) {
        let depth = 0;
        let end = match.index;
        for (; end < text.length; end++) {
          if (text[end] === '{') depth++;
          else if (text[end] === '}') depth--;
          else if (text[end] === '>' && depth === 0) break;
        }
        // The content's own `$t` may pass values (`{ values: { name } }`): its arguments end at the `)}` before the closing tag.
        const content = /^>\s*\{\$t\('([\w.]+)'(?:,[^<]*?)?\)\}\s*<\//.exec(text.slice(end));
        if (content) pairs.push([file, match[1], content[1]]);
      }
    }
    expect(pairs.length).toBeGreaterThan(10);
    const sample = (message: string) =>
      message
        .replace(/\{(\w+)\}/g, (_, name: string) => `«${name}»`)
        .replace(/\s+/g, ' ')
        .toLowerCase();
    const mismatches = pairs.flatMap(([file, label, visible]) =>
      languages
        .filter((language) => {
          const dictionary: Record<string, string> = dictionaries[language];
          return !sample(dictionary[label]).includes(sample(dictionary[visible]));
        })
        .map((language) => `${language} ${file}: ${label} does not contain ${visible}`),
    );
    expect(mismatches).toEqual([]);
  });

  it('maps known server messages to existing keys', async () => {
    for (const key of Object.values(serverMessages)) expect(keys).toContain(key);
  });
});

describe('wording', () => {
  // British English, one vocabulary (UX-33, UX-44): no US spellings, no "backend", typographic
  // ellipses, and no arrows or full-width plus signs on buttons, in any language.
  it.each(languages)('%s has no arrows, full-width plus signs or three dots', async (language) => {
    const dictionary: Record<string, string> = dictionaries[language];
    for (const key of keys) expect(dictionary[key], `${language}: ${key}`).not.toMatch(/→|＋|\.\.\./);
  });

  it('uses British spelling and the shared vocabulary in English', async () => {
    for (const key of keys) expect(english[key], key).not.toMatch(/favorite|\bcolor|backend|\bapplication/i);
  });

  // The API ends a sign-in 30 days after its last use and a year after it began (backend `glazelab.session.*`), as the terms say.
  it.each([
    ['en', /30 days/, /a year/],
    ['de', /30 Tage/, /einem Jahr/],
    ['pt-PT', /30 dias/, /um ano/],
    ['it', /30 giorni/, /un anno/],
    ['es', /30 días/, /un año/],
  ] as const)('%s names both sign-in limits on the account page', async (language, idle, absolute) => {
    const body = dictionaries[language]['account.page.session.body'];
    expect(body).toMatch(idle);
    expect(body).toMatch(absolute);
  });

  // A tone rewrite keeps the substance of the terms (TERMS-1 review): the service is offered "as
  // available", never also "as is".
  it.each([
    ['en', /provided as available/, /as it is|as is\b/],
    ['de', /nach Verfügbarkeit/, /so, wie es ist/],
    ['pt-PT', /conforme a disponibilidade/, /tal como está/],
    ['it', /in base alla disponibilità/, /così com'è/],
    ['es', /según su disponibilidad/, /tal como está/],
  ] as const)('%s offers the service as available, not as is', async (language, asAvailable, asIs) => {
    const hobby = dictionaries[language]['terms.section.hobby.body'];
    expect(hobby).toMatch(asAvailable);
    expect(hobby).not.toMatch(asIs);
  });

  // Every translation says that the English text binds (LANG-1, glossary), in a legal word.
  it.each([
    ['en', /binding/],
    ['de', /Maßgeblich|Verbindlich/],
    ['pt-PT', /vinculativa/],
    ['it', /Fa fede|vincolante/],
    ['es', /vinculante/],
  ] as const)('%s names the English terms binding', async (language, binding) => {
    expect(dictionaries[language]['terms.translationNote']).toMatch(binding);
  });
});

describe('svelte-i18n formatting', () => {
  it.each(languages)('%s formats every message without leftover ICU syntax', async (language) => {
    await setLocale(language);
    for (const key of keys) {
      const result = translate(key, {
        values: {
          query: 'rutile',
          type: 'Glazes',
          view: 'All',
          filters: 'Cone 6',
          shown: 2,
          hidden: 3,
          current: 1,
          kind: 'Test tile',
          total: 3,
          count: 2,
          title: 'Test <&>',
          step: 'Put glazes on your shelf',
          description: 'Test tile of Test <&>',
          email: 'test@example.test',
          name: 'Ana',
          version: '2026-10-27',
          code: 'Amaco PC-20',
          max: 20,
          min: 8,
          days: 30,
          reports: 3,
          build: '0.1.0 (abc1234)',
          browser: 'Chrome',
          os: 'Android',
          tag: 'satin-matte',
          barcode: '4006381333931',
          glaze: 'Amaco PC-20 Blue Rutile',
          club: 'Sunday Clay Studio',
          clubs: 'Sunday Clay Studio and Kiln',
          more: 2,
          admins: 'Ada Lovelace or Johannes',
          quantity: '1,000',
          amount: '400 g',
          shelves: 'Your shelf and Sunday Clay Studio',
          have: 2,
          number: 2,
          glazes: 'Amaco PC-20 and Mayco SW-118',
          parts: '450 g · Sunday Clay Studio: 1,500 g',
          cone: '04',
          date: '14 Oct 2026',
          temperature: 1222,
          value: 'Cone 6',
          done: 2,
          failed: 1,
          position: 2,
          reason: 'Choose an image file.',
          from: 'Bleu',
          names: 'Ada and Ben',
          link: 'https://glazelab.eu/#/combinations/c1',
          groups: 'Ada has Mayco SW-155',
          to: 'Blue',
          size: 25,
          percent: 40,
          seconds: '3.1',
          zoom: 150,
          x: 40,
          y: 60,
          others: 2,
        },
      });
      expect(typeof result).toBe('string');
      expect(result, `Unformatted ICU message: ${language}: ${key}`).not.toContain('{');
    }
  });

  it('interpolates values and selects German plurals', async () => {
    await setLocale('de');
    expect(translate('images.alt.tile', { values: { title: 'Test <&>' } })).toBe('Testfliese von Test <&>');
    const steps = 'combination.stepCount';
    expect(translate(steps, { values: { count: 1 } })).toBe('1 Schritt');
    expect(translate(steps, { values: { count: 2 } })).toBe('2 Schritte');
  });

  it('words a club card’s counts in the singular and the plural of every language', async () => {
    const forms = (key: Parameters<typeof translate>[0], count: number) => translate(key, { values: { count } });
    await setLocale('en');
    expect(forms('clubs.card.glazes', 1)).toBe('1 glaze on the shelf');
    expect(forms('clubs.card.glazes', 60)).toBe('60 glazes on the shelf');
    expect(forms('clubs.card.combinations', 1)).toBe('1 combination');
    await setLocale('de');
    expect(forms('clubs.card.glazes', 1)).toBe('1 Glasur im Regal');
    expect(forms('clubs.card.glazes', 60)).toBe('60 Glasuren im Regal');
    expect(forms('clubs.card.combinations', 9)).toBe('9 Kombinationen');
    await setLocale('pt-PT');
    expect(forms('clubs.card.glazes', 1)).toBe('1 vidrado na prateleira');
    expect(forms('clubs.card.glazes', 60)).toBe('60 vidrados na prateleira');
    expect(forms('clubs.card.combinations', 9)).toBe('9 combinações');
    await setLocale('it');
    expect(forms('clubs.card.glazes', 1)).toBe('1 smalto sullo scaffale');
    expect(forms('clubs.card.glazes', 60)).toBe('60 smalti sullo scaffale');
    expect(forms('clubs.card.combinations', 9)).toBe('9 combinazioni');
    await setLocale('es');
    expect(forms('clubs.card.glazes', 1)).toBe('1 esmalte en el estante');
    expect(forms('clubs.card.glazes', 60)).toBe('60 esmaltes en el estante');
    // Spanish and Italian have a "many" plural category for millions; the messages fall back to "other" for it.
    expect(forms('clubs.card.combinations', 1000000)).toBe('1.000.000 combinaciones');
  });

  it('counts the library in every language, one combination included, with the locale’s digit grouping', async () => {
    const progress = 'route.loadingProgress';
    await setLocale('en');
    expect(translate(progress, { values: { done: 0, total: 1 } })).toBe('Loading the library: 0 of 1 combination');
    expect(translate(progress, { values: { done: 1000, total: 1834 } })).toBe('Loading the library: 1,000 of 1,834 combinations');
    await setLocale('de');
    expect(translate(progress, { values: { done: 0, total: 1 } })).toBe('Bibliothek wird geladen: 0 von 1 Kombination');
    expect(translate(progress, { values: { done: 1000, total: 1834 } })).toBe('Bibliothek wird geladen: 1.000 von 1.834 Kombinationen');
    await setLocale('pt-PT');
    expect(translate(progress, { values: { done: 0, total: 1 } })).toBe('A carregar a biblioteca: 0 de 1 combinação');
    expect(translate(progress, { values: { done: 0, total: 2 } })).toBe('A carregar a biblioteca: 0 de 2 combinações');
    await setLocale('it');
    expect(translate(progress, { values: { done: 0, total: 1 } })).toBe('Caricamento della libreria: 0 di 1 combinazione');
    // Italian and Spanish group digits only from five digits on (CLDR minimum grouping digits 2), like Portuguese.
    expect(translate(progress, { values: { done: 1000, total: 18340 } })).toBe('Caricamento della libreria: 1000 di 18.340 combinazioni');
    await setLocale('es');
    expect(translate(progress, { values: { done: 0, total: 1 } })).toBe('Cargando la biblioteca: 0 de 1 combinación');
    expect(translate(progress, { values: { done: 1000, total: 18340 } })).toBe('Cargando la biblioteca: 1000 de 18.340 combinaciones');
  });

  it('words the activity badge and its news button in the singular, the plural and at the cap of every language', async () => {
    const forms = async (language: (typeof languages)[number], count: number) => {
      await setLocale(language);
      return [translate('feed.openUnread', { values: { count } }), translate('feed.showNew', { values: { count } })];
    };
    expect(await forms('en', 1)).toEqual(['Activity: 1 new', '1 new: show']);
    expect(await forms('en', 100)).toEqual(['Activity: 99+ new', '99+ new: show']);
    expect(await forms('de', 1)).toEqual(['Aktivität: 1 neu', '1 neu: anzeigen']);
    expect(await forms('de', 7)).toEqual(['Aktivität: 7 neu', '7 neu: anzeigen']);
    expect(await forms('pt-PT', 1)).toEqual(['Atividade: 1 nova', '1 nova: mostrar']);
    expect(await forms('pt-PT', 7)).toEqual(['Atividade: 7 novas', '7 novas: mostrar']);
    expect(await forms('pt-PT', 100)).toEqual(['Atividade: 99+ novas', '99+ novas: mostrar']);
    expect(await forms('it', 1)).toEqual(['Attività: 1 nuova', '1 nuova: mostra']);
    expect(await forms('it', 7)).toEqual(['Attività: 7 nuove', '7 nuove: mostra']);
    expect(await forms('es', 1)).toEqual(['Actividad: 1 nueva', '1 nueva: mostrar']);
    expect(await forms('es', 100)).toEqual(['Actividad: 99+ nuevas', '99+ nuevas: mostrar']);
  });

  it('words who has a glaze in every language, singular and plural, with the possessive only in English', async () => {
    const group = 'buddies.shelf.group';
    const sample = { names: 'Ada', glazes: 'Mayco SW-155' };
    await setLocale('en');
    expect(translate(group, { values: { ...sample, count: 1 } })).toBe('Ada has Mayco SW-155');
    expect(translate(group, { values: { ...sample, names: 'Ada and Ben', count: 2 } })).toBe('Ada and Ben have Mayco SW-155');
    expect(translate('buddies.shelf.atName', { values: { name: 'Ada' } })).toBe("Ada's");
    expect(translate('buddies.shelf.atNames', { values: { names: "Ada's and Ben's" } })).toBe("At Ada's and Ben's");
    expect(translate('buddies.shelf.atCount', { values: { count: 4 } })).toBe('At 4 buddies');
    await setLocale('de');
    expect(translate(group, { values: { ...sample, count: 1 } })).toBe('Ada hat Mayco SW-155');
    expect(translate(group, { values: { ...sample, names: 'Ada und Ben', count: 2 } })).toBe('Ada und Ben haben Mayco SW-155');
    expect(translate('buddies.shelf.atNames', { values: { names: 'Ada und Ben' } })).toBe('Bei Ada und Ben');
    await setLocale('pt-PT');
    expect(translate(group, { values: { ...sample, count: 1 } })).toBe('Ada tem Mayco SW-155');
    expect(translate(group, { values: { ...sample, names: 'Ada e Ben', count: 2 } })).toBe('Ada e Ben têm Mayco SW-155');
    expect(translate('buddies.shelf.atCount', { values: { count: 1 } })).toBe('Com 1 parceiro');
  });

  it('words the plain glaze ask in every language without a title or link', async () => {
    const values = { name: 'Ada', glaze: 'Mayco SW-155 Winter Wood', title: '', link: '' };
    await setLocale('en');
    expect(translate('buddies.shelf.messageGlaze', { values })).toBe('Hi Ada, could I borrow some Mayco SW-155 Winter Wood?');
    await setLocale('de');
    expect(translate('buddies.shelf.messageGlaze', { values })).toBe('Hallo Ada, könnte ich etwas Mayco SW-155 Winter Wood ausleihen?');
    await setLocale('pt-PT');
    expect(translate('buddies.shelf.messageGlaze', { values })).toBe('Olá, Ada! Seria possível emprestar-me um pouco de Mayco SW-155 Winter Wood?');
  });

  it('translates app error keys and known server messages, hiding unknown ones', async () => {
    await setLocale('de');
    const text = get(errorText);
    expect(text('errors.passwordsMismatch')).toBe('Die Passwörter stimmen nicht überein.');
    expect(text('Club admin role required')).toBe('Clubadmin-Rechte erforderlich');
    expect(text('Request failed.')).toBe(translate('errors.requestFailed'));
    expect(text('Please sign in.')).toBe('Bitte melde dich an.');
    expect(text('This changed meanwhile. Please try again.')).toBe('Das hat sich inzwischen geändert. Bitte versuche es erneut.');
    // An unknown message is no form problem (a failed load, Spring's own "Internal Server Error"): it reads as a failed request.
    expect(text('Sign in required')).toBe(translate('errors.requestFailed'));
    expect(text('Some internal detail')).toBe(translate('errors.requestFailed'));
    expect(text('Internal Server Error')).toBe(translate('errors.requestFailed'));
  });

  it('translates manufacturer conflicts and validation errors that name their field', async () => {
    await setLocale('de');
    const text = get(errorText);
    expect(text('This manufacturer ID is already taken.')).toBe(translate('errors.shortIdTaken'));
    expect(text('A manufacturer with this name already exists.')).toBe(translate('errors.manufacturerExists'));
    expect(text('This manufacturer and glaze code already exist in the library.')).toBe(
      'Dieser Hersteller und dieser Glasurcode sind bereits in der Bibliothek vorhanden.',
    );
    expect(text('newManufacturer.shortId: Use a manufacturer ID of 2 to 10 letters or digits, starting with a letter, such as AMACO')).toBe(
      translate('errors.shortIdInvalid'),
    );
    expect(text('code: Use letters and digits for the glaze code, such as PC-20')).toBe(translate('stock.newGlaze.codeHint'));
    expect(text('code: some internal detail')).toBe(translate('errors.invalidForm'));
    expect(text('This barcode already belongs to another glaze.')).toBe('Dieser Barcode gehört schon zu einer anderen Glasur.');
    expect(text('Enter an EAN-13, UPC-A or EAN-8 barcode with a valid check digit.')).toBe(translate('barcodes.invalid'));
  });

  it('translates the missing glaze answer of the photo endpoints in every language', async () => {
    const text = get(errorText);
    for (const [language, expected] of [
      ['en', 'Glaze not found'],
      ['pt-PT', 'Vidrado não encontrado'],
      ['de', 'Glasur nicht gefunden'],
      ['it', 'Smalto non trovato'],
      ['es', 'Esmalte no encontrado'],
    ]) {
      await setLocale(language);
      expect(text('Glaze not found'), language).toBe(expected);
      expect(text('Glaze not found'), language).toBe(translate('errors.glazeNotFound'));
    }
  });

  it('translates every known server message in every language', async () => {
    const text = get(errorText);
    for (const language of languages) {
      await setLocale(language);
      for (const [message, key] of Object.entries(serverMessages)) {
        expect(text(message), `${language}: ${message}`).toBe(dictionaries[language][key]);
        expect(text(message), `${language}: ${message}`).not.toBe('');
      }
    }
    await setLocale('it');
    expect(text('Club admin role required')).toBe('Serve il ruolo di admin del club');
    await setLocale('es');
    expect(text('Please sign in.')).toBe('Inicia sesión.');
  });

  it('accepts Italian and Spanish as preferences', async () => {
    await setLocale('it');
    expect(get(locale)).toBe('it');
    await setLocale('es');
    expect(get(locale)).toBe('es');
  });

  it('ignores an unsupported locale preference', async () => {
    await setLocale('de');
    await setLocale('unsupported');
    expect(get(locale)).toBe('de');
  });
});

describe('lazily loaded languages (LANG-2)', () => {
  const saved = (value: string | null) => {
    const store = new Map<string, string>(value ? [['glazelab:locale', value]] : []);
    vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, text: string) => store.set(key, text) });
    return store;
  };
  afterEach(async () => {
    vi.unstubAllGlobals();
    await setLocale('en');
  });

  it('has a chunk loader for every language but English, which is in the bundle', () => {
    expect(Object.keys(loaders).sort()).toEqual(locales.filter((value) => value !== 'en').sort());
  });

  it('starts in the saved language, with its dictionary loaded before the start resolves', async () => {
    saved('it');
    await startLocale();
    expect(get(locale)).toBe('it');
    expect(translate('language.label')).toBe(dictionaries.it['language.label']);
  });

  it('starts in English without a saved language or with an unknown one, and keeps the unknown preference untouched', async () => {
    saved(null);
    await startLocale();
    expect(get(locale)).toBe('en');
    const store = saved('xx');
    await startLocale();
    expect(get(locale)).toBe('en');
    expect(store.get('glazelab:locale')).toBe('xx');
  });

  it('remembers a chosen language only once it is shown', async () => {
    const store = saved(null);
    expect(await setLocale('es')).toBe(true);
    expect(store.get('glazelab:locale')).toBe('es');
    expect(await setLocale('unsupported')).toBe(false);
    expect(store.get('glazelab:locale')).toBe('es');
  });

  it('keeps the document language in step with the shown one, for every language', async () => {
    const root = { lang: '' };
    vi.stubGlobal('document', { documentElement: root });
    const stop = initializeLocale();
    try {
      expect(root.lang).toBe('en');
      for (const language of [...locales].reverse()) {
        await setLocale(language);
        expect(root.lang).toBe(language);
      }
    } finally {
      stop();
    }
  });

  it('shows the English text for a key a language lacks', () => {
    addMessages('zz', { 'common.close': 'Zu' });
    locale.set('zz');
    expect(translate('common.close')).toBe('Zu');
    expect(translate('language.label')).toBe(english['language.label']);
  });
});
