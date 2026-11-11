import { describe, expect, it } from 'vitest';
import { accountInitial } from './account-initial';

describe('accountInitial', () => {
  it.each([
    ['is the first character of the trimmed name, upper case', '  ada Lovelace', 'A'],
    ['is the first character of the trimmed name, upper case (accented)', 'élodie', 'É'],
    ['keeps an emoji outside the basic plane whole instead of half a surrogate pair', '🌸 Ana', '🌸'],
    ['keeps a letter outside the basic plane whole instead of half a surrogate pair', '𝔄da', '𝔄'],
    ['is empty for a blank name', '   ', ''],
    ['skips a leading bidi control', '\u202Eada', 'A'],
    ['skips leading zero-width and format characters', '\u200B\u2060\uFEFFbo', 'B'],
    ['skips a leading combining mark and an invisible filler', '\u0301\u3164cy', 'C'],
    ['is empty for a name of only invisible characters', '\u200D\u202A', ''],
  ])('%s', (_case, name, initial) => {
    expect(accountInitial(name)).toBe(initial);
  });
});
