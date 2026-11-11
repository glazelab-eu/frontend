import { describe, expect, it } from 'vitest';
import { accountStatusKey, formatCreatedOn, MAX_USER_SEARCH, userIdOf, userSearchText } from './users';

describe('admin account list helpers', () => {
  it('keys rows by the account ID', () => {
    expect(userIdOf({ id: 'u1' })).toBe('u1');
  });

  it('names both statuses', () => {
    expect(accountStatusKey('ACTIVE')).toBe('users.status.ACTIVE');
    expect(accountStatusKey('PENDING')).toBe('users.status.PENDING');
  });

  it('strips and cuts the search text like the API', () => {
    expect(userSearchText('  Ada  ')).toBe('Ada');
    expect(userSearchText('   ')).toBe('');
    expect(userSearchText('x'.repeat(MAX_USER_SEARCH + 20))).toHaveLength(MAX_USER_SEARCH);
  });

  it('formats the registration day per language and shows nothing without one', () => {
    const at = '2026-11-03T10:15:00Z';
    expect(formatCreatedOn(at, 'en')).toBe(new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(at)));
    expect(formatCreatedOn(at, 'de')).toBe(new Intl.DateTimeFormat('de', { dateStyle: 'medium' }).format(new Date(at)));
    expect(formatCreatedOn(null, 'en')).toBe('');
    expect(formatCreatedOn('garbage', 'en')).toBe('');
  });
});
