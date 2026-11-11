import { describe, expect, it } from 'vitest';
import en from '../i18n/en.json';
import { bottomNavVisible, navTabs, studioBarSticky } from './bottom-nav';
import { routeHref, routeSection, type Section } from '../routing/routes';

describe('bottomNavVisible', () => {
  it('shows on phones only', () => {
    expect(bottomNavVisible(true, 'discover', false)).toBe(true);
    expect(bottomNavVisible(false, 'discover', false)).toBe(false);
    expect(bottomNavVisible(false, 'studio', false)).toBe(false);
  });
  it('shows on every phone route outside the navigation, such as not found', () => {
    for (const section of ['discover', 'stock', 'clubs', null] as (Section | null)[]) {
      expect(bottomNavVisible(true, section, false)).toBe(true);
      expect(bottomNavVisible(true, section, true)).toBe(true);
    }
  });
  it('stays in Studio while the draft is untouched and gives way to the sticky bar once it has input', () => {
    expect(bottomNavVisible(true, 'studio', false)).toBe(true);
    expect(bottomNavVisible(true, 'studio', true)).toBe(false);
  });
});

describe('studioBarSticky', () => {
  it('holds on phones in Studio while the draft has input, and exactly then the bottom navigation gives way', () => {
    for (const phone of [true, false])
      for (const section of ['discover', 'studio', null] as (Section | null)[])
        for (const started of [true, false]) {
          expect(studioBarSticky(phone, section, started)).toBe(phone && section === 'studio' && started);
          if (phone) expect(bottomNavVisible(phone, section, started)).toBe(!studioBarSticky(phone, section, started));
        }
  });
});

describe('navTabs', () => {
  it('lists Explore, My shelf, Record and Clubs in order, each a section of its own route', () => {
    expect(navTabs.map((tab) => tab.id)).toEqual(['discover', 'stock', 'studio', 'clubs']);
    for (const tab of navTabs) expect(routeSection(tab.route)).toBe(tab.id);
    expect(navTabs.map((tab) => routeHref(tab.route))).toEqual(['#/', '#/stock', '#/studio', '#/clubs']);
  });
  it('has a short label for the phone bar that fits under an icon', () => {
    for (const tab of navTabs) expect((en as Record<string, string>)[tab.shortLabel].length).toBeLessThanOrEqual(12);
  });
});
