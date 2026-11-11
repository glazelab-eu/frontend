import { describe, expect, it } from 'vitest';
import { includeBuddiesKey, includeClubsKey, readIncludeBuddies, readIncludeClubs, rememberIncludeBuddies, rememberIncludeClubs } from './include';

function device(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

describe('Include buddies', () => {
  it('is off until the account chose it, and remembered per account', () => {
    const storage = device();
    expect(readIncludeBuddies('u1', storage)).toBe(false);
    rememberIncludeBuddies('u1', true, storage);
    expect(readIncludeBuddies('u1', storage)).toBe(true);
    expect(readIncludeBuddies('u2', storage)).toBe(false);
    expect(includeBuddiesKey('u1')).toBe('glazelab:include-buddies:u1');
  });

  it('forgets the key when switched off, so the device keeps nothing', () => {
    const storage = device();
    rememberIncludeBuddies('u1', true, storage);
    rememberIncludeBuddies('u1', false, storage);
    expect(storage.values.size).toBe(0);
    expect(readIncludeBuddies('u1', storage)).toBe(false);
  });

  it('reads only the value 1 as on', () => {
    expect(readIncludeBuddies('u1', device({ [includeBuddiesKey('u1')]: 'true' }))).toBe(false);
    expect(readIncludeBuddies('u1', device({ [includeBuddiesKey('u1')]: '1' }))).toBe(true);
  });

  it('does not fail when the storage does', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readIncludeBuddies('u1', broken)).toBe(false);
    expect(() => rememberIncludeBuddies('u1', true, broken)).not.toThrow();
    expect(() => rememberIncludeBuddies('u1', false, broken)).not.toThrow();
  });
});

describe('Include club glazes', () => {
  it('is off until chosen, remembered per account under its own key, and forgotten when switched off', () => {
    const storage = device();
    expect(readIncludeClubs('u1', storage)).toBe(false);
    rememberIncludeClubs('u1', true, storage);
    expect(readIncludeClubs('u1', storage)).toBe(true);
    expect(readIncludeClubs('u2', storage)).toBe(false);
    expect(readIncludeBuddies('u1', storage)).toBe(false);
    expect(includeClubsKey('u1')).toBe('glazelab:include-clubs:u1');
    expect(includeClubsKey('u1')).not.toBe(includeBuddiesKey('u1'));
    rememberIncludeClubs('u1', false, storage);
    expect(storage.values.size).toBe(0);
  });
});
