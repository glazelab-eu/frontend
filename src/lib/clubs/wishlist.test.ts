import { describe, expect, it } from 'vitest';
import cases from './wishlist-links.json';
import { wishlistEntry } from '../../test/fixtures';
import { WISHLIST_LINK_MAX, isWished, isWishlistLink, linkHost, openCount, orderedWishlist, wishlistLink, wishlistTitle, withWishlistEntry } from './wishlist';

describe('the wishlist link grammar', () => {
  it('agrees with the backend on every shared vector', () => {
    expect(cases.length).toBeGreaterThan(40);
    for (const { link, valid } of cases) expect(isWishlistLink(link), link).toBe(valid);
  });

  it('takes at most 2000 characters', () => {
    const base = 'https://example.com/';
    expect(isWishlistLink(base + 'a'.repeat(WISHLIST_LINK_MAX - base.length))).toBe(true);
    expect(isWishlistLink(base + 'a'.repeat(WISHLIST_LINK_MAX - base.length + 1))).toBe(false);
  });
});

describe('wishlistLink', () => {
  it('answers the browser-normalised form of a typed link', () => {
    expect(wishlistLink('  https://Shop.Example.TEST/glaze?id=1  ')).toEqual({ link: 'https://shop.example.test/glaze?id=1' });
    expect(wishlistLink('http://example.test')).toEqual({ link: 'http://example.test/' });
    // A non-ASCII host becomes punycode, other characters percent escapes: what the server's grammar accepts.
    expect(wishlistLink('https://töpferbedarf.de/glasur/blau')).toEqual({ link: 'https://xn--tpferbedarf-rfb.de/glasur/blau' });
    expect(wishlistLink('https://example.test/ä')).toEqual({ link: 'https://example.test/%C3%A4' });
    for (const result of [wishlistLink('https://töpferbedarf.de/'), wishlistLink('https://example.test/ä')])
      if ('link' in result) expect(isWishlistLink(result.link)).toBe(true);
  });

  it('refuses what the parser would change silently, other schemes, credentials and empty input', () => {
    expect(wishlistLink('   ')).toEqual({ error: 'required' });
    for (const typed of [
      'javascript:alert(1)',
      'data:text/html,<b>x</b>',
      'ftp://example.test/file',
      'example.test',
      'https:example.test',
      'https://user:pass@example.test/',
      'https://user@example.test/',
      'https://exa mple.test/',
      'https://example.test/\ta',
      'https://example.test/a\nb',
      'https://example.test\\evil.test',
      'https://example.test/a|b',
      'https://example.test/' + 'a'.repeat(WISHLIST_LINK_MAX),
    ])
      expect(wishlistLink(typed), typed).toEqual({ error: 'invalid' });
  });
});

describe('the wishlist display', () => {
  it('shows a link by its host', () => {
    expect(linkHost('https://shop.example.test:8443/a?b#c')).toBe('shop.example.test');
    expect(linkHost('https://xn--tpferbedarf-rfb.de/')).toBe('xn--tpferbedarf-rfb.de');
  });

  it('names a glaze by its title and an item by its name', () => {
    expect(wishlistTitle(wishlistEntry({ type: 'GLAZE', manufacturer: 'Amaco', code: 'PC-20', name: 'Blue Rutile' }))).toBe('Amaco PC-20 Blue Rutile');
    expect(wishlistTitle(wishlistEntry({ name: 'Kiln shelf' }))).toBe('Kiln shelf');
  });

  it('lists the wanted entries newest first, then the acquired ones by when they were acquired', () => {
    const entries = [
      wishlistEntry({ id: 'old', addedAt: '2026-11-01T10:00:00Z' }),
      wishlistEntry({ id: 'got-first', addedAt: '2026-11-09T10:00:00Z', acquiredAt: '2026-11-02T10:00:00Z' }),
      wishlistEntry({ id: 'new', addedAt: '2026-11-03T10:00:00.5Z' }),
      wishlistEntry({ id: 'got-last', addedAt: '2026-10-01T10:00:00Z', acquiredAt: '2026-11-05T10:00:00.123456Z' }),
    ];
    expect(orderedWishlist(entries).map((entry) => entry.id)).toEqual(['new', 'old', 'got-last', 'got-first']);
    expect(openCount(entries)).toBe(2);
  });

  it('knows a glaze that is still wanted, not one that was acquired', () => {
    const entries = [
      wishlistEntry({ type: 'GLAZE', glazeId: 'g1' }),
      wishlistEntry({ id: 'w2', type: 'GLAZE', glazeId: 'g2', acquiredAt: '2026-11-02T10:00:00Z' }),
    ];
    expect(isWished(entries, 'g1')).toBe(true);
    expect(isWished(entries, 'g2')).toBe(false);
  });

  it('replaces an answered entry or adds it', () => {
    const first = wishlistEntry({ id: 'w1' });
    const changed = wishlistEntry({ id: 'w1', acquiredAt: '2026-11-02T10:00:00Z' });
    expect(withWishlistEntry([first], changed)).toEqual([changed]);
    expect(withWishlistEntry([first], wishlistEntry({ id: 'w2' })).map((entry) => entry.id)).toEqual(['w1', 'w2']);
  });
});
