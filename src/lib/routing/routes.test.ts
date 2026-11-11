import { describe, expect, it } from 'vitest';
import { findItem, home, isTokenRoute, parseRoute, routeHref, routeKey, routeSection, sortLabel, sortOptions, withoutPhotoPointer, type Route } from './routes';
import { INITIAL_SYNC, type SyncState } from '../sync/lifecycle';

const token = 'Ab-_0123456789abcdefghijklmnopqrstuvwxyzABC';
const id = '0b6f7a52-7d61-4f4a-9a43-7f0e0d2a1c11';

describe('route parsing', () => {
  it.each([
    ['', home],
    ['#', home],
    ['#/', home],
    ['#/combinations', { name: 'discover', type: 'combinations' }],
    ['#/glazes', { name: 'discover', type: 'glazes' }],
    ['#/glazes/', { name: 'discover', type: 'glazes' }],
    [`#/glazes/${id}`, { name: 'glaze', id }],
    [`#/combinations/${id}`, { name: 'combination', id }],
    [`#/glazes/${id}?photo=Ab-0123456789`, { name: 'glaze', id, photo: 'Ab-0123456789' }],
    [`#/combinations/${id}?photo=${id}`, { name: 'combination', id, photo: id }],
    [`#/combinations/${id}?photo=`, { name: 'combination', id }],
    [`#/combinations/${id}?photo=a%20b`, { name: 'combination', id }],
    [`#/combinations/${id}?photo=${'a'.repeat(65)}`, { name: 'combination', id }],
    [`#/glazes/${id}?other=1`, { name: 'glaze', id }],
    ['#/stock', { name: 'stock' }],
    ['#/stock?glaze=g1', { name: 'stock', glaze: 'g1' }],
    ['#/stock?glaze=a%20b', { name: 'stock' }],
    ['#/stock?glaze=', { name: 'stock' }],
    ['#/stock?shelf=personal', { name: 'stock', shelf: 'personal' }],
    [`#/stock?shelf=${id}`, { name: 'stock', shelf: id }],
    [`#/stock?glaze=g1&shelf=${id}`, { name: 'stock', glaze: 'g1', shelf: id }],
    ['#/stock?shelf=a%20b', { name: 'stock' }],
    ['#/stock?shelf=', { name: 'stock' }],
    [`#/stock?shelf=${'a'.repeat(65)}`, { name: 'stock' }],
    ['#/stock/4006381333931?shelf=personal', { name: 'stock', barcode: '4006381333931', shelf: 'personal' }],
    ['#/stock/4006381333931?shelf=a%20b', { name: 'stock', barcode: '4006381333931' }],
    ['#/stock/4006381333931?glaze=g1', { name: 'stock', barcode: '4006381333931' }],
    ['#/stock/4006381333931', { name: 'stock', barcode: '4006381333931' }],
    ['#/studio', { name: 'studio' }],
    ['#/studio/c1', { name: 'studio', id: 'c1' }],
    ['#/studio/c1?from=c2', { name: 'studio', id: 'c1' }],
    ['#/studio?from=c1', { name: 'studio', from: 'c1' }],
    ['#/studio?glaze=g1', { name: 'studio', glaze: 'g1' }],
    ['#/studio?from=c1&glaze=g1', { name: 'studio', from: 'c1' }],
    ['#/studio?from=a%20b&glaze=g1', { name: 'studio', glaze: 'g1' }],
    ['#/studio?glaze=a%20b', { name: 'studio' }],
    ['#/studio?from=&glaze=', { name: 'studio' }],
    ['#/clubs', { name: 'clubs' }],
    ['#/image-deletions', { name: 'image-deletions' }],
    ['#/image-reports', { name: 'image-reports' }],
    ['#/avatar-reports', { name: 'avatar-reports' }],
    ['#/bans', { name: 'bans' }],
    ['#/admin/users', { name: 'users' }],
    ['#/admin/feedback', { name: 'feedback' }],
    ['#/error-reports', { name: 'error-reports' }],
    ['#/admin', { name: 'admin' }],
    ['#/admin/', { name: 'admin' }],
    ['#/admin/image-deletions', { name: 'image-deletions' }],
    ['#/admin/image-reports', { name: 'image-reports' }],
    ['#/admin/avatar-reports', { name: 'avatar-reports' }],
    ['#/admin/bans', { name: 'bans' }],
    ['#/admin/error-reports', { name: 'error-reports' }],
    ['#/terms', { name: 'terms' }],
    ['#/about', { name: 'about' }],
    ['#/about/', { name: 'about' }],
    ['#/about?x=1', { name: 'about' }],
    ['#/account', { name: 'account' }],
    ['#/account?x=1', { name: 'account' }],
    ['#/account?section=picture', { name: 'account', section: 'picture' }],
    ['#/account?section=diagnostics', { name: 'account', section: 'diagnostics' }],
    ['#/account?section=password', { name: 'account' }],
    ['#/activity', { name: 'activity' }],
    ['#/clubs?tab=1', { name: 'clubs' }],
    ['#/clubs/k1', { name: 'club', id: 'k1' }],
    [`#/verify/${token}`, { name: 'verify', token }],
    [`#/reset/${token}`, { name: 'reset', token }],
    [`#/login/${token}`, { name: 'login', token }],
    [`#/invite/${token}`, { name: 'invite', token }],
    [`#/buddy/${token}`, { name: 'buddy', token }],
  ] as [string, Route][])('parses %j', (hash, route) => {
    expect(parseRoute(hash)).toEqual(route);
  });

  it.each([
    '#/nonsense',
    '#/admin/nonsense',
    '#/admin/bans/extra',
    '#/admin/admin',
    '#/glazes/a/b',
    '#/stock/extra',
    '#/stock/1234567',
    '#/stock/123456789',
    '#/stock/12345678901',
    '#/stock/4006381333931/extra',
    '#/studio/a%20b',
    '#/studio/a/b',
    '#/terms/extra',
    '#/about/extra',
    '#/About',
    '#/account/extra',
    '#/activity/extra',
    '#/clubs/k1/extra',
    '#/clubs/%E0%A4%A',
    '#/image-deletions/extra',
    '#/image-reports/extra',
    '#/avatar-reports/extra',
    '#/bans/extra',
    '#/error-reports/extra',
    '#/verify',
    '#/invite/',
    '#/buddy/',
    '#/buddy/a/b',
    `#buddy=${token}`,
    '#/glazes/%E0%A4%A',
    '#nonsense',
    '#verify=',
  ])('reports %j as not found', (hash) => {
    expect(parseRoute(hash)).toEqual({ name: 'not-found' });
  });

  it.each(['verify', 'reset', 'login', 'invite'] as const)('maps the old #%s=<token> link form', (name) => {
    expect(parseRoute(`#${name}=${token}`)).toEqual({ name, token });
  });

  it('decodes encoded segments', () => {
    expect(parseRoute('#/glazes/a%20b')).toEqual({ name: 'glaze', id: 'a b' });
  });
});

