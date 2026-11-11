import { describe, expect, it } from 'vitest';
import { firstName } from './first-name';

describe('firstName', () => {
  it.each([
    ['is the first of several words', 'Ada Augusta King Lovelace', 'Ada'],
    ['ignores whitespace around and between the words', '   Ada \t  Lovelace  ', 'Ada'],
    ['splits on Unicode whitespace (no-break and ideographic spaces, a line break)', 'Ada Lovelace', 'Ada'],
    ['splits on an ideographic space', '山田　太郎', '山田'],
    ['splits on a line break', 'Ada\nLovelace', 'Ada'],
    ['keeps a single word whole, however long', 'Wolfeschlegelsteinhausenbergerdorff', 'Wolfeschlegelsteinhausenbergerdorff'],
    ['keeps a name without spaces whole', '山田太郎', '山田太郎'],
    ['keeps non-Latin words whole', 'Ёлка Палкина', 'Ёлка'],
    ['keeps an accented word whole', 'Élodie Brûlé', 'Élodie'],
    ['keeps an emoji outside the basic plane whole instead of half a surrogate pair', '🌸 Ana', '🌸'],
    ['keeps a word that starts with an emoji whole', '🌸Ana Silva', '🌸Ana'],
    ['is empty for an empty name', '', ''],
    ['is empty for a name of only whitespace', ' \t 　 ', ''],
  ])('%s', (_case, name, first) => {
    expect(firstName(name)).toBe(first);
  });
});
