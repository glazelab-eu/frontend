import { describe, expect, it } from 'vitest';
import type { Buddies, BuddyGlaze, BuddyName } from '../api/models';
import { glazeStep } from '../../test/fixtures';
import {
  MARK_NAMES_MAX,
  SUMMARY_NAMES_MAX,
  askLink,
  askMessageKey,
  availabilityDate,
  availabilityDay,
  buddyCover,
  buddyHolders,
  emptyAvailability,
  groupCover,
  markNames,
  ofAcceptedBuddies,
  summaryNames,
  withBuddyGlazes,
} from './buddy-shelf';

const name = (id: string, displayName: string): BuddyName => ({ id, displayName });
const ada = name('u2', 'Ada');
const ben = name('u3', 'Ben');
const cy = name('u4', 'Cy');
const accepted = (...list: BuddyName[]): Pick<Buddies, 'buddies'> => ({
  buddies: list.map((buddy) => ({ ...buddy, since: '2026-10-31T10:00:00Z', avatarId: null })),
});
const entry = (glazeId: string, ...buddies: BuddyName[]): BuddyGlaze => ({ glazeId, buddies });

describe('buddyHolders', () => {
  it('lists the accepted buddies of each glaze by name in the given language', () => {
    const holders = buddyHolders({ glazes: [entry('g1', cy, name('u5', 'Äsop'), ada)] }, accepted(ada, cy, name('u5', 'Äsop')), new Intl.Collator('de'));
    expect(holders.get('g1')?.map((buddy) => buddy.displayName)).toEqual(['Ada', 'Äsop', 'Cy']);
  });

  it('drops anybody the loaded lists do not call an accepted buddy (a removed buddy stops showing at once)', () => {
    const holders = buddyHolders({ glazes: [entry('g1', ada, ben), entry('g2', ben)] }, accepted(ada));
    expect(holders.get('g1')).toEqual([ada]);
    expect(holders.has('g2')).toBe(false);
  });

  it('counts a buddy listed twice once, and leaves out a glaze nobody holds', () => {
    const holders = buddyHolders({ glazes: [entry('g1', ada, ada), entry('g2')] }, accepted(ada));
    expect(holders.get('g1')).toEqual([ada]);
    expect([...holders.keys()]).toEqual(['g1']);
  });

  it('orders equal names by ID', () => {
    const same = [name('b', 'Sam'), name('a', 'Sam')];
    expect(
      buddyHolders({ glazes: [entry('g1', ...same)] }, accepted(...same))
        .get('g1')
        ?.map((buddy) => buddy.id),
    ).toEqual(['a', 'b']);
  });

  it('is empty without availability, and without buddies', () => {
    expect(buddyHolders(emptyAvailability(), accepted(ada)).size).toBe(0);
    expect(buddyHolders({ glazes: [entry('g1', ada)] }, accepted()).size).toBe(0);
  });
});

describe('ofAcceptedBuddies', () => {
  it('keeps no name or glaze of anybody who is no longer an accepted buddy', () => {
    const read = { glazes: [entry('g1', ada, ben), entry('g2', ben)], asOf: 5 };
    expect(ofAcceptedBuddies(read, accepted(ada))).toEqual({ glazes: [entry('g1', ada)], asOf: 5 });
    expect(ofAcceptedBuddies(read, accepted())).toEqual({ glazes: [], asOf: 5 });
  });

  it('answers the same object when everybody is still a buddy', () => {
    const read = { glazes: [entry('g1', ada, ben)], asOf: 5 };
    expect(ofAcceptedBuddies(read, accepted(ada, ben))).toBe(read);
  });
});

describe('withBuddyGlazes', () => {
  it("adds the buddies' glazes to the shelf's without changing the shelf", () => {
    const owned = new Set(['g1']);
    const all = withBuddyGlazes(owned, new Map([['g2', [ada]]]));
    expect([...all].sort()).toEqual(['g1', 'g2']);
    expect([...owned]).toEqual(['g1']);
  });
});

describe('buddyCover', () => {
  const steps = [glazeStep({ glazeId: 'g1' }), glazeStep({ glazeId: 'g2' }), glazeStep({ glazeId: 'g3' })];
  const holders = new Map([
    ['g3', [ada]],
    ['g1', [ada, ben]],
  ]);

  it('keeps the missing glazes buddies have, in step order, with who has them', () => {
    expect(buddyCover(steps, holders).map(({ step, buddies }) => [step.glazeId, buddies])).toEqual([
      ['g1', [ada, ben]],
      ['g3', [ada]],
    ]);
  });

  it('covers nothing when no missing glaze is held, and only the glazes given', () => {
    expect(buddyCover([steps[1]], holders)).toEqual([]);
    expect(buddyCover([], holders)).toEqual([]);
  });
});

