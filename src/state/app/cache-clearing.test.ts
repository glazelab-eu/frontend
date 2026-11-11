import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { flat, loaded, routes, stubBrowser, unreachable, useMockApi, user } from './test-helpers';
import { api } from '../../lib/api/client';

useMockApi();

const CLEAR = 'GET /api/auth/clear-cache';

/**
 * The cache clearing after a sign-out or an account deletion (LOGOUT-2): `GET /api/auth/clear-cache` carries
 * `Clear-Site-Data: "cache"`, which the browser may hold for seconds. It goes only after the server ended the session and
 * nothing waits for it; here it never answers.
 */
describe('cache clearing', () => {
  /** Records the auth requests in order; the cache clearing never answers. */
  function track() {
    const order: string[] = [];
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['POST /api/auth/logout'] = () => {
      order.push('logout');
      routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
      return new Response(null, { status: 200 });
    };
    routes[CLEAR] = () => {
      order.push('clear');
      return new Promise<Response>(() => {});
    };
    routes['POST /api/auth/login'] = () => {
      order.push('login');
      routes['GET /api/auth/me'] = () => Response.json(user);
      return new Response(null, { status: 200 });
    };
    return order;
  }

  it('goes after the sign-out answer, and a never-answered clearing delays neither the notice nor the next sign-in', async () => {
    stubBrowser('#/');
    const order = track();
    const { app } = await loaded();
    await app.logout();
    expect(order).toEqual(['logout', 'clear']);
    expect(flat(get(app.state))).toMatchObject({ user: null, signingOut: false, loading: false, toast: 'notices.signedOut' });
    expect(localStorage.getItem('glazelab:v1:pendingLogout')).toBeNull();
    expect(await app.submitAuth({ mode: 'login', email: user.email, password: 'secret' })).toBe('done');
    expect(get(app.state).user).toMatchObject({ id: user.id });
    expect(order).toEqual(['logout', 'clear', 'login']);
  });

  it('lets a sign-in started right after the press wait only for the sign-out answer, then clears without waiting', async () => {
    stubBrowser('#/');
    const order = track();
    let answer!: () => void;
    routes['POST /api/auth/logout'] = () =>
      new Promise<Response>((resolve) => {
        answer = () => {
          order.push('logout');
          routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
          resolve(new Response(null, { status: 200 }));
        };
      });
    const { app } = await loaded();
    const signingOut = app.logout();
    await vi.waitFor(() => expect(answer).toBeDefined());
    const signingIn = app.submitAuth({ mode: 'login', email: user.email, password: 'secret' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The sign-in never goes before the sign-out answered: that answer deletes the cookie.
    expect(order).toEqual([]);
    answer();
    expect(await signingIn).toBe('done');
    await signingOut;
    expect(order.indexOf('logout')).toBeLessThan(order.indexOf('login'));
    expect(order).toContain('clear');
    expect(order.indexOf('logout')).toBeLessThan(order.indexOf('clear'));
    expect(get(app.state).user).toMatchObject({ id: user.id });
  });

  it('sends nothing offline, and the pending sign-out at the next online start sends the sign-out, then the clearing', async () => {
    stubBrowser('#/');
    vi.stubGlobal('navigator', { onLine: false });
    const order = track();
    const { app } = await loaded();
    await app.logout();
    expect(order).toEqual([]);
    expect(get(app.state).toast).toBe('notices.signedOutOffline');
    vi.stubGlobal('navigator', { onLine: true });
    const next = await loaded();
    expect(order).toEqual(['logout', 'clear']);
    expect(flat(next.state)).toMatchObject({ user: null, loading: false });
  });

  it('is not sent while the sign-out request fails', async () => {
    stubBrowser('#/');
    const order = track();
    const { app } = await loaded();
    routes['POST /api/auth/logout'] = unreachable;
    await app.logout();
    expect(order).toEqual([]);
    expect(get(app.state).toast).toBe('notices.signedOutPending');
    expect(localStorage.getItem('glazelab:v1:pendingLogout')).toBe('1');
  });

  it('goes after an account deletion, which a never-answered clearing does not delay', async () => {
    stubBrowser('#/');
    const order = track();
    const { app } = await loaded();
    routes['POST /api/auth/delete'] = () => {
      order.push('delete');
      routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
      return new Response(null, { status: 204 });
    };
    expect(await app.deleteAccount('password')).toBe(true);
    expect(order).toEqual(['delete', 'clear']);
    expect(flat(get(app.state))).toMatchObject({ user: null, loading: false, toast: 'notices.accountDeleted' });
  });

  it('goes after the logout of a session that ended elsewhere, without delaying the signed-out state', async () => {
    stubBrowser('#/');
    const order = track();
    const { app } = await loaded();
    routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
    await app.refresh();
    expect(order).toEqual(['logout', 'clear']);
    expect(flat(get(app.state))).toMatchObject({ user: null, loading: false });
  });

  it('never rejects, whatever the clearing answers, so a request nobody awaits leaves no unhandled rejection', async () => {
    routes['GET /api/auth/clear-cache'] = () => Response.json({ error: 'Boom' }, { status: 500 });
    await expect(api.clearBrowserCache()).resolves.toBeUndefined();
    routes['GET /api/auth/clear-cache'] = () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(api.clearBrowserCache()).resolves.toBeUndefined();
  });
});