describe('route links', () => {
  it.each([
    home,
    { name: 'discover', type: 'glazes' },
    { name: 'discover', type: 'combinations' },
    { name: 'glaze', id },
    { name: 'glaze', id: 'a b/c' },
    { name: 'combination', id },
    { name: 'stock' },
    { name: 'stock', barcode: '96385074' },
    { name: 'stock', glaze: id },
    { name: 'stock', shelf: 'personal' },
    { name: 'stock', shelf: id },
    { name: 'stock', glaze: id, shelf: id },
    { name: 'stock', barcode: '96385074', shelf: id },
    { name: 'studio' },
    { name: 'studio', id },
    { name: 'studio', from: id },
    { name: 'studio', glaze: id },
    { name: 'clubs' },
    { name: 'club', id },
    { name: 'terms' },
    { name: 'about' },
    { name: 'account' },
    { name: 'account', section: 'picture' },
    { name: 'account', section: 'diagnostics' },
    { name: 'activity' },
    { name: 'image-deletions' },
    { name: 'image-reports' },
    { name: 'avatar-reports' },
    { name: 'bans' },
    { name: 'error-reports' },
    { name: 'verify', token },
    { name: 'reset', token },
    { name: 'login', token },
    { name: 'invite', token },
    { name: 'buddy', token },
  ] as Route[])('round-trips %j', (route) => {
    expect(parseRoute(routeHref(route))).toEqual(route);
  });

  it('builds the admin pages under #/admin and round-trips them, old hashes included', () => {
    expect(routeHref({ name: 'admin' })).toBe('#/admin');
    for (const name of ['image-reports', 'image-deletions', 'avatar-reports', 'bans', 'error-reports', 'users', 'feedback'] as const) {
      expect(routeHref({ name })).toBe(`#/admin/${name}`);
      expect(parseRoute(routeHref({ name }))).toEqual({ name });
      expect(parseRoute(`#/${name}`)).toEqual({ name });
      expect(routeSection({ name })).toBeNull();
    }
    expect(routeSection({ name: 'admin' })).toBeNull();
    expect(routeKey({ name: 'admin' })).not.toBe(routeKey({ name: 'bans' }));
  });

  it('builds the documented link forms', () => {
    expect(routeHref(home)).toBe('#/');
    expect(routeHref({ name: 'glaze', id })).toBe(`#/glazes/${id}`);
    expect(routeHref({ name: 'invite', token })).toBe(`#/invite/${token}`);
    expect(routeHref({ name: 'buddy', token })).toBe(`#/buddy/${token}`);
    expect(routeHref({ name: 'stock', barcode: '96385074' })).toBe('#/stock/96385074');
    expect(routeHref({ name: 'stock', glaze: id })).toBe('#/stock?glaze=' + id);
    expect(routeHref({ name: 'stock', shelf: id })).toBe('#/stock?shelf=' + id);
    expect(routeHref({ name: 'stock', glaze: id, shelf: 'personal' })).toBe(`#/stock?glaze=${id}&shelf=personal`);
    expect(routeHref({ name: 'stock', barcode: '96385074', shelf: 'personal' })).toBe('#/stock/96385074?shelf=personal');
    expect(routeHref({ name: 'account' })).toBe('#/account');
    expect(routeHref({ name: 'account', section: 'picture' })).toBe('#/account?section=picture');
    expect(routeHref({ name: 'activity' })).toBe('#/activity');
    expect(routeHref({ name: 'about' })).toBe('#/about');
    expect(routeKey({ name: 'about' })).toBe('#/about');
    expect(routeHref({ name: 'not-found' })).toBe('#/');
  });

  it('assigns navigation sections', () => {
    expect(routeSection({ name: 'glaze', id })).toBe('discover');
    expect(routeSection({ name: 'verify', token })).toBe('discover');
    expect(routeSection({ name: 'stock' })).toBe('stock');
    expect(routeSection({ name: 'club', id })).toBe('clubs');
    expect(routeSection({ name: 'not-found' })).toBeNull();
    expect(routeSection({ name: 'terms' })).toBeNull();
    expect(routeSection({ name: 'about' })).toBeNull();
    expect(routeSection({ name: 'account' })).toBeNull();
    expect(routeSection({ name: 'activity' })).toBeNull();
    expect(isTokenRoute({ name: 'login', token })).toBe(true);
    expect(isTokenRoute({ name: 'buddy', token })).toBe(true);
    expect(isTokenRoute({ name: 'stock' })).toBe(false);
  });
});

