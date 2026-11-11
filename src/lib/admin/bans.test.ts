import { describe, expect, it } from 'vitest';
import { banReason, canBan, withoutBan, MAX_BAN_REASON } from './bans';

describe('banReason', () => {
  it('trims the text and refuses a blank one', () => {
    expect(banReason('  Harassed members  ')).toBe('Harassed members');
    expect(banReason('')).toBeNull();
    expect(banReason(' \n\t ')).toBeNull();
  });

  it('matches the length the API takes', () => {
    expect(MAX_BAN_REASON).toBe(500);
  });
});

describe('canBan', () => {
  const admin = { id: 'a1', siteAdmin: true };
  it('is for site admins only', () => {
    expect(canBan(admin, 'b2')).toBe(true);
    expect(canBan({ id: 'a1', siteAdmin: false }, 'b2')).toBe(false);
    expect(canBan(null, 'b2')).toBe(false);
    expect(canBan(undefined, 'b2')).toBe(false);
  });

  it('never offers the own account or an unknown one', () => {
    expect(canBan(admin, 'a1')).toBe(false);
    expect(canBan(admin, null)).toBe(false);
    expect(canBan(admin, undefined)).toBe(false);
    expect(canBan(admin, '')).toBe(false);
  });
});

describe('withoutBan', () => {
  it('drops only the lifted entry', () => {
    expect(withoutBan([{ id: '1' }, { id: '2' }, { id: '3' }], '2')).toEqual([{ id: '1' }, { id: '3' }]);
    expect(withoutBan([{ id: '1' }], 'x')).toEqual([{ id: '1' }]);
  });
});
