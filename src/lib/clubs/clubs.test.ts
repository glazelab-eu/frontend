import { describe, expect, it } from 'vitest';
import { club, clubMember, combination, stockItem } from '../../test/fixtures';
import {
  RULES_FOLD_CHARS,
  RULES_FOLD_LINES,
  clubAdmins,
  clubSummary,
  isLastAdmin,
  leaveRefusal,
  memberCombinations,
  orderedMembers,
  rulesFold,
  sortedClubs,
  stockAdder,
} from './clubs';

const ana = clubMember({ id: 'u1', role: 'ADMIN' });
const bo = clubMember({ id: 'u2', displayName: 'Bo' });
const ids = (list: { id: string }[]) => list.map((item) => item.id);

describe('memberCombinations', () => {
  it('lists published combinations of current members, newest published first', () => {
    const older = combination({ id: 'a', authorId: 'u1', createdAt: '2026-10-01T00:00:00Z' });
    const newer = combination({ id: 'b', authorId: 'u2', createdAt: '2026-10-02T00:00:00Z' });
    const republished = combination({ id: 'c', authorId: 'u1', createdAt: '2026-09-01T00:00:00Z', publishedAt: '2026-10-05T00:00:00Z' });
    expect(ids(memberCombinations([older, newer, republished], [ana, bo]))).toEqual(['c', 'b', 'a']);
  });

  it('leaves out drafts, former members, accounts without an author and other clubs', () => {
    const list = [
      combination({ id: 'own', authorId: 'u1' }),
      combination({ id: 'draft', authorId: 'u1', draft: true, own: true }),
      combination({ id: 'former', authorId: 'u9' }),
      combination({ id: 'deleted', authorId: null, author: null }),
    ];
    expect(ids(memberCombinations(list, [ana, bo]))).toEqual(['own']);
  });

  it('is empty without members or combinations and does not change its input', () => {
    const list = [combination({ id: 'x', authorId: 'u1' })];
    expect(memberCombinations(list, [])).toEqual([]);
    expect(memberCombinations([], [ana])).toEqual([]);
    const input = [combination({ id: 'old', authorId: 'u1', createdAt: '2026-01-01T00:00:00Z' }), combination({ id: 'new', authorId: 'u1' })];
    memberCombinations(input, [ana]);
    expect(ids(input)).toEqual(['old', 'new']);
  });

  it('counts a member who left the list as former on the next list (a stale one still shows them)', () => {
    const list = [combination({ id: 'x', authorId: 'u2' })];
    expect(ids(memberCombinations(list, [ana, bo]))).toEqual(['x']);
    expect(memberCombinations(list, [ana])).toEqual([]);
  });
});

describe('isLastAdmin', () => {
  const cy = clubMember({ id: 'u3', role: 'ADMIN' });

  it.each([
    ['is true for the only admin', [ana, bo], ana, true],
    ['is false while another admin exists, for the admin demoting themselves', [ana, bo, cy], ana, false],
    ['is false while another admin exists, for the other admin', [ana, bo, cy], cy, false],
    ['is false for a member, whatever the admins are', [ana, bo], bo, false],
    ['is false for a member of a club without admins', [bo], bo, false],
  ])('%s', (_case, members, member, expected) => {
    expect(isLastAdmin(members, member)).toBe(expected);
  });

  it('follows the list it is given, so a stale list can be wrong and the server decides', () => {
    expect(isLastAdmin([ana, cy], ana)).toBe(false);
    expect(isLastAdmin([ana], ana)).toBe(true);
  });
});

describe('leaveRefusal', () => {
  it('lets members and an admin with a co-admin leave', () => {
    expect(leaveRefusal([ana, bo], 'u2')).toBeNull();
    expect(leaveRefusal([ana, bo, clubMember({ id: 'u3', role: 'ADMIN' })], 'u1')).toBeNull();
  });

  it('keeps the only admin and the only member, who would leave the club without an admin', () => {
    expect(leaveRefusal([ana, bo], 'u1')).toBe('lastAdmin');
    expect(leaveRefusal([ana], 'u1')).toBe('onlyMember');
  });

  it('leaves the decision to the server without a loaded list or when the account is not in it', () => {
    expect(leaveRefusal(undefined, 'u1')).toBeNull();
    expect(leaveRefusal([bo], 'u1')).toBeNull();
  });
});