describe('Explore filters in the link', () => {
  it.each([
    ['#/?q=blue%20rutile', { ...home, q: 'blue rutile' }],
    ['#/?q=+rutile+', { ...home, q: 'rutile' }],
    ['#/combinations?q=x', { ...home, type: 'combinations', q: 'x' }],
    ['#/?type=glazes&q=x', { ...home, type: 'glazes', q: 'x' }],
    ['#/?type=combinations', { ...home, type: 'combinations' }],
    // The older path form is overridden by an explicit type; an invalid type is dropped.
    ['#/glazes?type=combinations', { ...home, type: 'combinations' }],
    ['#/glazes?type=nonsense', { ...home, type: 'glazes' }],
    ['#/?type=all&type=nonsense', home],
    [
      `#/glazes?q=pc20&tags=Satin%20Matte,cone-6,satin-matte&quick=favourites&sort=az`,
      {
        name: 'discover',
        type: 'glazes',
        q: 'pc20',
        tags: ['satin-matte', 'cone-6'],
        quick: 'favourites',
        sort: 'az',
      },
    ],
    [`#/?glaze=${id}&quick=canMake`, { ...home, glaze: id, quick: 'canMake' }],
    ['#/?type=glazes&quick=shelf', { ...home, type: 'glazes', quick: 'shelf' }],
    ['#/?type=combinations&quick=canMake', { ...home, type: 'combinations', quick: 'canMake' }],
    // "Missing at most one glaze" is a step of I can make now and means nothing elsewhere.
    ['#/?quick=canMake&almost=1', { ...home, quick: 'canMake', almost: true }],
    ['#/?type=glazes&quick=shelf&stock=used', { ...home, type: 'glazes', quick: 'shelf', stock: 'used' }],
    ['#/?quick=shelf&stock=all', { ...home, quick: 'shelf', stock: 'all' }],
    ['#/?quick=canMake&almost=2', { ...home, quick: 'canMake' }],
    ['#/?quick=shelf&almost=1', { ...home, quick: 'shelf' }],
    ['#/?almost=1', home],
    ['#/?quick=shelf&stock=other', { ...home, quick: 'shelf' }],
    ['#/?quick=shelf&stock=stock', { ...home, quick: 'shelf' }],
    ['#/?quick=favourites&stock=used', { ...home, quick: 'favourites' }],
    // Explicit source choices belong only to the availability views; legacy personal-shelf options are ignored.
    ['#/?quick=shelf&clubs=1&buddies=0', { ...home, quick: 'shelf' }],
    ['#/?quick=shelf&stock=used&clubs=0', { ...home, quick: 'shelf', stock: 'used' }],
    ['#/?quick=shelf&clubs=yes&buddies=2', { ...home, quick: 'shelf' }],
    ['#/?quick=canMake&clubs=1&buddies=1', { ...home, quick: 'canMake', clubs: true, buddies: true }],
    ['#/?quick=available&clubs=0&buddies=1', { ...home, quick: 'available', clubs: false, buddies: true }],
    ['#/?quick=available&stock=used', { ...home, quick: 'available' }],
    ['#/?clubs=1', home],
    // Unknown parameters and invalid values are dropped; the default quick view is left out.
    ['#/?quick=all&sort=popular&tags=,,!!&glaze=a%20b&q=&utm=x', home],
    ['#/?quick=everything', home],
    ['#/?sort=used', home],
    ['#/?sort=photos', home],
    ['#/?type=combinations&sort=used', { ...home, type: 'combinations' }],
    ['#/?type=glazes&sort=photos', { ...home, type: 'glazes' }],
    ['#/?type=glazes&sort=used', { ...home, type: 'glazes', sort: 'used' }],
    ['#/glazes?sort=newest', { ...home, type: 'glazes' }],
    ['#/glazes?sort=photos', { ...home, type: 'glazes' }],
    ['#/glazes?type=combinations&sort=used', { ...home, type: 'combinations' }],
    // The final-firing filters: a valid cone, an atmosphere in any letter case; not for Glazes.
    ['#/?cone=6&atmosphere=oxidation', { ...home, cone: '6', atmosphere: 'OXIDATION' }],
    ['#/?cone=04&atmosphere=REDUCTION', { ...home, cone: '04', atmosphere: 'REDUCTION' }],
    ['#/?type=combinations&cone=022', { ...home, type: 'combinations', cone: '022' }],
    ['#/?cone=%206%20&atmosphere=Other', { ...home, cone: '6', atmosphere: 'OTHER' }],
    ['#/?cone=6%2F7&atmosphere=smoky', home],
    ['#/?cone=0&atmosphere=', home],
    ['#/?cone=123', home],
    ['#/?type=glazes&cone=6&atmosphere=oxidation', { ...home, type: 'glazes' }],
  ] as [string, Route][])('parses %j', (hash, route) => {
    expect(parseRoute(hash)).toEqual(route);
  });

  it.each([
    { ...home, q: 'blue rutile' },
    { ...home, q: 'a&b=c?d#e' },
    { name: 'discover', type: 'glazes', tags: ['satin-matte', 'glänzend'] },
    { name: 'discover', type: 'combinations', q: 'x', glaze: id, quick: 'canMake' },
    { ...home, q: 'x', tags: ['a'], glaze: id, quick: 'waiting', sort: 'favourites' },
    { name: 'discover', type: 'glazes', quick: 'new', sort: 'favourites' },
    { name: 'discover', type: 'glazes', q: 'x', quick: 'shelf' },
    { name: 'discover', quick: 'available', clubs: true, buddies: false },
    { name: 'discover', quick: 'canMake', clubs: false, buddies: true },
    { ...home, quick: 'favourites' },
    { name: 'discover', type: 'combinations', quick: 'canMake', almost: true, sort: 'az' },
    { ...home, cone: '6', atmosphere: 'OXIDATION' },
    { name: 'discover', type: 'combinations', q: 'x', cone: '04', atmosphere: 'OTHER' },
  ] as Route[])('round-trips %j', (route) => {
    expect(parseRoute(routeHref(route))).toEqual(route);
  });

  it('links a glaze page to its combinations under the Combinations type, not to the mixed list', () => {
    expect(routeHref({ name: 'discover', type: 'combinations', glaze: id })).toBe(`#/?type=combinations&glaze=${id}`);
    expect(routeHref({ ...home, glaze: id })).toBe(`#/?glaze=${id}`);
  });

  it('leaves default and inapplicable sorts out of links', () => {
    expect(routeHref({ ...home, sort: 'newest' })).toBe('#/');
    expect(routeHref({ ...home, sort: 'used' })).toBe('#/');
    expect(routeHref({ ...home, type: 'glazes', sort: 'newest' })).toBe('#/?type=glazes');
    expect(routeHref({ ...home, type: 'glazes', sort: 'used' })).toBe('#/?type=glazes&sort=used');
  });

  it('writes the type first and leaves it out for the mixed list', () => {
    expect(routeHref({ ...home, type: 'glazes', q: 'x' })).toBe('#/?type=glazes&q=x');
    expect(routeHref({ ...home, type: 'combinations' })).toBe('#/?type=combinations');
    expect(routeHref({ ...home, q: 'x' })).toBe('#/?q=x');
  });

  it('writes parameters in a stable order and leaves out empty ones', () => {
    expect(routeHref({ ...home, sort: 'az', quick: 'mine', glaze: 'g1', tags: ['b', 'a'], q: ' x ' })).toBe('#/?q=x&tags=b%2Ca&glaze=g1&quick=mine&sort=az');
    expect(routeHref({ ...home, q: '  ', tags: [] })).toBe('#/');
    expect(routeHref({ ...home, quick: 'canMake', almost: true })).toBe('#/?quick=canMake&almost=1');
    expect(routeHref({ ...home, quick: 'mine', almost: true })).toBe('#/?quick=mine');
    expect(routeHref({ ...home, quick: 'shelf', stock: 'used' })).toBe('#/?quick=shelf&stock=used');
    expect(routeHref({ ...home, quick: 'mine', stock: 'used' })).toBe('#/?quick=mine');
    expect(routeHref({ ...home, quick: 'shelf', stock: 'all', clubs: true, buddies: false })).toBe('#/?quick=shelf&stock=all');
    expect(routeHref({ ...home, quick: 'canMake', clubs: true, buddies: true })).toBe('#/?quick=canMake&clubs=1&buddies=1');
    expect(routeHref({ ...home, clubs: true })).toBe('#/');
    expect(routeHref({ ...home, sort: 'az', atmosphere: 'REDUCTION', cone: '10', q: 'x' })).toBe('#/?q=x&cone=10&atmosphere=reduction&sort=az');
    expect(routeHref({ ...home, type: 'glazes', cone: '6', atmosphere: 'OTHER' })).toBe('#/?type=glazes');
  });

  it('keys a page independently of its filters', () => {
    expect(routeKey({ ...home, q: 'rutile', tags: ['a'] })).toBe(routeKey(home));
    // A type change updates the page instead of mounting it again.
    expect(routeKey({ name: 'discover', type: 'glazes', q: 'x' })).toBe(routeKey(home));
    expect(routeKey({ ...home, cone: '6', atmosphere: 'OXIDATION' })).toBe(routeKey(home));
    expect(routeKey({ name: 'glaze', id })).not.toBe(routeKey({ name: 'glaze', id: 'other' }));
    expect(routeKey({ name: 'stock' })).toBe('#/stock');
    // The account page's section is where it opens, not another page.
    expect(routeKey({ name: 'account', section: 'diagnostics' })).toBe(routeKey({ name: 'account' }));
    // A chip change on the shelf never remounts the page; a glaze link or a barcode still does.
    expect(routeKey({ name: 'stock', shelf: 'personal' })).toBe(routeKey({ name: 'stock' }));
    expect(routeKey({ name: 'stock', shelf: id })).toBe(routeKey({ name: 'stock', shelf: 'personal' }));
    expect(routeKey({ name: 'stock', glaze: id, shelf: id })).toBe(routeKey({ name: 'stock', glaze: id }));
    expect(routeKey({ name: 'stock', glaze: id })).not.toBe(routeKey({ name: 'stock' }));
    expect(routeKey({ name: 'stock', barcode: '96385074' })).not.toBe(routeKey({ name: 'stock' }));
    expect(routeKey({ name: 'stock', barcode: '96385074', shelf: id })).toBe(routeKey({ name: 'stock', barcode: '96385074' }));
  });
});

