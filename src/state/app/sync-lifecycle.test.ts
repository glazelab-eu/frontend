import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { deleteSnapshot, saveSnapshot } from '../../lib/offline/snapshots';
import { RETRY_DELAY_MS } from '../../lib/offline/grace';
import { createAppController } from './app-controller';
import { emptyAccountData, type AppState } from './app-state';
import { flat, glaze, loaded, nginx, routes, stockEntry, stubBrowser, useMockApi, user } from './test-helpers';

useMockApi();

async function settle(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
  for (let round = 0; round < 30; round++) {
    await new Promise((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(0);
  }
}

/** Every store update from now on. */
function updates(app: ReturnType<typeof createAppController>) {
  const seen: AppState[] = [];
  let first = true;
  const stop = app.state.subscribe((state) => {
    if (!first) seen.push(state);
    first = false;
  });
  return { seen, stop };
}

/** A request that waits until `release` is called. */
function held(key: string, answer: () => Response | Promise<Response>) {
  let release = () => {};
  const started = new Promise<void>((begin) => {
    routes[key] = () =>
      new Promise<Response>((resolve, reject) => {
        release = () => Promise.resolve(answer()).then(resolve, reject);
        begin();
      });
  });
  return { started, release: () => release() };
}

/** STATE-1b: the loading fields come from one sync state through the dispatcher (`step`), never from direct writes. */
describe('the sync lifecycle of the controller', () => {
  it('keeps loading through the patient retry, and the superseded load’s ending changes nothing', async () => {
    await deleteSnapshot('u1');
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    stubBrowser('#/');
    routes['GET /api/health'] = () => Response.json({ status: 'UP' });
    routes['GET /api/auth/options'] = () => Response.json({});
    let first = true;
    const retried = held('GET /api/auth/me', () => Response.json(user));
    const retry = routes['GET /api/auth/me'];
    routes['GET /api/auth/me'] = (request) => {
      if (!first) return retry(request);
      first = false;
      return Promise.reject(new TypeError('fetch failed'));
    };
    const app = createAppController();
    const { seen, stop: unsubscribe } = updates(app);
    const stop = app.start();
    try {
      await settle(0);
      expect(flat(get(app.state))).toMatchObject({ loading: true, loadFailed: false, online: true });
      await settle(RETRY_DELAY_MS);
      await retried.started;
      // The first load waits for its retry (`return load(…)`), whose `/me` is still out: nothing ended the loading state.
      expect(flat(get(app.state))).toMatchObject({ loading: true, syncing: false, loadFailed: false });
      expect(seen.every((state) => state.sync.phase === 'loading')).toBe(true);
      retried.release();
      await settle(0);
      expect(flat(get(app.state))).toMatchObject({ user, loading: false, syncing: false, loadFailed: false, glazes: [glaze] });
      // Once the retry showed its data the first load's own ending (dropped: it is superseded) patched nothing loading-related.
      const shown = seen.findIndex((state) => state.sync.phase !== 'loading');
      expect(seen.slice(shown).every((state) => state.sync.phase === 'idle' && !state.sync.failure)).toBe(true);
    } finally {
      unsubscribe();
      stop();
      vi.useRealTimers();
    }
  });

  it('shows a failed refresh over shown listings with its ending in one update', async () => {
    const { app } = await loaded();
    routes['GET /api/glazes'] = nginx(502);
    const { seen, stop } = updates(app);
    await app.refresh();
    stop();
    expect(flat(get(app.state))).toMatchObject({ loading: false, syncing: false, loadFailed: true, glazes: [glaze] });
    // Never "failed while still syncing": the failure and the end of the refresh are one patch.
    expect(seen.filter((state) => state.sync.failure && state.sync.phase === 'refreshing')).toEqual([]);
    expect(seen.filter((state) => state.sync.phase === 'refreshing')).not.toEqual([]);
  });

  it('drops everything a superseded load brings when its answers arrive, its ending too, while the newer load runs', async () => {
    const { app } = await loaded();
    const sync = routes['GET /api/sync'];
    const waiting: (() => void)[] = [];
    routes['GET /api/sync'] = (request) => new Promise<Response>((resolve) => waiting.push(() => resolve(sync(request) as Response)));
    const superseded = app.refresh();
    await vi.waitFor(() => expect(waiting).toHaveLength(1));
    const newer = app.refresh();
    await vi.waitFor(() => expect(waiting).toHaveLength(2));
    expect(flat(get(app.state))).toMatchObject({ loading: false, syncing: true });
    const { seen, stop } = updates(app);
    waiting[0]();
    await superseded;
    // The older load's answers and its `ended` are dropped: the newer load still shows that it runs.
    expect(seen).toEqual([]);
    expect(flat(get(app.state))).toMatchObject({ loading: false, syncing: true });
    waiting[1]();
    await newer;
    stop();
    expect(flat(get(app.state))).toMatchObject({ loading: false, syncing: false, loadFailed: false });
  });

  it('records the failure of a pending sign-out that a load sends again', async () => {
    stubBrowser('#/');
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['POST /api/auth/logout'] = () => Response.json({ error: 'Boom' }, { status: 500 });
    const { app } = await loaded();
    await app.logout();
    expect(flat(get(app.state))).toMatchObject({ user: null, loading: false, syncing: false });
    await app.refresh();
    expect(flat(get(app.state))).toMatchObject({ user: null, loading: false, syncing: false, loadFailed: true, loadFailure: 'server', online: false });
  });

  it('keeps loading through the snapshot read after a failure with nothing shown, so a snapshot saved meanwhile still shows', async () => {
    await deleteSnapshot('u1');
    // Another tab saves this account's snapshot while this tab's first load runs, which then fails.
    routes['GET /api/stock'] = async () => {
      await saveSnapshot('u1', { ...emptyAccountData(), glazes: [glaze] });
      return Response.json({ error: 'Boom' }, { status: 500 });
    };
    const app = createAppController();
    const { seen, stop } = updates(app);
    await app.refresh();
    stop();
    expect(flat(get(app.state))).toMatchObject({ user, loading: false, syncing: false, loadFailed: true, loadFailure: 'server', glazes: [glaze] });
    // Never "unavailable" over nothing before the snapshot read answered.
    expect(seen.filter((state) => state.sync.failure && state.sync.phase === 'idle' && !state.glazes.length)).toEqual([]);
  });

  it('shows the snapshot a load ends with as settled, never as refreshing', async () => {
    stubBrowser('#/');
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['POST /api/auth/logout'] = () => Response.json({ error: 'Boom' }, { status: 500 });
    const { app } = await loaded();
    await saveSnapshot(null, { ...emptyAccountData(), glazes: [glaze] });
    // Another tab signed out and could not tell the server: this load sends it again, fails and ends on the guest snapshot.
    localStorage.setItem('glazelab:v1:pendingLogout', '1');
    const { seen, stop } = updates(app);
    await app.refresh();
    stop();
    expect(flat(get(app.state))).toMatchObject({ user: null, loading: false, syncing: false, loadFailed: true, glazes: [glaze] });
    expect(seen.filter((state) => !state.user && state.sync.phase === 'refreshing')).toEqual([]);
  });

  it('loads again on a resume after a failed load, however recent the last good one', async () => {
    const { events } = stubBrowser('#/');
    const app = createAppController();
    const stop = app.start();
    try {
      await vi.waitFor(() => expect(flat(get(app.state))).toMatchObject({ user, loading: false, syncing: false }));
      const glazes = routes['GET /api/glazes'];
      // A server failure leaves the device online: only the failure asks for the load.
      routes['GET /api/glazes'] = () => Response.json({ error: 'Boom' }, { status: 500 });
      await app.refresh();
      expect(flat(get(app.state))).toMatchObject({ online: true, loadFailed: true });
      routes['GET /api/glazes'] = glazes;
      vi.stubGlobal('document', { visibilityState: 'visible' });
      events.dispatchEvent(new Event('visibilitychange'));
      await vi.waitFor(() => expect(flat(get(app.state))).toMatchObject({ loadFailed: false, syncing: false }));
    } finally {
      stop();
    }
  });

  describe('a sign-in that waited for the sign-out’s answer', () => {
    /** u1 signed out with its answer held; afterwards `/me` answers as a guest and counts its requests in `mes`. */
    async function signOutHeld() {
      stubBrowser('#/');
      routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
      const mes = { count: 0 };
      const logout = held('POST /api/auth/logout', () => {
        routes['GET /api/auth/me'] = () => (mes.count++, new Response(null, { status: 401 }));
        return new Response(null, { status: 200 });
      });
      const { app } = await loaded();
      const signingOut = app.logout();
      await logout.started;
      routes['POST /api/auth/login'] = () => Response.json({ error: 'Bad credentials' }, { status: 401 });
      return { app, mes, signingOut, release: logout.release };
    }
    const waitForSignIns = () => new Promise((resolve) => setTimeout(resolve, 20));

    it('never leaves the guest loading for good when it fails (no guest snapshot on this device)', async () => {
      const { app, mes, signingOut, release } = await signOutHeld();
      // The sign-out's answer then sees a sign-in under way and leaves the load to it.
      const signingIn = app.submitAuth({ mode: 'login', email: 'a@b.c', password: 'wrong' });
      await waitForSignIns();
      release();
      expect(await signingIn).toBe('failed');
      await signingOut;
      await vi.waitFor(() => expect(flat(get(app.state))).toMatchObject({ user: null, loading: false, syncing: false, glazes: [glaze] }));
      expect(mes.count).toBe(1);
      // A later failed sign-in loads nothing more: a load has run since the sign-out.
      expect(await app.submitAuth({ mode: 'login', email: 'a@b.c', password: 'wrong' })).toBe('failed');
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(mes.count).toBe(1);
    });

    it('loads the guest only once the last of two sign-ins failed', async () => {
      const { app, mes, signingOut, release } = await signOutHeld();
      const link = held('POST /api/auth/magic/confirm', () => Response.json({ error: 'Link expired' }, { status: 410 }));
      const signingIn = app.submitAuth({ mode: 'login', email: 'a@b.c', password: 'wrong' });
      const linking = app.confirmAccountLink('login', 'tok');
      await waitForSignIns();
      release();
      expect(await signingIn).toBe('failed');
      await link.started;
      await signingOut;
      await new Promise((resolve) => setTimeout(resolve, 20));
      // The link's sign-in still runs: no load asks the server meanwhile.
      expect(mes.count).toBe(0);
      link.release();
      expect(await linking).toBe('failed');
      await vi.waitFor(() => expect(flat(get(app.state))).toMatchObject({ user: null, loading: false, glazes: [glaze] }));
      expect(mes.count).toBe(1);
    });

    it('adds no load of its own when it succeeds (its caller loads)', async () => {
      const { app, mes, signingOut, release } = await signOutHeld();
      // A guest snapshot on this device: the sign-out shows it, so a load the sign-in added would ask `/me` again.
      await saveSnapshot(null, { ...emptyAccountData(), glazes: [glaze] });
      routes['POST /api/auth/login'] = () => {
        routes['GET /api/auth/me'] = () => (mes.count++, Response.json({ ...user, id: 'u2' }));
        return new Response(null, { status: 200 });
      };
      const signingIn = app.submitAuth({ mode: 'login', email: 'b@b.c', password: 'secret' });
      await waitForSignIns();
      release();
      expect(await signingIn).toBe('done');
      await signingOut;
      expect(get(app.state).user).toMatchObject({ id: 'u2' });
      expect(mes.count).toBe(1);
    });
  });

  describe('a previous account’s failure', () => {
    /** u1 signed in, its last refresh failed. */
    async function failedRefresh() {
      const { app } = await loaded();
      const glazes = routes['GET /api/glazes'];
      routes['GET /api/glazes'] = nginx(502);
      await app.refresh();
      routes['GET /api/glazes'] = glazes;
      expect(flat(get(app.state))).toMatchObject({ user, loadFailed: true });
      return app;
    }

    it('is forgotten by a sign-out the server could not confirm, with any progress', async () => {
      stubBrowser('#/');
      routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
      routes['POST /api/auth/logout'] = () => Response.json({ error: 'Boom' }, { status: 500 });
      const app = await failedRefresh();
      await app.logout();
      expect(flat(get(app.state))).toMatchObject({ user: null, loading: false, syncing: false, syncProgress: null, loadFailed: false });
    });

    it('is forgotten when another account signs in, while its load runs', async () => {
      stubBrowser('#/');
      routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
      const app = await failedRefresh();
      const other = { ...user, id: 'u2' };
      routes['POST /api/auth/login'] = () => {
        routes['GET /api/auth/me'] = () => Response.json(other);
        return new Response(null, { status: 200 });
      };
      const stock = held('GET /api/stock', () => Response.json([]));
      const signingIn = app.submitAuth({ mode: 'login', email: 'b@b.c', password: 'secret' });
      await stock.started;
      expect(flat(get(app.state))).toMatchObject({ user: other, loading: true, loadFailed: false });
      stock.release();
      await signingIn;
      expect(flat(get(app.state))).toMatchObject({ user: other, loading: false, loadFailed: false });
    });

    it('is forgotten before the failure that comes in the same patch as the account change', async () => {
      stubBrowser('#/');
      routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
      routes['POST /api/auth/logout'] = () => Response.json({ error: 'Boom' }, { status: 500 });
      const { app } = await loaded();
      // Another tab signed out and could not tell the server: this tab's load sends it again, fails, and shows the guest.
      localStorage.setItem('glazelab:v1:pendingLogout', '1');
      await app.refresh();
      expect(flat(get(app.state))).toMatchObject({ user: null, loading: false, syncing: false, loadFailed: true, loadFailure: 'server' });
    });

    it('takes the signed-out account’s listings with it when the pending sign-out that a load sends again fails', async () => {
      stubBrowser('#/');
      routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
      routes['POST /api/auth/logout'] = () => Response.json({ error: 'Boom' }, { status: 500 });
      routes['GET /api/stock'] = () => Response.json([stockEntry]);
      routes['GET /api/favorites'] = () => Response.json({ glazeIds: [glaze.id], combinationIds: [] });
      const { app } = await loaded();
      expect(get(app.state)).toMatchObject({ user, stock: [stockEntry], favorites: { glazeIds: [glaze.id] } });
      // Another tab signed out and could not tell the server; no guest snapshot on this device.
      localStorage.setItem('glazelab:v1:pendingLogout', '1');
      await app.refresh();
      // The guest never sees the signed-out account's private listings (LOGOUT-1: they leave the state with the account).
      expect(get(app.state)).toMatchObject({ user: null, glazes: [], combinations: [], stock: [], favorites: { glazeIds: [] } });
    });
  });
});