describe('groupCover', () => {
  it('groups the glazes by the same set of buddies, in the order of the first glaze', () => {
    const s1 = glazeStep({ glazeId: 'g1' });
    const s2 = glazeStep({ glazeId: 'g2' });
    const s3 = glazeStep({ glazeId: 'g3' });
    const groups = groupCover([
      { step: s1, buddies: [ada] },
      { step: s2, buddies: [ben] },
      { step: s3, buddies: [ada] },
    ]);
    expect(groups.map((group) => [group.buddies.map((buddy) => buddy.displayName), group.steps.map((step) => step.glazeId)])).toEqual([
      [['Ada'], ['g1', 'g3']],
      [['Ben'], ['g2']],
    ]);
  });

  it('keeps Ada alone and Ada with Ben apart', () => {
    const groups = groupCover([
      { step: glazeStep({ glazeId: 'g1' }), buddies: [ada] },
      { step: glazeStep({ glazeId: 'g2' }), buddies: [ada, ben] },
    ]);
    expect(groups).toHaveLength(2);
  });
});

describe('names in a mark and in a sentence', () => {
  const many = (count: number) => Array.from({ length: count }, (_, index) => name(`u${index}`, `Name ${index}`));

  it('names up to three buddies in a mark and counts beyond, never the number alone (the names go to the details)', () => {
    expect(MARK_NAMES_MAX).toBe(3);
    expect(markNames(many(1))).toBe('names');
    expect(markNames(many(3))).toBe('names');
    expect(markNames(many(4))).toBe('count');
  });

  it('lists up to three names in a sentence, then two and the number of the others', () => {
    expect(SUMMARY_NAMES_MAX).toBe(3);
    expect(summaryNames(many(3))).toEqual({ names: ['Name 0', 'Name 1', 'Name 2'], more: 0 });
    expect(summaryNames(many(4))).toEqual({ names: ['Name 0', 'Name 1'], more: 2 });
    expect(summaryNames(many(7))).toEqual({ names: ['Name 0', 'Name 1'], more: 5 });
  });
});

describe('askLink', () => {
  const link = 'https://glazelab.eu/#/combinations/c1';

  it('carries the link of a published combination', () => {
    expect(askLink({ draft: false }, link)).toBe(link);
    expect(askLink({}, link)).toBe(link);
  });

  it('carries none for a draft, which only its author can open', () => {
    expect(askLink({ draft: true }, link)).toBeNull();
  });
});

describe('availability time', () => {
  it('has no day and no date before it was read, and a fresh empty value each time', () => {
    expect(availabilityDay(emptyAvailability())).toBeNull();
    expect(availabilityDate(emptyAvailability(), 'en')).toBeUndefined();
    const first = emptyAvailability();
    first.glazes.push(entry('g1', ada));
    expect(emptyAvailability().glazes).toEqual([]);
  });

  it('counts the day in UTC and words the date in the language', () => {
    const asOf = Date.UTC(2026, 9, 31, 23, 59);
    expect(availabilityDay({ asOf })).toBe(availabilityDay({ asOf: Date.UTC(2026, 9, 31, 0, 0) }));
    expect(availabilityDay({ asOf })).not.toBe(availabilityDay({ asOf: Date.UTC(2026, 10, 1, 0, 0) }));
    expect(availabilityDate({ asOf: Date.UTC(2026, 9, 31, 12) }, 'en')).toMatch(/Oct.*2026|2026.*Oct/);
    expect(availabilityDate({ asOf: Date.UTC(2026, 9, 31, 12) }, 'de')).toMatch(/Okt|31\.10/);
  });
});

describe('askMessageKey', () => {
  it('names the combination with its link, or by its title alone for a draft', () => {
    expect(askMessageKey('Celadon', 'https://x/#/c/1')).toBe('buddies.shelf.message');
    expect(askMessageKey('Celadon', null)).toBe('buddies.shelf.messageNoLink');
  });

  it('names the glaze alone, never with a link, where there is no combination (the glaze page)', () => {
    expect(askMessageKey(null, null)).toBe('buddies.shelf.messageGlaze');
    expect(askMessageKey(null, 'https://x/')).toBe('buddies.shelf.messageGlaze');
    expect(askMessageKey('', null)).toBe('buddies.shelf.messageNoLink');
  });
});
