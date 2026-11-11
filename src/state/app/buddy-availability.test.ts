import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { readSnapshot } from '../../lib/offline/snapshots';
import { emptyAvailability } from '../../lib/stock/buddy-shelf';
import { stockItem } from '../../test/fixtures';
import { createAppController } from './app-controller';
import { flat, loaded, routes, unreachable, useMockApi, user } from './test-helpers';

useMockApi();

const ada = { id: 'u2', displayName: 'Ada', since: '2026-10-31T10:00:00Z' };
const lists = { buddies: [ada], incoming: [], outgoing: [], hasLink: true };
const availability = [{ glazeId: 'g1', buddies: [{ id: 'u2', displayName: 'Ada' }] }];
const DAY = Date.UTC(2026, 9, 31, 12);
const noContent = () => new Response(null, { status: 204 });

let reads: number;
beforeEach(() => {
  reads = 0;
  vi.stubGlobal('window', Object.assign(new EventTarget(), { scrollTo: vi.fn() }));
  vi.stubGlobal('location', { hash: '#/account', origin: 'https://glazelab.eu', pathname: '/' });
  routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
  routes['GET /api/buddies'] = () => Response.json(lists);
  routes['GET /api/buddies/availability'] = () => {
    reads++;
    return Response.json(availability);
  };
  vi.spyOn(Date, 'now').mockReturnValue(DAY);
});
afterEach(() => vi.restoreAllMocks());

describe('loading the buddy availability', () => {
  it('reads it with the other private listings and stamps the time of the read', async () => {
    const { state } = await loaded();
    expect(state.buddyAvailability).toEqual({ glazes: availability, asOf: DAY });
    expect(reads).toBe(1);
  });

  it('asks a guest for none', async () => {
    routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
    routes['GET /api/buddies/availability'] = () => {
      reads++;
      throw new Error('a guest has no buddies');
    };
    routes['GET /api/buddies'] = () => {
      throw new Error('a guest has no buddies');
    };
    const { state } = await loaded();
    expect(state.user).toBeNull();
    expect(state.buddyAvailability).toEqual(emptyAvailability());
    expect(reads).toBe(0);
  });

  it('keeps it in the snapshot with its time and shows it, as of then, when the API is unreachable', async () => {
    await loaded();
    expect((await readSnapshot(user.id))?.buddyAvailability).toEqual({ glazes: availability, asOf: DAY });
    for (const key of Object.keys(routes)) routes[key] = unreachable;
    vi.spyOn(Date, 'now').mockReturnValue(DAY + 3 * 86_400_000);
    const { state } = await loaded();
    expect(flat(state)).toMatchObject({ online: false, loadFailed: true, buddyAvailability: { glazes: availability, asOf: DAY } });
  });

  it('drops it with the account', async () => {
    const { app } = await loaded();
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u9' });
    routes['GET /api/buddies'] = () => Response.json({ ...lists, buddies: [] });
    routes['GET /api/buddies/availability'] = () => Response.json([]);
    await app.refresh();
    expect(get(app.state).buddyAvailability).toEqual({ glazes: [], asOf: DAY });
    expect((await readSnapshot('u9'))?.buddyAvailability.glazes).toEqual([]);
  });

  it("never keeps another account's availability when the new account's cannot be read", async () => {
    const { app } = await loaded();
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u9' });
    routes['GET /api/buddies'] = () => Response.json({ ...lists, buddies: [ada] });
    routes['GET /api/buddies/availability'] = () => Response.json({ error: 'Something went wrong.' }, { status: 500 });
    await app.refresh();
    expect(get(app.state).buddyAvailability).toEqual(emptyAvailability());
    expect((await readSnapshot('u9'))?.buddyAvailability).toEqual(emptyAvailability());
  });

  it('keeps the library and the availability on show when only the availability cannot be read', async () => {
    await loaded();
    routes['GET /api/buddies/availability'] = () => Response.json({ error: 'Something went wrong.' }, { status: 500 });
    vi.spyOn(Date, 'now').mockReturnValue(DAY + 86_400_000);
    const { state } = await loaded();
    expect(flat(state)).toMatchObject({ loadFailed: false, online: true, loading: false, buddyAvailability: { glazes: availability, asOf: DAY } });
  });
});

describe('a 401 on the availability read alone', () => {
  it('fails the load into the session check, which ends a session the server no longer knows', async () => {
    const { app } = await loaded();
    routes['GET /api/buddies/availability'] = () => Response.json({ error: 'Please sign in.' }, { status: 401 });
    routes['GET /api/auth/me'] = () => Response.json({ error: 'Please sign in.' }, { status: 401 });
    await app.refresh();
    expect(get(app.state)).toMatchObject({ user: null, authOpen: true, authNotice: 'sessionEnded', buddyAvailability: emptyAvailability() });
  });

  it('keeps the account signed in when the session check finds the session alive', async () => {
    const { app } = await loaded();
    routes['GET /api/buddies/availability'] = () => Response.json({ error: 'Please sign in.' }, { status: 401 });
    await app.refresh();
    expect(get(app.state)).toMatchObject({ user, authOpen: false, authNotice: null });
  });
});

