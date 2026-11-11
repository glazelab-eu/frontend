import { describe, expect, it } from 'vitest';
import { scannedLink } from './scanned-link';

const site = { origin: 'https://glazelab.eu' };
const token = 'A'.repeat(20) + '-_' + 'b'.repeat(21);
const both = ['buddy', 'invite'] as const;

describe('scannedLink', () => {
  it('accepts the two route shapes of this app', () => {
    expect(scannedLink(`https://glazelab.eu/#/buddy/${token}`, site, both)).toEqual({ name: 'buddy', token });
    expect(scannedLink(`https://glazelab.eu/#/invite/${token}`, site, both)).toEqual({ name: 'invite', token });
  });
  it('keeps the origin exact but ignores the pathname (a link made at /index.html works at /)', () => {
    const dev = { origin: 'http://localhost:5173' };
    expect(scannedLink(`http://localhost:5173/app/#/buddy/${token}`, dev, both)?.name).toBe('buddy');
    expect(scannedLink(`http://localhost:5173/#/buddy/${token}`, dev, both)?.name).toBe('buddy');
    expect(scannedLink(`https://glazelab.eu/index.html#/invite/${token}`, site, both)).toEqual({ name: 'invite', token });
    expect(scannedLink(`http://localhost:5174/#/buddy/${token}`, dev, both)).toBeNull();
  });
  it('accepts what the URL parser writes as exactly this origin (upper case, the default port)', () => {
    expect(scannedLink(`HTTPS://GLAZELAB.EU/#/buddy/${token}`, site, both)).toEqual({ name: 'buddy', token });
    expect(scannedLink(`https://glazelab.eu:443/#/invite/${token}`, site, both)).toEqual({ name: 'invite', token });
  });
  it('refuses a kind that is not allowed here', () => {
    expect(scannedLink(`https://glazelab.eu/#/invite/${token}`, site, ['buddy'])).toBeNull();
    expect(scannedLink(`https://glazelab.eu/#/buddy/${token}`, site, ['invite'])).toBeNull();
  });
  it.each([
    ['another domain', `https://evil.example/#/buddy/${token}`],
    ['a look-alike host', `https://glazelab.eu.evil.example/#/buddy/${token}`],
    ['credentials', `https://glazelab.eu@evil.example/#/buddy/${token}`],
    ['credentials on the own host', `https://user:pw@glazelab.eu/#/buddy/${token}`],
    ['a password alone', `https://:pw@glazelab.eu/#/buddy/${token}`],
    ['a trailing dot on the host', `https://glazelab.eu./#/buddy/${token}`],
    ['a look-alike letter (IDN)', `https://glaz\u0435lab.eu/#/buddy/${token}`],
    ['a protocol-relative link', `//glazelab.eu/#/buddy/${token}`],
    ['another route before the link', `https://glazelab.eu/#/clubs#/buddy/${token}`],
    ['a second fragment', `https://glazelab.eu/#/buddy/${token}#x`],
    ['an encoded token', `https://glazelab.eu/#/buddy/%41${token.slice(1)}`],
    ['an upper-case route', `https://glazelab.eu/#/BUDDY/${token}`],
    ['a no-break space', `https://glazelab.eu/#/buddy/${token}\u00a0`],
    ['another scheme', `http://glazelab.eu/#/buddy/${token}`],
    ['another port', `https://glazelab.eu:8443/#/buddy/${token}`],
    ['a search part', `https://glazelab.eu/?next=x#/buddy/${token}`],
    ['another route', `https://glazelab.eu/#/reset/${token}`],
    ['the account route', `https://glazelab.eu/#/account`],
    ['a legacy hash', `https://glazelab.eu/#invite=${token}`],
    ['a query on the route', `https://glazelab.eu/#/buddy/${token}?x=1`],
    ['an extra segment', `https://glazelab.eu/#/buddy/${token}/more`],
    ['a short token', `https://glazelab.eu/#/buddy/${token.slice(1)}`],
    ['a long token', `https://glazelab.eu/#/buddy/${token}x`],
    ['a trailing full stop', `https://glazelab.eu/#/buddy/${token}.`],
    ['no token', 'https://glazelab.eu/#/buddy/'],
    ['javascript:', `javascript:alert(1)//glazelab.eu/#/buddy/${token}`],
    ['a data URL', `data:text/html,<script>alert(1)</script>`],
    ['a blob URL', `blob:https://glazelab.eu/${token}`],
    ['plain text', 'hello'],
    ['a barcode', '4006381333931'],
    ['empty', ''],
    ['leading space', ` https://glazelab.eu/#/buddy/${token}`],
    ['trailing newline', `https://glazelab.eu/#/buddy/${token}\n`],
    ['inner space', `https://glazelab.eu/#/buddy/${token.slice(0, 5)} ${token.slice(6)}`],
  ])('refuses %s', (_name, text) => {
    expect(scannedLink(text, site, both)).toBeNull();
  });
  it('refuses a site whose origin is opaque', () => {
    expect(scannedLink(`file:///#/buddy/${token}`, { origin: 'null' }, both)).toBeNull();
  });
});
