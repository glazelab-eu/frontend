import { describe, expect, it } from 'vitest';
import type { FeedEntry } from '../api/models';
import { badgeCount, badgeText, entryRoute, entrySentence, isNew, sourcesOff } from './feed';

const entry = (values: Partial<FeedEntry>): FeedEntry => ({
  id: 'k',
  type: 'BUDDY_COMBINATION',
  at: '2026-11-08T10:00:00Z',
  actorId: 'a',
  actorName: 'Ada',
  itemId: 'item',
  title: null,
  manufacturer: null,
  glazeName: null,
  glazeCode: null,
  clubId: null,
  clubName: null,
  ...values,
});

describe('feed', () => {
  it('shows the badge from 1 and caps it at 99+', () => {
    expect(badgeText(0)).toBe('');
    expect(badgeText(1)).toBe('1');
    expect(badgeText(99)).toBe('99');
    expect(badgeText(100)).toBe('99+');
  });

  it('hands the sentences the count up to the cap, whose form says 99+', () => {
    expect(badgeCount(1)).toBe(1);
    expect(badgeCount(99)).toBe(99);
    expect(badgeCount(100)).toBe(100);
    expect(badgeCount(250)).toBe(100);
    expect(badgeCount(-1)).toBe(0);
  });

  it('counts an entry as new after the seen position, every entry before the first look', () => {
    expect(isNew(entry({}), null)).toBe(true);
    expect(isNew(entry({}), '2026-11-08T09:59:59.999Z')).toBe(true);
    expect(isNew(entry({}), '2026-11-08T10:00:00Z')).toBe(false);
  });

  it('links every type to its item', () => {
    expect(entryRoute(entry({}))).toEqual({ name: 'combination', id: 'item' });
    expect(entryRoute(entry({ type: 'CLUB_COMBINATION', clubId: 'c' }))).toEqual({ name: 'combination', id: 'item' });
    expect(entryRoute(entry({ type: 'BUDDY_GLAZE' }))).toEqual({ name: 'glaze', id: 'item' });
    expect(entryRoute(entry({ type: 'CLUB_GLAZE', clubId: 'c' }))).toEqual({ name: 'stock', shelf: 'c' });
    expect(entryRoute(entry({ type: 'CLUB_MEMBER', clubId: 'c' }))).toEqual({ name: 'club', id: 'c' });
    expect(entryRoute(entry({ type: 'NEW_BUDDY' }))).toEqual({ name: 'account' });
    expect(entryRoute(entry({ type: 'BUDDY_REQUEST' }))).toEqual({ name: 'account' });
  });

  it('names the glaze as everywhere else and the combination by its title', () => {
    expect(entrySentence(entry({ title: 'Blue' })).values).toEqual({ name: 'Ada', title: 'Blue', glaze: '', club: '' });
    const glaze = entrySentence(entry({ type: 'CLUB_GLAZE', manufacturer: 'Amaco', glazeCode: 'PC-20', glazeName: 'Blue Rutile', clubName: 'Studio' }));
    expect(glaze).toEqual({ key: 'feed.entry.clubGlaze', values: { name: 'Ada', title: '', glaze: 'Amaco PC-20 Blue Rutile', club: 'Studio' } });
  });

  it('knows when both sources are off', () => {
    expect(sourcesOff({ feedBuddies: false, feedClubs: false })).toBe(true);
    expect(sourcesOff({ feedBuddies: true, feedClubs: false })).toBe(false);
  });
});
