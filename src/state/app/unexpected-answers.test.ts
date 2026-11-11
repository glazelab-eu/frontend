import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { readSnapshot } from '../../lib/offline/snapshots';
import { cachesDeleted, flat, glaze, loaded, routes, stubBrowser, useMockApi, user } from './test-helpers';

useMockApi();

const lastUserKey = 'glazelab:v1:lastUser';
/** What the API's tarpit, a proxy or a captive portal may answer with status 200: never the API's data. */
const decoy = () => new Response(new Uint8Array([1, 2, 3, 4, 250, 251]), { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });
const portal = () => new Response('<html>Sign in to the Wi-Fi</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
const privateJar = { id: 's1', glazeId: glaze.id, quantityG: 100, manufacturer: 'M', name: 'Private jar' };

describe('a 200 answer that is not the API data', () => {
  for (const [name, answer] of [
    ['an octet-stream decoy', decoy],
    ['an HTML page', portal],
    ['JSON that is no account', () => Response.json({ ok: true })],
    ['an empty JSON array', () => Response.json([])],
  ] as const) {
    it(`on /me (${name}) keeps the account, its saved data and its photo cache`, async () => {
      const { app } = await loaded();
      cachesDeleted.length = 0;
      routes['GET /api/auth/me'] = answer;
      await app.refresh();
      const state = flat(get(app.state));
      expect(state.user?.id).toBe(user.id);
      expect(JSON.parse(localStorage.getItem(lastUserKey) ?? 'null')?.id).toBe(user.id);
      expect(await readSnapshot('u1')).not.toBeNull();
      expect(cachesDeleted).toEqual([]);
      expect(await readSnapshot(null)).toBeNull();
      expect(state.sync.failure).toBe('offline');
      expect(state.authOpen).toBe(false);
    });
  }

  it('on /me never moves the private listings to the guest snapshot that sign-out keeps', async () => {
    stubBrowser('#/stock');
    routes['GET /api/stock'] = () => Response.json([privateJar]);
    const { app } = await loaded();
    expect(get(app.state).stock).toHaveLength(1);
    routes['GET /api/auth/me'] = decoy;
    await app.refresh();
    expect(await readSnapshot(null)).toBeNull();
    routes['GET /api/auth/me'] = () => Response.json(user);
    await app.refresh();
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    vi.stubGlobal('navigator', { onLine: false });
    await app.logout();
    const after = flat(get(app.state));
    expect(after.user).toBeNull();
    expect(after.stock).toEqual([]);
    expect((await readSnapshot(null))?.stock ?? []).toEqual([]);
  });

  for (const [name, answer] of [
    ['an octet-stream decoy', decoy],
    ['JSON that is no listing', () => Response.json({ glazes: 'nope' })],
  ] as const) {
    it(`on the glaze listing (${name}) keeps the shown listing and a readable snapshot`, async () => {
      const { app } = await loaded();
      routes['GET /api/glazes'] = answer;
      await app.refresh();
      const state = flat(get(app.state));
      expect(state.glazes).toEqual([glaze]);
      expect(state.sync.failure).toBe('offline');
      expect((await readSnapshot('u1'))?.glazes).toEqual([glaze]);
    });
  }

  it('on the stock or the sync answer keeps the saved data', async () => {
    routes['GET /api/stock'] = () => Response.json([privateJar]);
    const { app } = await loaded();
    routes['GET /api/stock'] = portal;
    await app.refresh();
    expect(get(app.state).stock).toEqual([expect.objectContaining({ id: 's1' })]);
    expect((await readSnapshot('u1'))?.stock).toEqual([expect.objectContaining({ id: 's1' })]);
    routes['GET /api/stock'] = () => Response.json([privateJar]);
    routes['GET /api/sync'] = decoy;
    await app.refresh();
    expect(get(app.state).glazes).toEqual([glaze]);
    expect((await readSnapshot('u1'))?.glazes).toEqual([glaze]);
  });
});
