import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBObjectStore } from 'fake-indexeddb';
import { deleteSnapshot, readSnapshot } from '../../lib/offline/snapshots';
import { get } from 'svelte/store';
import { imageUrl, networkReachable } from '../../lib/offline/offline';
import { ACCESS_DENIED, TOO_MANY_REQUESTS } from '../../lib/api/client';
import { findItem } from '../../lib/routing/routes';
import { createAppController } from './app-controller';
import { termsPending } from './app-state';
import { termsVersion } from '../../lib/api/terms';
import { GRACE_MS, RETRY_DELAY_MS } from '../../lib/offline/grace';
import {
  cachesDeleted,
  created,
  flat,
  glaze,
  healthy,
  loaded,
  nginx,
  routes,
  stockEntry,
  stubBrowser,
  tooMany,
  unreachable,
  useMockApi,
  user,
} from './test-helpers';

useMockApi();

/**
 * Lets the controller's IndexedDB work finish under fake timers: fake-indexeddb runs on real `setImmediate`, which
 * `advanceTimersByTimeAsync` does not drive, and the start reads the snapshot before it asks the server.
 */
async function settle(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
  for (let round = 0; round < 30; round++) {
    await new Promise((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(0);
  }
}

describe('load error states', () => {
  it('shows fresh data and reports unknown items as missing after a successful load', async () => {
    const { state } = await loaded();
    expect(flat(state)).toMatchObject({ user, online: true, loading: false, loadFailed: false });
    expect(findItem(state.glazes, 'g1', state.sync).status).toBe('found');
    expect(findItem(state.glazes, 'unknown', state.sync).status).toBe('missing');
  });

  it('falls back to the saved snapshot when the API is unreachable', async () => {
    for (const key of Object.keys(routes)) routes[key] = unreachable;
    const { state } = await loaded();
    expect(flat(state)).toMatchObject({
      user,
      online: false,
      loading: false,
      loadFailed: true,
      loadFailure: 'offline',
    });
    expect(state.glazes).toEqual([glaze]);
    expect(findItem(state.glazes, 'g1', state.sync).status).toBe('found');
    expect(findItem(state.glazes, 'unknown', state.sync).status).toBe('unavailable');
  });

  it('asks for no picture that is not saved while the app is offline, and does once it is back', async () => {
    const requested: string[] = [];
    routes['GET /api/images/i1'] = () => {
      requested.push('i1');
      return new Response(new Blob(['jpeg'], { type: 'image/jpeg' }));
    };
    for (const key of Object.keys(routes)) if (!key.includes('/api/images/')) routes[key] = unreachable;
    const { app } = await loaded();
    expect(get(app.state).online).toBe(false);
    expect(await imageUrl('/api/images/i1', user.id)).toBeNull();
    expect(requested).toEqual([]);
    networkReachable.set(true);
    expect(await imageUrl('/api/images/i1', user.id)).toMatch(/^blob:/);
    expect(requested).toEqual(['i1']);
  });

  it.each([502, 503, 504])('keeps the session and saved data on an nginx %i HTML page', async (status) => {
    routes['GET /api/auth/me'] = nginx(status);
    const { state } = await loaded();
    expect(flat(state)).toMatchObject({ user, online: false, loadFailed: true });
    expect(state.glazes).toEqual([glaze]);
    expect(findItem(state.glazes, 'unknown', state.sync).status).toBe('unavailable');
  });

  it('keeps the session when the API reports a 5xx error message', async () => {
    routes['GET /api/auth/me'] = () => Response.json({ error: 'Boom' }, { status: 500 });
    const { state } = await loaded();
    expect(flat(state)).toMatchObject({ user, online: true, loadFailed: true, loadFailure: 'server' });
    expect(state.glazes).toEqual([glaze]);
  });

  it('reports a failed data load and recovers on retry', async () => {
    routes['GET /api/glazes'] = () => Response.json({ error: 'Boom' }, { status: 503 });
    const { app, state } = await loaded();
    expect(flat(state)).toMatchObject({ user, online: true, loadFailed: true, error: 'Boom' });
    expect(state.glazes).toEqual([glaze]);

    routes['GET /api/glazes'] = healthy['GET /api/glazes'];
    await app.refresh();
    expect(flat(get(app.state))).toMatchObject({ loadFailed: false, online: true, error: '' });
  });

  it('shows nothing private when unreachable without a saved session', async () => {
    localStorage.removeItem('glazelab:v1:lastUser');
    for (const key of Object.keys(routes)) routes[key] = nginx(502);
    const { state } = await loaded();
    expect(flat(state)).toMatchObject({ user: null, loadFailed: true, stock: [], clubs: [] });
    expect(findItem(state.glazes, 'g1', state.sync).status).toBe('unavailable');
  });
});

describe('rate limiting', () => {
  it('keeps the session, saved data and online state when /me is rate limited', async () => {
    routes['GET /api/auth/me'] = tooMany;
    const { state } = await loaded();
    expect(flat(state)).toMatchObject({ user, loadFailed: true, loadFailure: 'rateLimited' });
    expect(flat(state)).toMatchObject({ user, online: true, loadFailed: true, error: TOO_MANY_REQUESTS });
    expect(state.glazes).toEqual([glaze]);
    expect(findItem(state.glazes, 'unknown', state.sync).status).toBe('unavailable');
    expect(cachesDeleted).toEqual([]);
    expect(localStorage.getItem('glazelab:v1:lastUser')).not.toBeNull();
    expect(await readSnapshot('u1')).not.toBeNull();
  });

  it('keeps the saved data when a listing is rate limited and recovers on retry', async () => {
    routes['GET /api/sync/combinations'] = tooMany;
    const { app, state } = await loaded();
    expect(flat(state)).toMatchObject({ user, online: true, loadFailed: true, error: TOO_MANY_REQUESTS });
    expect(state.glazes).toEqual([glaze]);

    routes['GET /api/sync/combinations'] = healthy['GET /api/sync/combinations'];
    await app.refresh();
    expect(flat(get(app.state))).toMatchObject({ user, loadFailed: false, online: true, error: '' });
  });

  it('reports a rate-limited write without signing out', async () => {
    const { app } = await loaded();
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['POST /api/glazes'] = tooMany;
    expect(await app.addGlaze({ manufacturerId: 'm1', name: 'Red', code: 'PC-21' })).toBeNull();
    expect(get(app.state)).toMatchObject({ user, online: true, error: '' });
    expect(get(app.state).formError).toEqual({ form: 'glaze', message: TOO_MANY_REQUESTS });
  });

  it('does not go offline when the health poll is rate limited', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    vi.stubGlobal('window', Object.assign(new EventTarget(), { scrollTo: vi.fn() }));
    vi.stubGlobal('location', { hash: '#/' });
    vi.stubGlobal('navigator', { onLine: true });
    const app = createAppController();
    const stop = app.start();
    try {
      await app.refresh();
      routes['GET /api/health'] = tooMany;
      await vi.advanceTimersByTimeAsync(15000);
      expect(flat(get(app.state))).toMatchObject({ user, online: true, loadFailed: false });

      routes['GET /api/health'] = unreachable;
      await vi.advanceTimersByTimeAsync(15000);
      expect(get(app.state).online).toBe(false);
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it('leaves offline mode when the API answers although the device reports offline', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    vi.stubGlobal('window', Object.assign(new EventTarget(), { scrollTo: vi.fn() }));
    vi.stubGlobal('location', { hash: '#/' });
    vi.stubGlobal('navigator', { onLine: false });
    routes['GET /api/health'] = () => Response.json({ status: 'UP' });
    const app = createAppController();
    const stop = app.start();
    try {
      await settle();
      expect(flat(get(app.state))).toMatchObject({ online: false, loadFailed: true });
      await settle(15000);
      expect(flat(get(app.state))).toMatchObject({ user, online: true, loadFailed: false });
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it('tries the API on a manual retry although the device reports offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const app = createAppController();
    await app.refresh();
    expect(flat(get(app.state))).toMatchObject({ online: false, loadFailed: true });
    await app.retry();
    expect(flat(get(app.state))).toMatchObject({ user, online: true, loadFailed: false });
  });
});

describe('terms acceptance', () => {
  const outdated = { ...user, siteAdmin: false, acceptedTermsVersion: null };
  const accepted = { ...outdated, acceptedTermsVersion: termsVersion };
  const refused = () => Response.json({ error: 'Please accept the updated terms of service to continue.' }, { status: 428 });

  beforeEach(() => {
    routes['GET /api/auth/me'] = () => Response.json(outdated);
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
  });

  it('keeps the session after a refused write and records the current version on acceptance', async () => {
    routes['POST /api/clubs'] = refused;
    const { app, state } = await loaded();
    expect(termsPending(state)).toBe(true);
    expect(await app.createClub('Kiln')).toBeNull();
    expect(get(app.state)).toMatchObject({
      user: outdated,
      online: true,
      termsRequired: true,
      error: '',
      formError: {
        form: 'club',
        message: 'Please accept the updated terms of service to continue.',
      },
    });
    let sent: unknown;
    routes['POST /api/auth/terms'] = async (request) => {
      sent = await request.json();
      return Response.json(accepted);
    };
    expect(await app.acceptTerms()).toBe(true);
    expect(sent).toEqual({ termsVersion });
    expect(get(app.state)).toMatchObject({
      user: accepted,
      termsRequired: false,
      error: '',
      formError: null,
      toast: 'notices.termsAccepted',
    });
    expect(termsPending(get(app.state))).toBe(false);
    expect(JSON.parse(localStorage.getItem('glazelab:v1:lastUser')!)).toEqual(accepted);
  });

  it('accepts even when the device cannot remember the account, and says that storage failed (STATE-1a review)', async () => {
    routes['POST /api/auth/terms'] = () => Response.json(accepted);
    const { app } = await loaded();
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    try {
      expect(await app.acceptTerms()).toBe(true);
    } finally {
      setItem.mockRestore();
    }
    expect(get(app.state)).toMatchObject({ user: accepted, termsRequired: false, storageWarning: true, error: '', toast: 'notices.termsAccepted' });
  });

  it('keeps asking when acceptance fails, and never accepts offline or signed out', async () => {
    let calls = 0;
    routes['POST /api/auth/terms'] = () => {
      calls++;
      return Response.json({ error: 'Please accept the current terms of service.' }, { status: 400 });
    };
    const { app } = await loaded();
    expect(await app.acceptTerms()).toBe(false);
    // The dialog's own refusal stays in the dialog: the banner's error is anything else's (a failed load) and never takes its focus.
    expect(get(app.state)).toMatchObject({ error: '', formError: { form: 'terms', message: 'Please accept the current terms of service.' } });
    expect(termsPending(get(app.state))).toBe(true);
    vi.stubGlobal('navigator', { onLine: false });
    await app.refresh();
    expect(await app.acceptTerms()).toBe(false);
    vi.stubGlobal('navigator', { onLine: true });
    routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
    await app.refresh();
    expect(await app.acceptTerms()).toBe(false);
    expect(calls).toBe(1);
  });

  it('forgets a refused write on account change and ignores a late acceptance', async () => {
    routes['POST /api/clubs'] = refused;
    let answer!: () => void;
    routes['POST /api/auth/terms'] = () =>
      new Promise<Response>((done) => {
        answer = () => done(Response.json(accepted));
      });
    const { app } = await loaded();
    await app.createClub('Kiln');
    const pending = app.acceptTerms();
    await vi.waitFor(() => expect(answer).toBeDefined());
    const other = { ...accepted, id: 'u2' };
    routes['GET /api/auth/me'] = () => Response.json(other);
    await app.refresh();
    expect(get(app.state).termsRequired).toBe(false);
    answer();
    expect(await pending).toBe(false);
    expect(get(app.state)).toMatchObject({ user: other, toast: '' });
  });
});

describe('IndexedDB persistence', () => {
  it('keeps successful online loads and writes successful when storage is full', async () => {
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    const { app, state } = await loaded();
    expect(flat(state)).toMatchObject({
      user,
      online: true,
      loadFailed: false,
      storageWarning: true,
      glazes: [glaze],
      error: '',
    });
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['POST /api/glazes'] = created;
    expect((await app.addGlaze({ manufacturerId: 'm1', name: 'Blue', code: 'PC-20' }))?.id).toBe('g1');
    expect(flat(get(app.state))).toMatchObject({
      online: true,
      loadFailed: false,
      storageWarning: true,
      error: '',
    });
  });

  it('clears the storage notice after the next successful snapshot save', async () => {
    // The snapshot itself fails to save (key 'u1'); the pages of the full load beside it do not.
    const save = IDBObjectStore.prototype.put;
    let failing = true;
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (failing && key === 'u1') {
        failing = false;
        throw new DOMException('Blocked', 'UnknownError');
      }
      return save.call(this, value, key);
    });
    const { app, state } = await loaded();
    expect(state.storageWarning).toBe(true);
    put.mockRestore();
    await app.refresh();
    expect(get(app.state).storageWarning).toBe(false);
  });

  it('clears the storage notice on dismissal and on account change', async () => {
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    const { app } = await loaded();
    app.dismissStorageWarning();
    expect(get(app.state).storageWarning).toBe(false);
    await app.refresh();
    expect(get(app.state).storageWarning).toBe(true);
    const states: boolean[] = [];
    const unsubscribe = app.state.subscribe((state) => {
      if (state.user?.id === 'u2') states.push(state.storageWarning);
    });
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2' });
    await app.refresh();
    unsubscribe();
    // The new account starts without the old notice; only its own failed save raises it again.
    expect(states[0]).toBe(false);
  });

  it('continues online when IndexedDB and localStorage are unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('Disabled');
      },
      setItem: () => {
        throw new Error('Disabled');
      },
    });
    const { state } = await loaded();
    expect(flat(state)).toMatchObject({
      user,
      online: true,
      loading: false,
      loadFailed: false,
      storageWarning: true,
      glazes: [glaze],
    });
  });

  it('restores offline data before ending the loading state without making API calls', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const fetch = vi.spyOn(globalThis, 'fetch');
    const app = createAppController();
    const states: { loading: boolean; count: number }[] = [];
    const unsubscribe = app.state.subscribe((state) => states.push({ loading: flat(state).loading, count: state.glazes.length }));
    await app.refresh();
    unsubscribe();
    expect(fetch).not.toHaveBeenCalled();
    expect(flat(get(app.state))).toMatchObject({ user, online: false, loading: false, glazes: [glaze] });
    expect(states.filter((state) => !state.loading).every((state) => state.count === 1)).toBe(true);
  });

  it.each([false, true])(
    'ends loading in the very state that brings the listings (offline %s), so cards waiting for it come with the list',
    async (offline) => {
      if (offline) vi.stubGlobal('navigator', { onLine: false });
      const app = createAppController();
      const states: { loading: boolean; count: number }[] = [];
      const unsubscribe = app.state.subscribe((state) => states.push({ loading: flat(state).loading, count: state.glazes.length }));
      await app.refresh();
      unsubscribe();
      expect(states.find((state) => state.count > 0)).toEqual({ loading: false, count: 1 });
    },
  );

  it('clears the previous account snapshot on account change', async () => {
    const { app } = await loaded();
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2' });
    await app.refresh();
    expect(await readSnapshot('u1')).toBeNull();
    expect(await readSnapshot('u2')).not.toBeNull();
  });

  it('finishes sign-out cleanup when a load starts while the logout request is pending', async () => {
    vi.stubGlobal('location', { hash: '#/' });
    const { app } = await loaded();
    let csrfRequests = 0;
    routes['GET /api/auth/csrf'] = () => {
      csrfRequests++;
      return Response.json({ token: `csrf-${csrfRequests}` });
    };
    let endSession!: () => void;
    routes['POST /api/auth/logout'] = () =>
      new Promise<Response>((resolve) => {
        endSession = () => {
          routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
          resolve(new Response(null, { status: 200 }));
        };
      });
    const signingOut = app.logout();
    await vi.waitFor(() => expect(endSession).toBeDefined());
    // A refresh (health poll, online event) waits for the same request instead of asking with the old session.
    const refreshing = app.refresh();
    endSession();
    await refreshing;
    await signingOut;
    expect(flat(get(app.state))).toMatchObject({
      user: null,
      loading: false,
      toast: 'notices.signedOut',
    });
    expect(localStorage.getItem('glazelab:v1:lastUser')).toBeNull();
    expect(await readSnapshot('u1')).toBeNull();
    expect(cachesDeleted).toContain('glazelab-images-u1');
    // The old CSRF token died with the session; the next write fetches a new one.
    routes['POST /api/auth/login'] = (request) =>
      request.headers.get('X-XSRF-TOKEN') === 'csrf-2' ? new Response(null, { status: 200 }) : Response.json({ error: 'Invalid CSRF token' }, { status: 403 });
    routes['GET /api/auth/me'] = () => Response.json(user);
    expect(await app.submitAuth({ mode: 'login', email: 'a@b.c', password: 'secret' })).toBe('done');
  });

  it('completes a sign-out whose CSRF token another tab replaced', async () => {
    vi.stubGlobal('location', { hash: '#/' });
    const { app } = await loaded();
    let csrfRequests = 0;
    routes['GET /api/auth/csrf'] = () => Response.json({ token: `csrf-${++csrfRequests}` });
    routes['PUT /api/favorites/glazes/g1'] = () => new Response(null, { status: 204 });
    await app.setFavorite('glazes', 'g1', true);
    // Another tab signed in again: the cookie now matches only a fresh token.
    const logouts: (string | null)[] = [];
    routes['POST /api/auth/logout'] = (request) => {
      const token = request.headers.get('X-XSRF-TOKEN');
      logouts.push(token);
      if (token === 'csrf-1') return Response.json({ error: ACCESS_DENIED }, { status: 403 });
      routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
      return new Response(null, { status: 200 });
    };
    await app.logout();
    expect(logouts).toEqual(['csrf-1', 'csrf-2']);
    expect(flat(get(app.state))).toMatchObject({ user: null, online: true, toast: 'notices.signedOut' });
    expect(localStorage.getItem('glazelab:v1:pendingLogout')).toBeNull();
  });

  it('fetches a fresh token for the next sign-out attempt after a failed one', async () => {
    vi.stubGlobal('location', { hash: '#/' });
    const { app } = await loaded();
    let csrfRequests = 0;
    routes['GET /api/auth/csrf'] = () => Response.json({ token: `csrf-${++csrfRequests}` });
    const logouts: (string | null)[] = [];
    routes['POST /api/auth/logout'] = (request) => {
      logouts.push(request.headers.get('X-XSRF-TOKEN'));
      return Response.json({ error: 'Boom' }, { status: 500 });
    };
    await app.logout();
    expect(get(app.state).toast).toBe('notices.signedOutPending');
    routes['POST /api/auth/logout'] = (request) => {
      logouts.push(request.headers.get('X-XSRF-TOKEN'));
      routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
      return new Response(null, { status: 200 });
    };
    await app.refresh();
    expect(logouts).toEqual(['csrf-1', 'csrf-2']);
    expect(localStorage.getItem('glazelab:v1:pendingLogout')).toBeNull();
  });

  it('does not let a stale listing load resurrect data after logout', async () => {
    vi.stubGlobal('location', { hash: '#/' });
    const { app } = await loaded();
    let complete!: (response: Response) => void;
    let started!: () => void;
    const requested = new Promise<void>((resolve) => {
      started = resolve;
    });
    routes['GET /api/glazes'] = () =>
      new Promise<Response>((resolve) => {
        complete = resolve;
        started();
      });
    const refreshing = app.refresh();
    await requested;
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['POST /api/auth/logout'] = () => {
      routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
      routes['GET /api/glazes'] = () => Response.json([]);
      return new Response(null, { status: 200 });
    };
    await app.logout();
    complete(Response.json([glaze]));
    await refreshing;
    expect(flat(get(app.state))).toMatchObject({ user: null, glazes: [], loading: false });
    expect(await readSnapshot('u1')).toBeNull();
  });
});