describe('stockAdder', () => {
  const entry = stockItem({ clubId: 'k1', userId: null, addedById: 'u2' });

  it('names a current member, or the account itself', () => {
    expect(stockAdder(entry, [ana, bo], 'u1')).toEqual({ name: 'Bo' });
    expect(stockAdder(entry, [ana, bo], 'u2')).toEqual({ you: true });
  });

  it('names nobody for personal stock, an adder who left and an unloaded member list', () => {
    expect(stockAdder(stockItem({ addedById: null }), [ana], 'u1')).toBeNull();
    expect(stockAdder({ ...entry, addedById: null }, [ana, bo], 'u1')).toBeNull();
    expect(stockAdder({ ...entry, addedById: 'u9' }, [ana, bo], 'u1')).toBeNull();
    expect(stockAdder(entry, undefined, 'u1')).toBeNull();
  });
});

describe('rulesFold', () => {
  it('leaves short rules whole, also at exactly the limits', () => {
    expect(rulesFold('')).toEqual({ shown: '', folded: false });
    expect(rulesFold('Wipe the base.\nLabel the tile.')).toEqual({ shown: 'Wipe the base.\nLabel the tile.', folded: false });
    const atChars = 'a'.repeat(RULES_FOLD_CHARS);
    expect(rulesFold(atChars)).toEqual({ shown: atChars, folded: false });
    const atLines = Array.from({ length: RULES_FOLD_LINES }, (_, index) => `rule ${index}`).join('\n');
    expect(rulesFold(atLines).folded).toBe(false);
  });

  it('folds more than the line limit at a line end, whatever the length', () => {
    const lines = Array.from({ length: RULES_FOLD_LINES + 3 }, (_, index) => `rule ${index}`);
    const { shown, folded } = rulesFold(lines.join('\n'));
    expect(folded).toBe(true);
    expect(shown).toBe(`${lines.slice(0, RULES_FOLD_LINES).join('\n')}…`);
    // Line breaks of either kind count, and the preview keeps plain ones.
    expect(rulesFold(lines.join('\r\n')).shown).toBe(shown);
  });

  it('folds long text near the character limit at a word, with an ellipsis', () => {
    const words = 'Please clean your tools and wipe the shelf. '.repeat(30).trim();
    const { shown, folded } = rulesFold(words);
    expect(folded).toBe(true);
    expect(shown.endsWith('…')).toBe(true);
    expect(shown.length).toBeLessThanOrEqual(RULES_FOLD_CHARS + 1);
    expect(shown.length).toBeGreaterThan(RULES_FOLD_CHARS * 0.8);
    expect(words.startsWith(shown.slice(0, -1))).toBe(true);
    expect(/\s…$/.test(shown)).toBe(false);
  });

  it('cuts a text without spaces at the limit and never in the middle of a surrogate pair', () => {
    const long = 'x'.repeat(10000);
    expect(rulesFold(long).shown).toBe(`${'x'.repeat(RULES_FOLD_CHARS)}…`);
    const emoji = '😀'.repeat(RULES_FOLD_CHARS);
    const shown = rulesFold(emoji).shown;
    expect(shown.endsWith('…')).toBe(true);
    expect([...shown.slice(0, -1)].every((char) => char === '😀')).toBe(true);
  });

  it('folds at the decided limits: 400 characters and 6 lines', () => {
    expect(rulesFold('a'.repeat(400)).folded).toBe(false);
    expect(rulesFold('a'.repeat(401)).folded).toBe(true);
    expect(rulesFold(Array.from({ length: 6 }, () => 'r').join('\n')).folded).toBe(false);
    expect(rulesFold(Array.from({ length: 7 }, () => 'r').join('\n')).folded).toBe(true);
  });

  it('cuts at the last word break only within the final fifth, and never before a trailing break', () => {
    // A word ends where the cut falls: the cut moves back to the space before it.
    const words = `${'word '.repeat(79)}wordy and more`;
    const atWord = rulesFold(words).shown;
    expect(atWord).toBe(`${'word '.repeat(79).trimEnd()}…`);
    // The only space is near the start: cutting there would hide almost everything, so the limit cuts the word.
    expect(rulesFold(`Hi ${'x'.repeat(500)}`).shown).toBe(`Hi ${'x'.repeat(RULES_FOLD_CHARS - 3)}…`);
    // A blank sixth line (or trailing spaces) never sits before the ellipsis.
    expect(rulesFold('one\ntwo\nthree\nfour\nfive  \n\nseven').shown).toBe('one\ntwo\nthree\nfour\nfive…');
  });

  it('drops a high surrogate that the character limit would cut from its pair', () => {
    // One leading letter puts every pair across an odd offset, so the limit falls between the two halves of one emoji.
    const shown = rulesFold(`a${'😀'.repeat(RULES_FOLD_CHARS)}`).shown;
    expect(shown).toBe(`a${'😀'.repeat((RULES_FOLD_CHARS - 2) / 2)}…`);
  });

  it('combines both limits: six long lines fold by length too', () => {
    const lines = Array.from({ length: 6 }, () => 'y'.repeat(120)).join('\n');
    const { shown, folded } = rulesFold(lines);
    expect(folded).toBe(true);
    expect(shown.length).toBeLessThanOrEqual(RULES_FOLD_CHARS + 1);
  });
});

