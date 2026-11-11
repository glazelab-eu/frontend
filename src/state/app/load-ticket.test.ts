import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { readSnapshot } from '../../lib/offline/snapshots';
import { createLoadTicket } from './load-ticket';
import { createAppController } from './app-controller';
import { glaze, loaded, routes, stubBrowser, useMockApi } from './test-helpers';

useMockApi();

describe('the load ticket', () => {
  it('keeps the newest version current, and a cancel discards it without starting one', () => {
    const ticket = createLoadTicket();
    expect(ticket.now()).toBe(0);
    const first = ticket.begin();
    expect(ticket.isCurrent(first)).toBe(true);
    const second = ticket.begin();
    expect([ticket.isCurrent(first), ticket.isCurrent(second), ticket.now()]).toEqual([false, true, second]);
    ticket.cancel();
    expect(ticket.isCurrent(second)).toBe(false);
    expect(ticket.now()).toBe(second + 1);
  });
});

describe('cancelling a load under way', () => {
  const other = { ...glaze, id: 'g-late', name: 'Late answer' };
  /** Holds the next glaze listing until `release`; `requested` resolves once it was asked for. */
  function holdGlazes() {
    let release!: () => void;
    let asked!: () => void;
    const requested = new Promise<void>((resolve) => (asked = resolve));
    routes['GET /api/glazes'] = () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(Response.json([other]));
        asked();
      });
    return { requested, release: () => release() };
  }
  /** Lets a released answer run through the load (IndexedDB runs on `setImmediate`). */
  const drain = async () => {
    for (let round = 0; round < 20; round++) await new Promise((resolve) => setImmediate(resolve));
  };
  /** Whether any state the store showed held the late answer. */
  function watchLate(app: ReturnType<typeof createAppController>) {
    let late = false;
    const stop = app.state.subscribe((state) => {
      late ||= state.glazes.some((item) => item.id === other.id);
    });
    return () => {
      stop();
      return late;
    };
  }

  it('applies nothing a load brings after a sign-out', async () => {
    stubBrowser('#/');
    const { app } = await loaded();
    const held = holdGlazes();
    const refreshing = app.refresh();
    await held.requested;
    const watch = watchLate(app);
    // The server's answer to the sign-out is held too, so the sign-out's own later load cannot be what discards the old one.
    let confirm!: () => void;
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['POST /api/auth/logout'] = () =>
      new Promise<Response>((resolve) => {
        confirm = () => {
          routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
          routes['GET /api/glazes'] = () => Response.json([]);
          resolve(new Response(null, { status: 204 }));
        };
      });
    const signingOut = app.logout();
    await drain();
    held.release();
    await refreshing;
    await drain();
    expect(get(app.state)).toMatchObject({ user: null, glazes: [] });
    expect(await readSnapshot('u1')).toBeNull();
    confirm();
    await signingOut;
    expect(watch()).toBe(false);
  });

  it('applies nothing a load brings after an account deletion', async () => {
    stubBrowser('#/account');
    const { app } = await loaded();
    const held = holdGlazes();
    const refreshing = app.refresh();
    await held.requested;
    const watch = watchLate(app);
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['POST /api/auth/delete'] = () => {
      routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
      routes['GET /api/glazes'] = () => Response.json([]);
      return new Response(null, { status: 204 });
    };
    // The old load's answer arrives during the deletion's clean-up, before the deletion's own load begins.
    vi.stubGlobal('caches', {
      delete: async () => {
        held.release();
        await refreshing;
        await drain();
        return true;
      },
    });
    expect(await app.deleteAccount('password')).toBe(true);
    expect(get(app.state)).toMatchObject({ user: null, glazes: [] });
    expect(await readSnapshot('u1')).toBeNull();
    expect(watch()).toBe(false);
  });

  it('applies nothing a load brings after the controller stopped', async () => {
    stubBrowser('#/');
    vi.stubGlobal('document', { visibilityState: 'visible' });
    const app = createAppController();
    const held = holdGlazes();
    const stop = app.start();
    await held.requested;
    const watch = watchLate(app);
    stop();
    held.release();
    await drain();
    expect(watch()).toBe(false);
    // The instant start showed the saved glaze, and the device keeps it.
    expect(get(app.state).glazes.map((item) => item.id)).toEqual([glaze.id]);
    expect((await readSnapshot('u1'))?.glazes.map((item) => item.id)).toEqual([glaze.id]);
  });
});