describe('sign-out and the stored session', () => {
  const pendingKey = 'glazelab:v1:pendingLogout';
  const lastUserKey = 'glazelab:v1:lastUser';
  /** Counts the logout requests; the session check then answers signed out. */
  const countLogouts = () => {
    const calls = { count: 0 };
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['POST /api/auth/logout'] = () => {
      calls.count++;
      routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
      return new Response(null, { status: 200 });
    };
    return calls;
  };

  it('signs out offline without asking the API, forgets the account at once and remembers the pending logout', async () => {
    stubBrowser('#/stock');
    vi.stubGlobal('navigator', { onLine: false });
    const logouts = countLogouts();
    const { app } = await loaded();
    expect(get(app.state)).toMatchObject({ user, online: false });
    const states: { user: unknown; loading: boolean }[] = [];
    const unsubscribe = app.state.subscribe((state) => states.push({ user: state.user, loading: flat(state).loading }));
    await app.logout();
    unsubscribe();
    expect(logouts.count).toBe(0);
    // The first state without the account is already loading: nothing renders as a settled guest before the cleanup ends.
    expect(states.find((state) => state.user === null)).toEqual({ user: null, loading: true });
    expect(flat(get(app.state))).toMatchObject({ user: null, loading: false, stock: [], toast: 'notices.signedOutOffline' });
    expect(localStorage.getItem(pendingKey)).toBe('1');
    expect(localStorage.getItem(lastUserKey)).toBeNull();
    expect(await readSnapshot('u1')).toBeNull();
    expect(cachesDeleted).toContain('glazelab-images-u1');
  });

  it('ends the remembered server session once on the next online load and then stops remembering it', async () => {
    const logouts = countLogouts();
    localStorage.setItem(pendingKey, '1');
    const { app, state } = await loaded();
    expect(logouts.count).toBe(1);
    expect(flat(state)).toMatchObject({ user: null, online: true, loading: false });
    expect(localStorage.getItem(pendingKey)).toBeNull();
    expect(localStorage.getItem(lastUserKey)).toBeNull();
    await app.refresh();
    expect(logouts.count).toBe(1);
  });

  it('forgets the stored account on the device when the session check answers signed out', async () => {
    routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
    const { state } = await loaded();
    expect(state.user).toBeNull();
    expect(localStorage.getItem(lastUserKey)).toBeNull();
    expect(await readSnapshot('u1')).toBeNull();
    expect(cachesDeleted).toContain('glazelab-images-u1');
  });

  /** Holds the logout answer until `answer` is called (never, if the test does not); `count` counts the requests. */
  const heldLogout = () => {
    const held = { count: 0, answer: (_: Response) => {} };
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['POST /api/auth/logout'] = () => {
      held.count++;
      return new Promise<Response>((resolve) => {
        held.answer = (response) => {
          if (response.ok) routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
          resolve(response);
        };
      });
    };
    return held;
  };

  it('signs out on the device at once while the server has not answered yet', async () => {
    stubBrowser('#/stock');
    const logouts = heldLogout();
    routes['GET /api/stock'] = () => Response.json([{ id: 's1', glazeId: 'g1', grams: 100 }]);
    const { app } = await loaded();
    expect(get(app.state).stock).toHaveLength(1);
    const asked: string[] = [];
    const fetched = globalThis.fetch;
    vi.stubGlobal('fetch', (request: Request) => (asked.push(`${request.method} ${new URL(request.url).pathname}`), fetched(request)));
    const signingOut = app.logout();
    // Synchronously, before the request or any storage is awaited.
    expect(flat(get(app.state))).toMatchObject({ user: null, stock: [], glazes: [], loading: true, signingOut: true });
    expect(localStorage.getItem(pendingKey)).toBe('1');
    await vi.waitFor(() => expect(localStorage.getItem(lastUserKey)).toBeNull());
    expect(await readSnapshot('u1')).toBeNull();
    expect(cachesDeleted).toContain('glazelab-images-u1');
    expect(location.hash).toBe('#/');
    // A load meanwhile shares the request: nothing is read with the session cookie that still names the account.
    void app.refresh();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(logouts.count).toBe(1);
    expect(asked.filter((path) => path !== 'GET /api/auth/csrf')).toEqual(['POST /api/auth/logout']);
    expect(get(app.state)).toMatchObject({ user: null, signingOut: true, toast: '' });
    // A second press does nothing.
    await app.logout();
    expect(logouts.count).toBe(1);
    logouts.answer(new Response(null, { status: 200 }));
    await signingOut;
    expect(flat(get(app.state))).toMatchObject({ user: null, loading: false, signingOut: false, toast: 'notices.signedOut' });
    expect(localStorage.getItem(pendingKey)).toBeNull();
    expect(logouts.count).toBe(1);
  });

  it('keeps the device signed out and the logout pending when the request fails, and sends it again at the next start', async () => {
    stubBrowser('#/stock');
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['POST /api/auth/logout'] = () => Response.json({ error: 'Boom' }, { status: 500 });
    const { app } = await loaded();
    await app.logout();
    expect(flat(get(app.state))).toMatchObject({ user: null, stock: [], loading: false, signingOut: false, error: '', toast: 'notices.signedOutPending' });
    expect(localStorage.getItem(pendingKey)).toBe('1');
    expect(localStorage.getItem(lastUserKey)).toBeNull();
    expect(await readSnapshot('u1')).toBeNull();
    // The next start (or the health poll) ends the server session before it asks who is signed in.
    const logouts = countLogouts();
    const next = await loaded();
    expect(logouts.count).toBe(1);
    expect(flat(next.state)).toMatchObject({ user: null, loading: false });
    expect(localStorage.getItem(pendingKey)).toBeNull();
  });

  it('finishes the clean-up at the next start when the page closed right after the press', async () => {
    // As the page left it: the logout pending, the account and its snapshot still on the device (see useMockApi).
    localStorage.setItem(pendingKey, '1');
    const logouts = countLogouts();
    const app = createAppController();
    const users: unknown[] = [];
    const unsubscribe = app.state.subscribe((state) => users.push(state.user));
    await app.refresh();
    unsubscribe();
    expect(users.every((shown) => shown === null)).toBe(true);
    expect(logouts.count).toBe(1);
    expect(localStorage.getItem(lastUserKey)).toBeNull();
    expect(await readSnapshot('u1')).toBeNull();
    expect(cachesDeleted).toContain('glazelab-images-u1');
  });

  it.each([
    ['answered', new Response(null, { status: 200 })],
    ['failed', Response.json({ error: 'Boom' }, { status: 500 })],
  ])('never ends a new sign-in with the sign-out that was pending before it (%s)', async (_, answer) => {
    stubBrowser('#/');
    const logouts = heldLogout();
    const { app } = await loaded();
    const signingOut = app.logout();
    await vi.waitFor(() => expect(logouts.count).toBe(1));
    let logins = 0;
    routes['POST /api/auth/login'] = () => {
      logins++;
      routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2' });
      return new Response(null, { status: 200 });
    };
    const signingIn = app.submitAuth({ mode: 'login', email: 'b@b.c', password: 'secret' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The sign-in waits for the old request: its answer clears the session cookie and must not land on the new session.
    expect(logins).toBe(0);
    logouts.answer(answer);
    expect(await signingIn).toBe('done');
    await signingOut;
    expect(logins).toBe(1);
    expect(localStorage.getItem(pendingKey)).toBeNull();
    await app.refresh();
    expect(logouts.count).toBe(1);
    expect(get(app.state)).toMatchObject({ user: { id: 'u2' }, signingOut: false, toast: 'notices.welcome' });
  });

  it('drops what a load started before the press answers afterwards', async () => {
    stubBrowser('#/stock');
    countLogouts();
    const { app } = await loaded();
    // A refresh is under way, its stock answer held until after the press.
    let answer!: () => void;
    routes['GET /api/stock'] = () => new Promise<Response>((resolve) => (answer = () => resolve(Response.json([{ id: 's9', glazeId: 'g1', quantityG: 100 }]))));
    const refreshing = app.refresh();
    await vi.waitFor(() => expect(answer).toBeDefined());
    const signingOut = app.logout();
    answer();
    await Promise.all([refreshing, signingOut]);
    expect(get(app.state)).toMatchObject({ user: null, stock: [] });
    expect(await readSnapshot('u1')).toBeNull();
  });

  it('lets an email sign-in link wait for the sign-out that was pending before it', async () => {
    stubBrowser('#/');
    const logouts = heldLogout();
    const { app } = await loaded();
    const signingOut = app.logout();
    await vi.waitFor(() => expect(logouts.count).toBe(1));
    let confirmed = 0;
    routes['POST /api/auth/magic/confirm'] = () => {
      confirmed++;
      routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2' });
      return Response.json({});
    };
    const linking = app.confirmAccountLink('login', 'tok');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(confirmed).toBe(0);
    logouts.answer(new Response(null, { status: 200 }));
    expect(await linking).toBe('used');
    await signingOut;
    expect(confirmed).toBe(1);
    expect(get(app.state).user).toMatchObject({ id: 'u2' });
  });

  it('forgets the account last of all, so a page closed during the clean-up finishes it at the next start', async () => {
    countLogouts();
    const { app } = await loaded();
    // The photo cache's removal never ends, as on a page closed meanwhile.
    vi.stubGlobal('caches', { delete: () => new Promise<boolean>(() => {}) });
    void app.logout();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(get(app.state).user).toBeNull();
    expect(localStorage.getItem(lastUserKey)).not.toBeNull();
  });

  it('marks the sign-out pending in memory before its first wait, so a load started meanwhile asks nothing before the sign-out answer, even when storage fails (STATE-1a review)', async () => {
    stubBrowser('#/');
    const { app } = await loaded();
    const order: string[] = [];
    routes['GET /api/auth/me'] = () => (order.push('me'), Response.json(user));
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['POST /api/auth/logout'] = () => {
      order.push('logout');
      // Only the sign-out ends the server session: an earlier `/me` would still name the account.
      routes['GET /api/auth/me'] = () => (order.push('me'), new Response(null, { status: 401 }));
      return new Response(null, { status: 200 });
    };
    // Device storage refuses the flag: only the memory knows the sign-out is pending.
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    try {
      const signingOut = app.logout();
      // A load that starts in the sign-out's first wait (an online event, the poll) sends the sign-out first, then asks.
      const refreshing = app.refresh();
      await Promise.all([signingOut, refreshing]);
    } finally {
      setItem.mockRestore();
    }
    expect(order[0]).toBe('logout');
    expect(get(app.state).user).toBeNull();
  });

  it('sends a sign-out another tab left pending, at this tab’s next load (STATE-1a review)', async () => {
    stubBrowser('#/');
    const { app } = await loaded();
    const logouts = countLogouts();
    // Another tab of this device signed out offline after this controller was built.
    localStorage.setItem(pendingKey, '1');
    await app.refresh();
    // Sent first, before asking who is signed in (the dead session then gets the logout once more, as any 401 does).
    expect(logouts.count).toBeGreaterThan(0);
    expect(localStorage.getItem(pendingKey)).toBeNull();
    expect(get(app.state).user).toBeNull();
  });

  it('sends no pending sign-out while a sign-in is under way', async () => {
    stubBrowser('#/');
    let logouts = 0;
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['POST /api/auth/logout'] = () => (logouts++, Response.json({ error: 'Boom' }, { status: 500 }));
    const { app } = await loaded();
    await app.logout();
    expect(localStorage.getItem(pendingKey)).toBe('1');
    let finishLogin!: () => void;
    routes['POST /api/auth/login'] = () =>
      new Promise<Response>((resolve) => {
        finishLogin = () => {
          routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2' });
          resolve(new Response(null, { status: 200 }));
        };
      });
    const signingIn = app.submitAuth({ mode: 'login', email: 'b@b.c', password: 'secret' });
    await vi.waitFor(() => expect(finishLogin).toBeDefined());
    // One more attempt before the sign-in; a load meanwhile (health poll) must not send another, whose answer would end the new session.
    expect(logouts).toBe(2);
    // Nor may it ask who is signed in: the cookie still names the old account, whose data would show again.
    const shown: (string | undefined)[] = [];
    const watch = app.state.subscribe((state) => shown.push(state.user?.id));
    await app.refresh();
    watch();
    expect(logouts).toBe(2);
    expect(shown.filter(Boolean)).toEqual([]);
    expect(get(app.state).stock).toEqual([]);
    finishLogin();
    expect(await signingIn).toBe('done');
    expect(get(app.state).user).toMatchObject({ id: 'u2' });
    expect(localStorage.getItem(pendingKey)).toBeNull();
  });
});

describe('connectivity listeners and the health poll', () => {
  /** A started controller on fake timers; `healthChecks` counts the poll's requests. */
  async function started() {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    const { events } = stubBrowser('#/');
    const healthChecks = { count: 0 };
    routes['GET /api/health'] = () => {
      healthChecks.count++;
      return Response.json({ status: 'UP' });
    };
    const app = createAppController();
    const stop = app.start();
    await settle();
    return { app, stop, events, healthChecks };
  }
  const setOnline = (events: EventTarget, onLine: boolean) => {
    vi.stubGlobal('navigator', { onLine });
    events.dispatchEvent(new Event(onLine ? 'online' : 'offline'));
  };

  it('goes offline on the offline event and reloads on the online event', async () => {
    const { app, stop, events } = await started();
    try {
      expect(get(app.state)).toMatchObject({ user, online: true });
      setOnline(events, false);
      expect(get(app.state)).toMatchObject({ user, online: false });
      setOnline(events, true);
      await settle();
      expect(flat(get(app.state))).toMatchObject({ user, online: true, loadFailed: false });
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it('keeps the offline state when a load that began before the offline event finishes after it', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    const { events } = stubBrowser('#/');
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    routes['GET /api/glazes'] = async () => {
      await gate;
      return Response.json([glaze]);
    };
    routes['GET /api/health'] = () => Response.json({ status: 'UP' });
    const app = createAppController();
    const stop = app.start();
    try {
      await settle();
      expect(flat(get(app.state))).toMatchObject({ user, online: true, syncing: true });
      setOnline(events, false);
      expect(get(app.state).online).toBe(false);
      // The answers that were already on their way arrive: the data is shown, but the device is still offline.
      release();
      await settle();
      expect(flat(get(app.state))).toMatchObject({ user, loading: false, syncing: false, online: false });
      // The health poll finds the API and loads again, which is the way back (a device that reports itself offline included).
      await settle(15000);
      expect(flat(get(app.state))).toMatchObject({ online: true, loadFailed: false });
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it('lets a load that began after the offline event bring the app back online', async () => {
    const { app, stop, events } = await started();
    try {
      setOnline(events, false);
      expect(get(app.state).online).toBe(false);
      // A manual retry reaches the API although the device reports offline (some VPN/VM adapters).
      await app.retry();
      expect(flat(get(app.state))).toMatchObject({ online: true, loadFailed: false });
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it('sends a pending sign-out from the health poll while the device stays online and nothing failed (STATE-1a review)', async () => {
    const { app, stop } = await started();
    try {
      let logouts = 0;
      routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
      routes['POST /api/auth/logout'] = () => (logouts++, Response.json({ error: 'Busy' }, { status: 503 }));
      await app.logout();
      await settle();
      expect(flat(get(app.state))).toMatchObject({ user: null, online: true, loadFailed: false });
      expect(logouts).toBe(1);
      routes['POST /api/auth/logout'] = () => {
        logouts++;
        routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
        return new Response(null, { status: 200 });
      };
      await settle(15000);
      // The server learns of the sign-out at the next poll, not only at the next start or connection change.
      expect(logouts).toBe(2);
      expect(localStorage.getItem('glazelab:v1:pendingLogout')).toBeNull();
      expect(get(app.state).user).toBeNull();
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it('asks nothing while the page is hidden and polls again once it is visible (FE-A4)', async () => {
    const { stop, events, healthChecks } = await started();
    try {
      vi.stubGlobal('document', { visibilityState: 'hidden' });
      events.dispatchEvent(new Event('visibilitychange'));
      await settle(45_000);
      expect(healthChecks.count).toBe(0);
      vi.stubGlobal('document', { visibilityState: 'visible' });
      events.dispatchEvent(new Event('visibilitychange'));
      await settle(15_000);
      expect(healthChecks.count).toBe(1);
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it('sends a pending sign-out at once when a hidden page becomes visible again (FE-A4)', async () => {
    const { app, stop, events } = await started();
    try {
      let logouts = 0;
      routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
      routes['POST /api/auth/logout'] = () => (logouts++, Response.json({ error: 'Busy' }, { status: 503 }));
      await app.logout();
      await settle();
      expect(logouts).toBe(1);
      routes['POST /api/auth/logout'] = () => {
        logouts++;
        routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
        return new Response(null, { status: 200 });
      };
      vi.stubGlobal('document', { visibilityState: 'hidden' });
      events.dispatchEvent(new Event('visibilitychange'));
      await settle(30_000);
      expect(logouts).toBe(1);
      vi.stubGlobal('document', { visibilityState: 'visible' });
      events.dispatchEvent(new Event('visibilitychange'));
      await settle(0);
      expect(logouts).toBe(2);
      expect(localStorage.getItem('glazelab:v1:pendingLogout')).toBeNull();
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it('reloads from the health poll after a server failure that left the device online', async () => {
    routes['GET /api/glazes'] = () => Response.json({ error: 'Boom' }, { status: 503 });
    const { app, stop, healthChecks } = await started();
    try {
      expect(flat(get(app.state))).toMatchObject({ online: true, loadFailed: true });
      routes['GET /api/glazes'] = healthy['GET /api/glazes'];
      await settle(15000);
      expect(healthChecks.count).toBe(1);
      expect(flat(get(app.state))).toMatchObject({ online: true, loadFailed: false, glazes: [glaze] });
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it('removes its listeners and the poll when stopped', async () => {
    const { app, stop, events, healthChecks } = await started();
    try {
      stop();
      const requests = vi.spyOn(globalThis, 'fetch');
      await vi.advanceTimersByTimeAsync(45000);
      expect(healthChecks.count).toBe(0);
      setOnline(events, false);
      expect(get(app.state).online).toBe(true);
      setOnline(events, true);
      await vi.advanceTimersByTimeAsync(0);
      expect(requests).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the grace period after a start, a resume and a reconnect', () => {
  /** A started controller on fake timers (the clock included); `/me` fails as long as `down.me` is true, the health check as long as `down.health` is. */
  async function startedDown(down = { me: true, health: false }) {
    // Nothing saved: the start shows loading (with a snapshot it shows that at once, see sync.test.ts).
    await deleteSnapshot('u1');
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    const { events } = stubBrowser('#/');
    const meRequests = { count: 0 };
    routes['GET /api/auth/me'] = () => {
      meRequests.count++;
      return down.me ? Promise.reject(new TypeError('fetch failed')) : Response.json(user);
    };
    routes['GET /api/health'] = () => (down.health ? Promise.reject(new TypeError('fetch failed')) : Response.json({ status: 'UP' }));
    const app = createAppController();
    const stop = app.start();
    await settle(0);
    return { app, stop, events, down, meRequests };
  }

  it('shows no warning for a first failure that the silent retry answers', async () => {
    const { app, stop, down, meRequests } = await startedDown();
    try {
      expect(flat(get(app.state))).toMatchObject({ online: true, loading: true, loadFailed: false, error: '' });
      down.me = false;
      await settle(RETRY_DELAY_MS);
      expect(meRequests.count).toBe(2);
      expect(flat(get(app.state))).toMatchObject({ user, online: true, loading: false, loadFailed: false, glazes: [glaze] });
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it('warns once the silent retry fails as well', async () => {
    const { app, stop, meRequests } = await startedDown();
    try {
      await settle(RETRY_DELAY_MS + 50);
      expect(meRequests.count).toBe(2);
      expect(flat(get(app.state))).toMatchObject({ user, online: false, loadFailed: true, loadFailure: 'offline' });
      await vi.waitFor(() => expect(flat(get(app.state)).loading).toBe(false));
      await settle(RETRY_DELAY_MS * 3);
      expect(meRequests.count).toBe(2);
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it('also waits out an unreachable listing request', async () => {
    await deleteSnapshot('u1');
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    stubBrowser('#/');
    let failing = true;
    routes['GET /api/glazes'] = () => (failing ? Promise.reject(new TypeError('fetch failed')) : Response.json([glaze]));
    const app = createAppController();
    const stop = app.start();
    try {
      await settle(0);
      expect(flat(get(app.state))).toMatchObject({ online: true, loading: true, loadFailed: false });
      failing = false;
      await settle(RETRY_DELAY_MS);
      expect(flat(get(app.state))).toMatchObject({ online: true, loading: false, loadFailed: false, glazes: [glaze] });
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it('warns at once on a device that reports itself offline', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    stubBrowser('#/');
    vi.stubGlobal('navigator', { onLine: false });
    const app = createAppController();
    const stop = app.start();
    try {
      await settle(0);
      expect(flat(get(app.state))).toMatchObject({ online: false, loadFailed: true });
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it('warns at once for a failure after the window and for a manual retry inside it', async () => {
    const { app, stop, down } = await startedDown({ me: false, health: false });
    try {
      expect(flat(get(app.state))).toMatchObject({ online: true, loadFailed: false });
      down.me = true;
      await app.retry();
      expect(flat(get(app.state))).toMatchObject({ online: false, loadFailed: true });
      down.me = false;
      await app.retry();
      await settle(GRACE_MS);
      down.me = true;
      await app.refresh();
      expect(flat(get(app.state))).toMatchObject({ online: false, loadFailed: true });
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it('gives the health check after a resume one silent retry, and a later failure none', async () => {
    const { app, stop, events, down } = await startedDown({ me: false, health: false });
    try {
      await settle(14_000);
      down.health = true;
      vi.stubGlobal('document', { visibilityState: 'visible' });
      events.dispatchEvent(new Event('visibilitychange'));
      await settle(1000);
      expect(get(app.state).online).toBe(true);
      down.health = false;
      await settle(RETRY_DELAY_MS);
      expect(flat(get(app.state))).toMatchObject({ online: true, loadFailed: false });

      await settle(GRACE_MS + 15_000);
      down.health = true;
      await settle(15_000);
      expect(get(app.state).online).toBe(false);
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it('reloads patiently when the app returns to the foreground while offline', async () => {
    const { app, stop, events, down, meRequests } = await startedDown();
    try {
      await settle(RETRY_DELAY_MS);
      expect(get(app.state).online).toBe(false);
      vi.stubGlobal('document', { visibilityState: 'hidden' });
      events.dispatchEvent(new Event('visibilitychange'));
      await settle(0);
      expect(meRequests.count).toBe(2);

      vi.stubGlobal('document', { visibilityState: 'visible' });
      events.dispatchEvent(new Event('visibilitychange'));
      await settle(0);
      expect(meRequests.count).toBe(3);
      expect(flat(get(app.state))).toMatchObject({ online: false, loading: true });
      down.me = false;
      await settle(RETRY_DELAY_MS);
      expect(flat(get(app.state))).toMatchObject({ user, online: true, loading: false, loadFailed: false });
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it('retries silently after the online event, and drops a retry that a stop left behind', async () => {
    const { app, stop, events, down, meRequests } = await startedDown({ me: false, health: false });
    try {
      await settle(20_000);
      down.me = true;
      events.dispatchEvent(new Event('online'));
      await settle(0);
      // The listings stay shown during the silent retry: no loading, no offline state.
      expect(flat(get(app.state))).toMatchObject({ online: true, loading: false, syncing: true });
      stop();
      const before = meRequests.count;
      await settle(RETRY_DELAY_MS * 2);
      expect(meRequests.count).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a session that ended on the server (23-72b)', () => {
  const dead = () => Response.json({ error: 'Please sign in.' }, { status: 401 });
  const unsaved = { dirty: () => true, message: 'drafts.discardCombination' } as const;
  /** A server whose session lives until `alive` is set to false: the session check and every write below then answer 401. */
  function server() {
    const state = { alive: true, meRequests: 0, csrfRequests: 0, logouts: 0, who: user };
    routes['GET /api/auth/csrf'] = () => {
      state.csrfRequests++;
      return Response.json({ token: 'csrf' });
    };
    routes['POST /api/auth/logout'] = () => {
      state.logouts++;
      return new Response(null, { status: 204 });
    };
    routes['GET /api/auth/me'] = () => {
      state.meRequests++;
      return state.alive ? Response.json(state.who) : dead();
    };
    routes['GET /api/stock'] = () => Response.json(state.alive ? [stockEntry] : []);
    routes['PUT /api/favorites/glazes/g1'] = () => (state.alive ? new Response(null, { status: 204 }) : dead());
    routes['POST /api/clubs'] = () => (state.alive ? Response.json({ id: 'c1' }) : dead());
    routes['POST /api/auth/login'] = () => {
      state.alive = true;
      return Response.json(state.who);
    };
    return state;
  }

  it('signs out at a write, as the session check does, and opens the sign-in with the notice', async () => {
    stubBrowser('#/');
    const api = server();
    const { app } = await loaded();
    expect(get(app.state).stock).toEqual([stockEntry]);
    api.alive = false;
    expect(await app.setFavorite('glazes', 'g1', true)).toBe(false);
    expect(flat(get(app.state))).toMatchObject({
      user: null,
      stock: [],
      authOpen: true,
      authNotice: 'sessionEnded',
      error: '',
      formError: null,
      loading: false,
      online: true,
    });
    expect(api.meRequests).toBe(2);
    // The same clean-up as an ended session at a load: nothing of the account stays on the device.
    expect(localStorage.getItem('glazelab:v1:lastUser')).toBeNull();
    expect(await readSnapshot('u1')).toBeNull();
    expect(cachesDeleted).toContain('glazelab-images-u1');
  });

  it("removes the shown account's snapshot also when another tab's sign-out already forgot lastUser (FE-12)", async () => {
    stubBrowser('#/');
    const api = server();
    const { app } = await loaded();
    // Another tab signed out (its clean-up removed lastUser); a load of this tab still under way saved the snapshot again.
    localStorage.removeItem('glazelab:v1:lastUser');
    expect(await readSnapshot('u1')).not.toBeNull();
    cachesDeleted.length = 0;
    api.alive = false;
    await app.refresh();
    expect(get(app.state).user).toBeNull();
    expect(await readSnapshot('u1')).toBeNull();
    expect(cachesDeleted).toContain('glazelab-images-u1');
  });

  it('logs the dead session out once, so the server clears the browser cache, and asks for a new CSRF token afterwards', async () => {
    stubBrowser('#/');
    const api = server();
    const { app } = await loaded();
    api.alive = false;
    await app.setFavorite('glazes', 'g1', true);
    expect(get(app.state)).toMatchObject({ user: null, authOpen: true, authNotice: 'sessionEnded' });
    expect(api.logouts).toBe(1);
    const tokens = api.csrfRequests;
    api.alive = true;
    expect(await app.submitAuth({ mode: 'login', email: user.email, password: 'right-password' })).toBe('done');
    expect(api.csrfRequests).toBeGreaterThan(tokens);
  });

  it.each([
    ['unreachable', unreachable],
    ['refused', () => Response.json({ error: 'Forbidden' }, { status: 403 })],
  ])('ends the session on the device even when the logout is %s', async (_, answer) => {
    stubBrowser('#/');
    const api = server();
    routes['POST /api/auth/logout'] = answer;
    const { app } = await loaded();
    api.alive = false;
    await app.refresh();
    expect(flat(get(app.state))).toMatchObject({ user: null, authOpen: true, authNotice: 'sessionEnded', loading: false });
    expect(await readSnapshot('u1')).toBeNull();
  });

  it('does not log out while input is kept for the same account', async () => {
    stubBrowser('#/studio');
    const api = server();
    const { app } = await loaded();
    app.registerLeaveGuard(unsaved);
    api.alive = false;
    await app.createClub('Kiln');
    expect(get(app.state)).toMatchObject({ user, authNotice: 'sessionEndedKept' });
    await app.refresh();
    expect(api.logouts).toBe(0);
  });

  it('checks the session once for parallel failures', async () => {
    stubBrowser('#/');
    const api = server();
    const { app } = await loaded();
    api.alive = false;
    const results = await Promise.all([app.setFavorite('glazes', 'g1', true), app.createClub('Kiln'), app.setFavorite('glazes', 'g1', false)]);
    expect(results).toEqual([false, null, false]);
    expect(api.meRequests).toBe(2);
    expect(get(app.state)).toMatchObject({ user: null, authOpen: true, authNotice: 'sessionEnded', error: '', formError: null });
  });

  it('keeps the account, its data and the page while input is unsaved, and asks to sign in again in place', async () => {
    stubBrowser('#/studio');
    const api = server();
    const { app } = await loaded();
    const stopGuard = app.registerLeaveGuard(unsaved);
    api.alive = false;
    expect(await app.createClub('Kiln')).toBeNull();
    expect(flat(get(app.state))).toMatchObject({
      user,
      stock: [stockEntry],
      authOpen: true,
      authNotice: 'sessionEndedKept',
      error: '',
      formError: null,
      loading: false,
    });
    expect(localStorage.getItem('glazelab:v1:lastUser')).not.toBeNull();
    expect(await readSnapshot('u1')).not.toBeNull();

    // A wrong password stays in the dialog, and is no second end of the session.
    routes['POST /api/auth/login'] = () => Response.json({ error: 'Invalid email or password' }, { status: 401 });
    const checks = api.meRequests;
    expect(await app.submitAuth({ mode: 'login', email: user.email, password: 'wrong-password' })).toBe('failed');
    expect(api.meRequests).toBe(checks);
    expect(get(app.state)).toMatchObject({
      user,
      authOpen: true,
      authNotice: 'sessionEndedKept',
      formError: { form: 'auth', message: 'Invalid email or password' },
    });

    // The same account signs in again: nothing was reset, the dialog and its notice are gone.
    routes['POST /api/auth/login'] = () => {
      api.alive = true;
      return Response.json(user);
    };
    expect(await app.submitAuth({ mode: 'login', email: user.email, password: 'right-password' })).toBe('done');
    expect(get(app.state)).toMatchObject({ user, stock: [stockEntry], authOpen: false, authNotice: null, formError: null });
    expect(await app.createClub('Kiln')).toBe('c1');
    stopGuard();
  });

  it('keeps the per-account device flags while input is kept, and leaves them at an end that is not kept (27-7)', async () => {
    stubBrowser('#/studio');
    const api = server();
    const { app } = await loaded();
    localStorage.setItem('glazelab:include-buddies:u1', '1');
    localStorage.setItem('glazelab:intro-dismissed:u1', '1');
    const stop = app.registerLeaveGuard(unsaved);
    api.alive = false;
    await app.createClub('Kiln');
    expect(get(app.state)).toMatchObject({ user, authNotice: 'sessionEndedKept' });
    expect([localStorage.getItem('glazelab:include-buddies:u1'), localStorage.getItem('glazelab:intro-dismissed:u1')]).toEqual(['1', '1']);
    stop();
  });

  it('drops the kept data only when another account signs in', async () => {
    stubBrowser('#/studio');
    const api = server();
    const { app } = await loaded();
    app.registerLeaveGuard(unsaved);
    api.alive = false;
    await app.createClub('Kiln');
    expect(get(app.state)).toMatchObject({ user, authNotice: 'sessionEndedKept' });
    api.who = { ...user, id: 'u2', email: 'bo@example.test', displayName: 'Bo' };
    api.alive = true;
    expect(await app.submitAuth({ mode: 'login', email: 'bo@example.test', password: 'right-password' })).toBe('done');
    expect(get(app.state)).toMatchObject({ user: api.who, authOpen: false, authNotice: null });
    expect(await readSnapshot('u1')).toBeNull();
  });

  it('forgets the notice when the dialog closes, and does not keep it for a later sign-in', async () => {
    stubBrowser('#/');
    const api = server();
    const { app } = await loaded();
    api.alive = false;
    await app.setFavorite('glazes', 'g1', true);
    expect(get(app.state)).toMatchObject({ authOpen: true, authNotice: 'sessionEnded' });
    app.closeAuth();
    expect(get(app.state)).toMatchObject({ authOpen: false, authNotice: null, user: null });
    app.openAuth();
    expect(get(app.state)).toMatchObject({ authOpen: true, authNotice: null });
  });

  it('applies the same rules when a later load finds the session ended', async () => {
    stubBrowser('#/');
    const api = server();
    const { app } = await loaded();
    api.alive = false;
    await app.refresh();
    expect(get(app.state)).toMatchObject({ user: null, authOpen: true, authNotice: 'sessionEnded' });

    api.alive = true;
    app.closeAuth();
    await app.refresh();
    expect(get(app.state)).toMatchObject({ user, authOpen: false, authNotice: null });
    const stop = app.registerLeaveGuard(unsaved);
    api.alive = false;
    await app.refresh();
    expect(flat(get(app.state))).toMatchObject({ user, stock: [stockEntry], authOpen: true, authNotice: 'sessionEndedKept', loading: false, syncing: false });
    stop();
  });

  describe('after the kept notice has shown (23-72c)', () => {
    /** Kept state: unsaved input, a write met the dead session, the dialog was shown and then dismissed. */
    async function keptAndDismissed() {
      stubBrowser('#/studio');
      const api = server();
      const { app } = await loaded();
      const stopGuard = app.registerLeaveGuard(unsaved);
      api.alive = false;
      expect(await app.createClub('Kiln')).toBeNull();
      expect(get(app.state)).toMatchObject({ user, authOpen: true, authNotice: 'sessionEndedKept' });
      app.closeAuth();
      expect(get(app.state)).toMatchObject({ user, authOpen: false, authNotice: null });
      return { api, app, stopGuard };
    }

    it('keeps the state quietly at a background load: no dialog, nothing cleared, no further check', async () => {
      const { api, app, stopGuard } = await keptAndDismissed();
      const checks = api.meRequests;
      await app.refresh();
      expect(api.meRequests).toBe(checks + 1);
      expect(flat(get(app.state))).toMatchObject({
        user,
        stock: [stockEntry],
        authOpen: false,
        authNotice: null,
        error: '',
        loading: false,
        syncing: false,
      });
      expect(localStorage.getItem('glazelab:v1:lastUser')).not.toBeNull();
      expect(await readSnapshot('u1')).not.toBeNull();
      // Again and again: still quiet.
      await app.refresh();
      await app.refresh();
      expect(get(app.state)).toMatchObject({ user, authOpen: false, authNotice: null });
      stopGuard();
    });

    it('leaves the dialog as it is when it is still open at a background load', async () => {
      stubBrowser('#/studio');
      const api = server();
      const { app } = await loaded();
      app.registerLeaveGuard(unsaved);
      api.alive = false;
      await app.createClub('Kiln');
      await app.refresh();
      expect(get(app.state)).toMatchObject({ user, authOpen: true, authNotice: 'sessionEndedKept' });
    });

    it('reopens the dialog at the next write attempt, every time', async () => {
      const { app, stopGuard } = await keptAndDismissed();
      await app.refresh();
      expect(get(app.state)).toMatchObject({ authOpen: false });
      expect(await app.createClub('Kiln')).toBeNull();
      expect(get(app.state)).toMatchObject({ user, stock: [stockEntry], authOpen: true, authNotice: 'sessionEndedKept', error: '', formError: null });
      app.closeAuth();
      expect(await app.setFavorite('glazes', 'g1', true)).toBe(false);
      expect(get(app.state)).toMatchObject({ user, authOpen: true, authNotice: 'sessionEndedKept', error: '' });
      stopGuard();
    });

    it('shows the notice again after signing in as the same account and a second end of the session', async () => {
      const { api, app, stopGuard } = await keptAndDismissed();
      routes['POST /api/auth/login'] = () => {
        api.alive = true;
        return Response.json(user);
      };
      app.openAuth();
      expect(await app.submitAuth({ mode: 'login', email: user.email, password: 'right-password' })).toBe('done');
      expect(get(app.state)).toMatchObject({ user, authOpen: false });
      api.alive = false;
      await app.refresh();
      expect(get(app.state)).toMatchObject({ user, stock: [stockEntry], authOpen: true, authNotice: 'sessionEndedKept' });
      stopGuard();
    });

    it('shows the notice again once the session is back and ends again without a sign-in here', async () => {
      const { api, app, stopGuard } = await keptAndDismissed();
      api.alive = true;
      await app.refresh();
      expect(get(app.state)).toMatchObject({ user, authOpen: false });
      api.alive = false;
      await app.refresh();
      expect(get(app.state)).toMatchObject({ user, authOpen: true, authNotice: 'sessionEndedKept' });
      stopGuard();
    });

    it('shows the notice again for another account that ends its session over the same unsaved input', async () => {
      const { api, app, stopGuard } = await keptAndDismissed();
      const bo = { ...user, id: 'u2', email: 'bo@example.test', displayName: 'Bo' };
      api.who = bo;
      api.alive = true;
      app.openAuth();
      expect(await app.submitAuth({ mode: 'login', email: bo.email, password: 'right-password' })).toBe('done');
      expect(get(app.state)).toMatchObject({ user: bo, authOpen: false });
      api.alive = false;
      await app.refresh();
      expect(get(app.state)).toMatchObject({ user: bo, authOpen: true, authNotice: 'sessionEndedKept' });
      stopGuard();
    });

    it('shows the notice again after a sign-out and a sign-in of the same account', async () => {
      const { api, app, stopGuard } = await keptAndDismissed();
      routes['POST /api/auth/logout'] = () => new Response(null, { status: 204 });
      await app.logout();
      expect(get(app.state)).toMatchObject({ user: null });
      api.alive = true;
      app.openAuth();
      expect(await app.submitAuth({ mode: 'login', email: user.email, password: 'right-password' })).toBe('done');
      api.alive = false;
      await app.refresh();
      expect(get(app.state)).toMatchObject({ user, authOpen: true, authNotice: 'sessionEndedKept' });
      stopGuard();
    });

    it('keeps the unsaved input after a background load that the dead session answers, with nothing retried', async () => {
      const { api, app, stopGuard } = await keptAndDismissed();
      const writes: string[] = [];
      routes['POST /api/clubs'] = () => {
        writes.push('club');
        return Response.json({ id: 'c1' });
      };
      await app.refresh();
      expect(writes).toEqual([]);
      expect(api.alive).toBe(false);
      stopGuard();
    });
  });

  it('shows no notice when the first load finds that the remembered session has ended', async () => {
    const api = server();
    api.alive = false;
    const { state } = await loaded();
    expect(state).toMatchObject({ user: null, authOpen: false, authNotice: null });
  });

  it('shows the failure when the session check finds the session alive', async () => {
    stubBrowser('#/');
    const api = server();
    routes['PUT /api/favorites/glazes/g1'] = dead;
    const { app } = await loaded();
    expect(await app.setFavorite('glazes', 'g1', true)).toBe(false);
    expect(api.meRequests).toBe(2);
    expect(get(app.state)).toMatchObject({ user, authOpen: false, authNotice: null, error: 'Please sign in.' });
  });

  it.each([
    [403, 'Forbidden'],
    [428, 'Please accept the updated terms of service to continue.'],
    [429, 'Too many requests. Please wait a moment and try again.'],
    [500, 'Boom'],
  ])('does not treat a %i answer as the end of the session', async (status, error) => {
    stubBrowser('#/');
    const api = server();
    routes['POST /api/clubs'] = () => Response.json({ error }, { status });
    const { app } = await loaded();
    expect(await app.createClub('Kiln')).toBeNull();
    expect(api.meRequests).toBe(1);
    expect(get(app.state)).toMatchObject({ user, authOpen: false, authNotice: null, formError: { form: 'club', message: error } });
  });

  it('does not check the session after a refused sign-in', async () => {
    const api = server();
    api.alive = false;
    routes['POST /api/auth/login'] = () => Response.json({ error: 'Invalid email or password' }, { status: 401 });
    const { app } = await loaded();
    expect(await app.submitAuth({ mode: 'login', email: user.email, password: 'wrong-password' })).toBe('failed');
    expect(api.meRequests).toBe(1);
    expect(get(app.state)).toMatchObject({ user: null, authNotice: null, formError: { form: 'auth', message: 'Invalid email or password' } });
  });

  it('shows no raw sign-in error for a parallel failure that arrives while the check runs, input kept', async () => {
    stubBrowser('#/studio');
    const api = server();
    const { app } = await loaded();
    const stop = app.registerLeaveGuard(unsaved);
    api.alive = false;
    const results = await Promise.all([app.setFavorite('glazes', 'g1', true), app.createClub('Kiln')]);
    expect(results).toEqual([false, null]);
    expect(api.meRequests).toBe(2);
    expect(get(app.state)).toMatchObject({ user, authOpen: true, authNotice: 'sessionEndedKept', error: '', formError: null });
    stop();
  });

  it('reports every parallel failure after one check that finds the session alive', async () => {
    stubBrowser('#/');
    const api = server();
    routes['PUT /api/favorites/glazes/g1'] = dead;
    routes['POST /api/clubs'] = dead;
    const { app } = await loaded();
    await Promise.all([app.setFavorite('glazes', 'g1', true), app.createClub('Kiln')]);
    expect(api.meRequests).toBe(2);
    expect(get(app.state)).toMatchObject({ user, authOpen: false, error: 'Please sign in.', formError: { form: 'club', message: 'Please sign in.' } });
  });

  it.each([
    ['unreachable', unreachable],
    ['answering 503', nginx(503)],
    ['rate limited', tooMany],
  ])('keeps the session and its data when the session check finds the server %s', async (_name, answer) => {
    stubBrowser('#/');
    server();
    const { app } = await loaded();
    routes['PUT /api/favorites/glazes/g1'] = dead;
    routes['GET /api/auth/me'] = answer;
    expect(await app.setFavorite('glazes', 'g1', true)).toBe(false);
    expect(get(app.state)).toMatchObject({ user, stock: [stockEntry], authOpen: false, authNotice: null });
    expect(localStorage.getItem('glazelab:v1:lastUser')).not.toBeNull();
    expect(await readSnapshot('u1')).not.toBeNull();
  });

  it('keeps unsaved input of a remembered account that the server never confirmed (offline start, then online)', async () => {
    const { events } = stubBrowser('#/studio');
    const api = server();
    vi.stubGlobal('navigator', { onLine: false });
    const app = createAppController();
    const stopApp = app.start();
    await vi.waitFor(() => expect(flat(get(app.state))).toMatchObject({ user, loading: false, online: false }));
    const stop = app.registerLeaveGuard(unsaved);
    api.alive = false;
    vi.stubGlobal('navigator', { onLine: true });
    events.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(get(app.state).authNotice).toBe('sessionEndedKept'));
    expect(get(app.state)).toMatchObject({ user, authOpen: true, glazes: [glaze] });
    stop();
    stopApp();
  });

  it('ends an upload that meets the ended session like any write', async () => {
    stubBrowser('#/');
    const api = server();
    routes['POST /api/glazes/g1/images'] = dead;
    const { app } = await loaded();
    api.alive = false;
    const result = await app.uploadImage({
      target: { type: 'glaze', id: 'g1' },
      file: new File(['x'], 'tile.png', { type: 'image/png' }),
      visibility: 'PUBLIC',
      kind: 'TEST_TILE',
    } as never);
    expect(result).toMatchObject({ ok: false, stop: true });
    expect(get(app.state)).toMatchObject({ user: null, authOpen: true, authNotice: 'sessionEnded' });
  });
});
