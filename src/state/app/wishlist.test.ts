import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { club, clubMember, wishlistEntry } from '../../test/fixtures';
import { loaded, routes, useMockApi } from './test-helpers';

useMockApi();

const member = club({ id: 'c1' });
const list = (...entries: ReturnType<typeof wishlistEntry>[]) => ({ entries, openLimit: 100 });

function inClub() {
  routes['GET /api/clubs'] = () => Response.json([member]);
  routes['GET /api/clubs/c1/members'] = () => Response.json([clubMember({ id: 'u1' })]);
  routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
}

describe('the club wishlist actions', () => {
  it('read a club wishlist into memory only, never into the snapshot shape', async () => {
    inClub();
    routes['GET /api/clubs/c1/wishlist'] = () => Response.json(list(wishlistEntry()));
    const { app } = await loaded();
    expect(await app.loadWishlist('c1')).toBe(true);
    expect(get(app.state).clubWishlists.c1.entries.map((entry) => entry.id)).toEqual(['w1']);
  });

  it('show a failed read at the wishlist and keep nothing', async () => {
    inClub();
    routes['GET /api/clubs/c1/wishlist'] = () => Response.json({ error: 'Request failed.' }, { status: 500 });
    const { app } = await loaded();
    expect(await app.loadWishlist('c1')).toBe(false);
    expect(get(app.state).clubWishlists.c1).toBeUndefined();
    expect(get(app.state).formError?.form).toBe('wishlist-load');
  });

  it('add the answered entry in place and say so', async () => {
    inClub();
    routes['GET /api/clubs/c1/wishlist'] = () => Response.json(list(wishlistEntry()));
    let sent: unknown;
    routes['POST /api/clubs/c1/wishlist'] = async (request) => {
      sent = await request.json();
      return Response.json(wishlistEntry({ id: 'w2', type: 'GLAZE', glazeId: 'g1', link: null, name: 'Blue' }));
    };
    const { app } = await loaded();
    await app.loadWishlist('c1');
    expect(await app.addWishlistEntry('c1', { type: 'GLAZE', glazeId: 'g1', note: null })).toBe(true);
    expect(sent).toEqual({ type: 'GLAZE', glazeId: 'g1', note: null });
    const state = get(app.state);
    expect(state.clubWishlists.c1.entries.map((entry) => entry.id)).toEqual(['w1', 'w2']);
    expect(state.toast).toBe('notices.wishlistAdded');
  });

  it('read the list again when the API refuses an addition as stale, and show the refusal at the dialog', async () => {
    inClub();
    let shown = list(wishlistEntry());
    routes['GET /api/clubs/c1/wishlist'] = () => Response.json(shown);
    routes['POST /api/clubs/c1/wishlist'] = () => Response.json({ error: 'This glaze is already on the wishlist.' }, { status: 409 });
    const { app } = await loaded();
    await app.loadWishlist('c1');
    shown = list(wishlistEntry(), wishlistEntry({ id: 'w9', type: 'GLAZE', glazeId: 'g1' }));
    expect(await app.addWishlistEntry('c1', { type: 'GLAZE', glazeId: 'g1', note: null })).toBe(false);
    const state = get(app.state);
    expect(state.formError).toEqual({ form: 'wishlist-add', message: 'This glaze is already on the wishlist.' });
    expect(state.clubWishlists.c1.entries.map((entry) => entry.id)).toEqual(['w1', 'w9']);
  });

  it('remove an entry and mark one acquired with what the API answers', async () => {
    inClub();
    routes['GET /api/clubs/c1/wishlist'] = () => Response.json(list(wishlistEntry(), wishlistEntry({ id: 'w2' })));
    routes['DELETE /api/clubs/c1/wishlist/w1'] = () => new Response(null, { status: 204 });
    routes['PUT /api/clubs/c1/wishlist/w2/acquired'] = () => Response.json(wishlistEntry({ id: 'w2', acquiredAt: '2026-11-10T10:00:00Z' }));
    const { app } = await loaded();
    await app.loadWishlist('c1');
    expect(await app.removeWishlistEntry('c1', 'w1')).toBe(true);
    expect(get(app.state).toast).toBe('notices.wishlistRemoved');
    expect(await app.setWishlistAcquired('c1', 'w2', true)).toBe(true);
    const state = get(app.state);
    expect(state.clubWishlists.c1.entries).toEqual([wishlistEntry({ id: 'w2', acquiredAt: '2026-11-10T10:00:00Z' })]);
    expect(state.toast).toBe('notices.wishlistAcquired');
  });

  it('show a refused removal at the wishlist after reading it again', async () => {
    inClub();
    let shown = list(wishlistEntry({ canManage: true }));
    routes['GET /api/clubs/c1/wishlist'] = () => Response.json(shown);
    routes['DELETE /api/clubs/c1/wishlist/w1'] = () =>
      Response.json({ error: 'Only a club admin or the member who added it can change this entry' }, { status: 403 });
    const { app } = await loaded();
    await app.loadWishlist('c1');
    shown = list(wishlistEntry({ canManage: false }));
    expect(await app.removeWishlistEntry('c1', 'w1')).toBe(false);
    const state = get(app.state);
    expect(state.formError?.form).toBe('wishlist-remove');
    expect(state.clubWishlists.c1.entries[0].canManage).toBe(false);
  });

  it('write nothing offline', async () => {
    inClub();
    routes['GET /api/clubs/c1/wishlist'] = () => Response.json(list(wishlistEntry()));
    const { app } = await loaded();
    await app.loadWishlist('c1');
    routes['GET /api/health'] = () => Promise.reject(new TypeError('fetch failed'));
    routes['GET /api/auth/me'] = () => Promise.reject(new TypeError('fetch failed'));
    await app.refresh();
    expect(get(app.state).online).toBe(false);
    expect(await app.removeWishlistEntry('c1', 'w1')).toBe(false);
    expect(get(app.state).clubWishlists.c1.entries).toHaveLength(1);
  });

  it('forget the wishlist of a club the account leaves', async () => {
    inClub();
    routes['GET /api/clubs/c1/wishlist'] = () => Response.json(list(wishlistEntry()));
    routes['DELETE /api/clubs/c1/members/u1'] = () => new Response(null, { status: 204 });
    const { app } = await loaded();
    await app.loadWishlist('c1');
    routes['GET /api/clubs'] = () => Response.json([]);
    expect(await app.leaveClub('c1')).toBe(true);
    expect(get(app.state).clubWishlists).toEqual({});
    // A late answer for a club the account no longer has is dropped.
    expect(await app.loadWishlist('c1')).toBe(true);
    expect(get(app.state).clubWishlists).toEqual({});
  });
});
