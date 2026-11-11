import { describe, expect, it } from 'vitest';
import type { Buddies, Buddy } from '../api/models';
import { buddyRelation, emptyBuddies, orderedBuddies, requestCount, requestOffer, type BuddyRelation } from './buddies';

const buddy = (id: string, displayName: string): Buddy => ({ id, displayName, since: '2026-10-31T10:00:00Z', avatarId: null });
const lists: Buddies = {
  buddies: [buddy('b1', 'Bo')],
  incoming: [buddy('i1', 'Ina'), buddy('i2', 'Ivo')],
  outgoing: [buddy('o1', 'Oda')],
  hasLink: true,
};

describe('emptyBuddies', () => {
  it('has nothing and answers fresh lists each time', () => {
    expect(emptyBuddies()).toEqual({ buddies: [], incoming: [], outgoing: [], hasLink: false });
    const first = emptyBuddies();
    first.buddies.push(buddy('x', 'X'));
    expect(emptyBuddies().buddies).toEqual([]);
  });
});

describe('buddyRelation', () => {
  it.each([
    ['u1', 'SELF'],
    ['b1', 'BUDDIES'],
    ['i2', 'INCOMING'],
    ['o1', 'OUTGOING'],
    ['z9', 'NONE'],
  ] as [string, BuddyRelation][])('reads %s as %s', (userId, relation) => {
    expect(buddyRelation(lists, userId, 'u1')).toBe(relation);
  });
});

describe('orderedBuddies', () => {
  it('sorts by name in the given locale and keeps equal names in ID order', () => {
    const collator = new Intl.Collator('de');
    const sorted = orderedBuddies([buddy('2', 'Zoe'), buddy('9', 'Äsop'), buddy('3', 'Ada'), buddy('1', 'Ada')], collator);
    expect(sorted.map((entry) => `${entry.displayName}:${entry.id}`)).toEqual(['Ada:1', 'Ada:3', 'Äsop:9', 'Zoe:2']);
  });

  it('does not change the list it is given', () => {
    const given = [buddy('2', 'Zoe'), buddy('1', 'Ada')];
    orderedBuddies(given, new Intl.Collator('en'));
    expect(given.map((entry) => entry.id)).toEqual(['2', '1']);
  });
});

describe('requestCount', () => {
  it('counts the requests to the account, not the ones it sent', () => {
    expect(requestCount(lists)).toBe(2);
    expect(requestCount(emptyBuddies())).toBe(0);
  });
});

describe('requestOffer', () => {
  it.each([
    ['NONE', 'ask'],
    ['INCOMING', 'accept'],
    ['OUTGOING', 'pending'],
    ['BUDDIES', 'buddies'],
    ['SELF', 'own'],
  ] as const)('offers %s as %s', (relation, offer) => {
    expect(requestOffer(relation)).toBe(offer);
  });
});