describe('sort labels', () => {
  it('name every offered order, with the glazes sorting A–Z by code', () => {
    const labels = (type?: 'combinations' | 'glazes') => sortOptions(type).map((sort) => sortLabel(sort, type));
    expect(labels()).toEqual(['discover.sort.newest', 'discover.sort.favourites', 'discover.sort.az']);
    expect(labels('combinations')).toEqual(labels());
    expect(labels('glazes')).toEqual(['discover.sort.newest', 'discover.sort.favourites', 'discover.sort.used', 'discover.sort.code']);
  });
});

describe('item status', () => {
  const items = [{ id: 'a' }];
  const loaded: SyncState = { phase: 'idle', failure: null };
  const failed: SyncState = { phase: 'idle', failure: 'server' };

  it('finds loaded or saved items, even while reloading or after a failed load', () => {
    for (const state of [loaded, INITIAL_SYNC, { phase: 'refreshing', failure: null } as const, failed]) {
      expect(findItem(items, 'a', state)).toEqual({ status: 'found', item: items[0] });
    }
  });

  it.each([
    ['waits while the first load is running', [], 'a', INITIAL_SYNC, { status: 'loading' }],
    [
      'waits while a load runs over shown listings, also after a failure',
      items,
      'b',
      { phase: 'refreshing', failure: 'offline' } as const,
      { status: 'loading' },
    ],
    ['reports unknown or invisible items as missing after a successful load', items, 'b', loaded, { status: 'missing' }],
    ['reports unavailable data instead of missing after a failed load', items, 'b', failed, { status: 'unavailable' }],
  ])('%s', (_case, list, id, state, expected) => {
    expect(findItem(list, id, state)).toEqual(expected);
  });
});