describe('after a buddy changes', () => {
  it("reads the availability again, so a removed buddy's glazes go with the buddy", async () => {
    const { app } = await loaded();
    routes['DELETE /api/buddies/u2'] = () => {
      routes['GET /api/buddies'] = () => Response.json({ ...lists, buddies: [] });
      routes['GET /api/buddies/availability'] = () => Response.json([]);
      return noContent();
    };
    expect(await app.removeBuddy(ada)).toBe(true);
    expect(get(app.state)).toMatchObject({ buddies: { buddies: [] }, buddyAvailability: { glazes: [] } });
    expect((await readSnapshot(user.id))?.buddyAvailability.glazes).toEqual([]);
  });

  it("keeps no removed buddy's name or glazes on the device when the availability cannot be read again", async () => {
    const { app } = await loaded();
    routes['DELETE /api/buddies/u2'] = () => {
      routes['GET /api/buddies'] = () => Response.json({ ...lists, buddies: [] });
      routes['GET /api/buddies/availability'] = () => Response.json({ error: 'Something went wrong.' }, { status: 500 });
      return noContent();
    };
    expect(await app.removeBuddy(ada)).toBe(true);
    expect((await readSnapshot(user.id))?.buddyAvailability).toEqual({ glazes: [], asOf: DAY });
    // The next open, offline: nothing of Ada.
    for (const key of Object.keys(routes)) routes[key] = unreachable;
    const { state } = await loaded();
    expect(state).toMatchObject({ online: false, buddyAvailability: { glazes: [], asOf: DAY } });
  });

  it('follows a change of the lists that another device made when the account page opens', async () => {
    const { app } = await loaded();
    const ben = { id: 'u3', displayName: 'Ben', since: '2026-10-31T11:00:00Z' };
    routes['GET /api/buddies'] = () => Response.json({ ...lists, buddies: [ada, ben] });
    routes['GET /api/buddies/availability'] = () => Response.json([...availability, { glazeId: 'g2', buddies: [{ id: 'u3', displayName: 'Ben' }] }]);
    await app.reloadBuddies();
    expect(get(app.state).buddyAvailability.glazes.map((entry) => entry.glazeId)).toEqual(['g1', 'g2']);
  });
});

describe('Keep private', () => {
  const entry = stockItem({ id: 's1', glazeId: 'g1', quantityG: 400, keepPrivate: false });

  it('switches the entry on the server and in the listing, saved offline, with a notice', async () => {
    routes['GET /api/stock'] = () => Response.json([entry]);
    const { app } = await loaded();
    const sent: unknown[] = [];
    routes['PATCH /api/stock/s1'] = async (request) => {
      sent.push(await request.json());
      return Response.json({ ...entry, keepPrivate: true });
    };
    expect(await app.setKeepPrivate('s1', true)).toBe(true);
    expect(sent).toEqual([{ keepPrivate: true }]);
    expect(get(app.state)).toMatchObject({ stock: [{ id: 's1', keepPrivate: true }], toast: 'notices.keepPrivateOn' });
    expect((await readSnapshot(user.id))?.stock[0].keepPrivate).toBe(true);
    routes['PATCH /api/stock/s1'] = () => Response.json({ ...entry, keepPrivate: false });
    expect(await app.setKeepPrivate('s1', false)).toBe(true);
    expect(get(app.state)).toMatchObject({ stock: [{ id: 's1', keepPrivate: false }], toast: 'notices.keepPrivateOff' });
  });

  it('leaves the entry as it was when the server refuses, and reloads when the entry is gone', async () => {
    routes['GET /api/stock'] = () => Response.json([entry]);
    const { app } = await loaded();
    routes['PATCH /api/stock/s1'] = () => Response.json({ error: 'Stock entry not found' }, { status: 404 });
    routes['GET /api/stock'] = () => Response.json([]);
    expect(await app.setKeepPrivate('s1', true)).toBe(false);
    expect(get(app.state).stock).toEqual([]);
  });

  it('does nothing offline', async () => {
    routes['GET /api/stock'] = () => Response.json([entry]);
    const app = createAppController();
    await app.refresh();
    for (const key of Object.keys(routes)) routes[key] = unreachable;
    await app.refresh();
    routes['PATCH /api/stock/s1'] = () => {
      throw new Error('no request offline');
    };
    expect(await app.setKeepPrivate('s1', true)).toBe(false);
    expect(get(app.state).stock[0].keepPrivate).toBe(false);
  });
});
