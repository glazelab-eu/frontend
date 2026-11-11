import { beforeAll, describe, expect, it } from 'vitest';
import type { Club } from '../api/models';
import { loadLocale, translate } from '../i18n';
import { combination, glaze } from '../../test/fixtures';
import { backLabel } from './back-label';

const blueRutile = glaze({ name: 'Blue Rutile' });
const overTemmoku = combination({ title: 'Blue Rutile over Temmoku' });

describe('back-link labels', () => {
  beforeAll(() => Promise.all([loadLocale('de'), loadLocale('pt-PT')]));

  it('names searches in each locale without changing user-authored text', () => {
    const route = { name: 'discover', type: 'combinations', q: 'Blue <&>' } as const;
    for (const [locale, expected] of [
      ['en', 'Explore (Blue <&>)'],
      ['de', 'Entdecken (Blue <&>)'],
      ['pt-PT', 'Explorar (Blue <&>)'],
    ] as const) {
      expect(backLabel(route, [], [], (key, options) => translate(key, { ...options, locale }))).toBe(expected);
    }
  });

  it('names the account page', () => {
    const t = (key: Parameters<typeof translate>[0]) => translate(key, { locale: 'en' });
    expect(backLabel({ name: 'account' }, [], [], t)).toBe('Account');
    expect(backLabel({ name: 'admin' }, [], [], t)).toBe('Administration');
    expect(backLabel({ name: 'bans' }, [], [], t)).toBe('Bans');
    expect(backLabel({ name: 'users' }, [], [], t)).toBe('Accounts');
    expect(backLabel({ name: 'activity' }, [], [], t)).toBe('Activity');
    expect(backLabel({ name: 'about' }, [], [], t)).toBe('About Glazelab');
    expect(backLabel({ name: 'feedback' }, [], [], t)).toBe('Feedback');
  });

  it('names the lists of one type and the mixed list without a search', () => {
    const t = (key: Parameters<typeof translate>[0]) => translate(key, { locale: 'en' });
    expect(backLabel({ name: 'discover' }, [], [], t)).toBe('Explore');
    expect(backLabel({ name: 'discover', type: 'glazes' }, [], [], t)).toBe('All glazes');
    expect(backLabel({ name: 'discover', type: 'combinations' }, [], [], t)).toBe('All combinations');
  });

  it('names item origins only from the currently available listings', () => {
    const t = (key: Parameters<typeof translate>[0]) => translate(key, { locale: 'en' });
    expect(backLabel({ name: 'glaze', id: 'g1' }, [blueRutile], [], t)).toBe('Amaco PC-20 Blue Rutile');
    expect(backLabel({ name: 'combination', id: 'c1' }, [], [overTemmoku], t)).toBe(overTemmoku.title);
    // Account changes, removals or new permissions must not retain an old item's title.
    expect(backLabel({ name: 'glaze', id: 'g1' }, [], [], t)).toBe('Glaze');
    expect(backLabel({ name: 'combination', id: 'c1' }, [], [], t)).toBe('Combination');
  });

  it("names a club page by the account's own club, else the clubs list", () => {
    const t = (key: Parameters<typeof translate>[0]) => translate(key, { locale: 'en' });
    const club = { id: 'k1', name: 'Kiln club' } as Club;
    expect(backLabel({ name: 'club', id: 'k1' }, [], [], t, [club])).toBe('Kiln club');
    expect(backLabel({ name: 'club', id: 'k1' }, [], [], t)).toBe('Clubs');
  });

  it('leaves token, unknown and unrecorded origins to the fixed fallback', () => {
    expect(backLabel(null, [], [], translate)).toBeNull();
    expect(backLabel({ name: 'login', token: 'secret' }, [], [], translate)).toBeNull();
    expect(backLabel({ name: 'not-found' }, [], [], translate)).toBeNull();
  });
});