it('remounts Studio for a new source, while default links stay unchanged', () => {
  expect(routeKey({ name: 'studio', from: 'c1' })).not.toBe(routeKey({ name: 'studio', from: 'c2' }));
  expect(routeKey({ name: 'studio', glaze: 'g1' })).not.toBe(routeKey({ name: 'studio' }));
});

it('remounts edit routes and distinguishes edits from variations', () => {
  expect(routeKey({ name: 'studio', id: 'c1' })).not.toBe(routeKey({ name: 'studio', from: 'c1' }));
  expect(routeKey({ name: 'studio', id: 'c1' })).not.toBe(routeKey({ name: 'studio', id: 'c2' }));
});

describe('the photo pointer of an item link', () => {
  it('is written back into the link and read again', () => {
    for (const route of [
      { name: 'glaze', id, photo: id },
      { name: 'combination', id, photo: 'img-1' },
    ] as const)
      expect(parseRoute(routeHref(route))).toEqual(route);
    expect(routeHref({ name: 'glaze', id: 'g1', photo: 'i 1' })).toBe('#/glazes/g1?photo=i%201');
    expect(routeHref({ name: 'combination', id: 'c1' })).toBe('#/combinations/c1');
  });

  it('never applies to other routes', () => {
    expect(parseRoute('#/clubs/k1?photo=i1')).toEqual({ name: 'club', id: 'k1' });
    expect(parseRoute('#/studio/c1?photo=i1')).toEqual({ name: 'studio', id: 'c1' });
  });

  it('is dropped by withoutPhotoPointer and by nothing else', () => {
    expect(withoutPhotoPointer({ name: 'glaze', id: 'g1', photo: 'i1' })).toEqual({ name: 'glaze', id: 'g1' });
    expect(withoutPhotoPointer({ name: 'combination', id: 'c1', photo: 'i1' })).toEqual({ name: 'combination', id: 'c1' });
    expect(withoutPhotoPointer({ name: 'glaze', id: 'g1' })).toEqual({ name: 'glaze', id: 'g1' });
    expect(withoutPhotoPointer({ ...home, q: 'a' })).toEqual({ ...home, q: 'a' });
  });
});
