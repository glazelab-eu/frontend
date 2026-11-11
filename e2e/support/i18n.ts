import en from '../../src/lib/i18n/en.json' with { type: 'json' };

export type MessageKey = keyof typeof en;
type Values = Record<string, string | number>;

/** The index of the brace that closes the one at `open`. */
function closing(message: string, open: number): number {
  let depth = 0;
  for (let index = open; index < message.length; index++) {
    if (message[index] === '{') depth++;
    else if (message[index] === '}' && --depth === 0) return index;
  }
  throw new Error(`Unbalanced braces in "${message}"`);
}

/** A plural argument's options (`=0 {…} one {…} other {…}`) by selector. */
function pluralOptions(options: string): Map<string, string> {
  const result = new Map<string, string>();
  let index = 0;
  while (index < options.length) {
    const open = options.indexOf('{', index);
    if (open < 0) break;
    const close = closing(options, open);
    result.set(options.slice(index, open).trim(), options.slice(open + 1, close));
    index = close + 1;
  }
  return result;
}

function argument(body: string, values: Values, key: string): string {
  const [name, type, ...rest] = body.split(',');
  const value = values[name.trim()];
  if (value === undefined) throw new Error(`${key} needs a value for {${name.trim()}}`);
  if (type === undefined) return String(value);
  // As the app formats numbers in English (svelte-i18n with the locale `en`).
  if (type.trim() === 'number') return Number(value).toLocaleString('en');
  if (type.trim() !== 'plural') throw new Error(`${key}: only plural and number arguments are supported`);
  const options = pluralOptions(rest.join(','));
  const chosen = options.get(`=${value}`) ?? (value === 1 ? options.get('one') : undefined) ?? options.get('other');
  if (chosen === undefined) throw new Error(`${key} has no plural form for ${value}`);
  // `#` is the number, formatted like a number argument.
  return format(chosen.replaceAll('#', Number(value).toLocaleString('en')), values, key);
}

function format(message: string, values: Values, key: string): string {
  let result = '';
  let index = 0;
  for (let open = message.indexOf('{'); open >= 0; open = message.indexOf('{', index)) {
    const close = closing(message, open);
    result += message.slice(index, open) + argument(message.slice(open + 1, close), values, key);
    index = close + 1;
  }
  return result + message.slice(index);
}

/**
 * A message of any dictionary filled the same way (`one` only for 1: right for the small counts of the specs in all five languages;
 * numbers in English digits, so keep them below 1,000).
 */
export function formatMessage(message: string, values: Values = {}, key = message): string {
  return format(message, values, key);
}

/** The English UI text of a key, so selectors follow the copy: `{name}` placeholders, numbers and English plural forms. */
export function t(key: MessageKey, values: Values = {}): string {
  return format(en[key], values, key);
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Matches a name that starts with this text. */
export function startsWith(text: string): RegExp {
  return new RegExp('^' + escaped(text));
}

/** Matches this text followed by a count, as filter chips are named. */
export function withCount(text: string): RegExp {
  return new RegExp(`^${escaped(text)} \\d+$`);
}