describe('clubAdmins and orderedMembers', () => {
  const dee = clubMember({ id: 'u3', displayName: 'Åsa', role: 'ADMIN' });
  const cy = clubMember({ id: 'u4', displayName: 'cy' });

  it('names the admins in the given order, and none without a list', () => {
    expect(ids(clubAdmins([bo, ana, cy, dee]))).toEqual(['u1', 'u3']);
    expect(clubAdmins([bo])).toEqual([]);
    expect(clubAdmins(undefined)).toEqual([]);
  });

  it('puts admins first, then sorts by name with the collator, without changing the list', () => {
    const list = [bo, cy, dee, ana];
    expect(ids(orderedMembers(list, new Intl.Collator('en')))).toEqual(['u1', 'u3', 'u2', 'u4']);
    expect(ids(list)).toEqual(['u2', 'u4', 'u3', 'u1']);
  });

  it('puts an admin whose name sorts last before every member', () => {
    const zoe = clubMember({ id: 'z', displayName: 'Zoë', role: 'ADMIN' });
    expect(ids(orderedMembers([bo, zoe, cy], new Intl.Collator('en')))).toEqual(['z', 'u2', 'u4']);
  });

  it('sorts names with the collator, not by code unit (lower case before a later capital, accents beside their letter)', () => {
    const list = ['Fay', 'Émile', 'cy', 'Dee'].map((displayName) => clubMember({ id: displayName, displayName }));
    expect(ids(orderedMembers(list, new Intl.Collator('en')))).toEqual(['cy', 'Dee', 'Émile', 'Fay']);
  });
});

describe('clubSummary', () => {
  const kiln = club({ id: 'c1' });
  const shelf = [
    stockItem({ id: 's1', clubId: 'c1', quantityG: 200 }),
    stockItem({ id: 's2', clubId: 'c1', quantityG: 0 }),
    stockItem({ id: 's3', clubId: 'c1', quantityG: 5 }),
    stockItem({ id: 's4', clubId: 'c2', quantityG: 500 }),
    stockItem({ id: 's5', clubId: null, quantityG: 500 }),
  ];
  const mine = [
    combination({ id: 'a', authorId: 'u1' }),
    combination({ id: 'b', authorId: 'u9' }),
    combination({ id: 'd', authorId: 'u2', draft: true, own: true }),
  ];

  it('counts the members, the glazes in stock on this club shelf and the published combinations of current members', () => {
    expect(clubSummary(kiln, [ana, bo], shelf, mine)).toEqual({ members: 2, glazes: 2, combinations: 1 });
  });

  it('leaves out what the missing member list would decide, and keeps the shelf count', () => {
    expect(clubSummary(kiln, undefined, shelf, mine)).toEqual({ members: undefined, glazes: 2, combinations: undefined });
  });

  it('counts zero for an empty shelf and no combinations, which is not the same as unavailable', () => {
    expect(clubSummary(club({ id: 'c3' }), [clubMember({ id: 'u7' })], shelf, mine)).toEqual({ members: 1, glazes: 0, combinations: 0 });
  });
});

describe('sortedClubs', () => {
  const collator = new Intl.Collator('en');
  it('sorts by name regardless of case, equal names by ID, without changing the input', () => {
    const list = [club({ id: 'z', name: 'bravo' }), club({ id: 'b', name: 'Alpha' }), club({ id: 'a', name: 'alpha' }), club({ id: 'c', name: 'Charlie' })];
    expect(sortedClubs(list, collator).map((entry) => entry.id)).toEqual(['a', 'b', 'z', 'c']);
    expect(list.map((entry) => entry.id)).toEqual(['z', 'b', 'a', 'c']);
  });

  it('keeps clubs of the same name in a stable order whatever the order they come in', () => {
    const one = club({ id: 'a', name: 'Kiln' });
    const two = club({ id: 'b', name: 'Kiln' });
    expect(sortedClubs([two, one], collator).map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(sortedClubs([one, two], collator).map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('uses the locale of the collator', () => {
    const list = [club({ id: '1', name: 'Zebra' }), club({ id: '2', name: 'Äpfel' })];
    expect(sortedClubs(list, new Intl.Collator('de')).map((entry) => entry.id)).toEqual(['2', '1']);
    expect(sortedClubs(list, new Intl.Collator('sv')).map((entry) => entry.id)).toEqual(['1', '2']);
  });
});
