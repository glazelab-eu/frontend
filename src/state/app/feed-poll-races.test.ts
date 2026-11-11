import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { createAppController } from './app-controller';
import { FEED_POLL_MAX_MS, FEED_POLL_MS } from './load';
import { readLastUser } from '../../lib/offline/offline';
import { routes, useMockApi, user } from './test-helpers';

useMockApi();

/**
 * The activity badge poll's races (FEED-1 review): a slow answer never patches an account that is no longer the one it was asked
 * for, nor undoes a newer count (a "seen" or a load that answered meanwhile); the poll stops with the app; it is back at the interval
 * once the connection returns; a 401 checks the session like every other read.
 */
async function settle(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
  for (let round = 0; round < 30; round++) {
    await new Promise((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(0);
  }
}

const ben = { id: 'u2', email: 'ben@example.test', displayName: 'Ben' };
let polls = 0;
/** The pending answers of the badge poll, oldest first. */
let pending: ((unread: number) => void)[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  vi.stubGlobal('window', Object.assign(new EventTarget(), { scrollTo: vi.fn() }));
  vi.stubGlobal('location', { hash: '#/' });
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('document', { visibilityState: 'visible' });
  polls = 0;
  pending = [];
  routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
  routes['GET /api/auth/me'] = () => Response.json({ ...user, feedUnread: 0, feedBuddies: true, feedClubs: true });
  routes['GET /api/health'] = () => Response.json({ status: 'UP' });
});

afterEach(() => vi.useRealTimers());

/** Every badge request waits until the test answers it. */
function slowBadge() {
  routes['GET /api/feed/unread'] = () => {
    polls++;
    return new Promise<Response>((resolve) => pending.push((unread) => resolve(Response.json({ unread, newest: null }))));
  };
}

async function started() {
  const app = createAppController();
  const stop = app.start();
  await settle();
  return { app, stop };
}

describe('the activity badge poll across changes', () => {
  it('never patches the next account with a late answer for the one that signed out', async () => {
    slowBadge();
    const { app, stop } = await started();
    try {
      await settle(FEED_POLL_MS);
      expect(pending).toHaveLength(1);
      routes['POST /api/auth/logout'] = () => {
        routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
        return new Response(null, { status: 200 });
      };
      routes['GET /api/auth/clear-cache'] = () => new Response(null, { status: 204 });
      routes['POST /api/auth/login'] = () => {
        routes['GET /api/auth/me'] = () => Response.json({ ...ben, feedUnread: 2, feedBuddies: true, feedClubs: true });
        return new Response(null, { status: 200 });
      };
      await app.logout();
      expect(await app.submitAuth({ mode: 'login', email: ben.email, password: 'secret' })).toBe('done');
      await settle();
      expect(get(app.state).user).toMatchObject({ id: ben.id, feedUnread: 2 });
      pending[0](9);
      await settle();
      expect(get(app.state).user).toMatchObject({ id: ben.id, feedUnread: 2 });
    } finally {
      stop();
    }
  });

  it('never brings back a count that a "seen" cleared while the answer was on its way', async () => {
    slowBadge();
    const { app, stop } = await started();
    try {
      routes['POST /api/feed/seen'] = () => new Response(null, { status: 204 });
      // The poll asks while the account has 4 new entries; the page marks them seen before that answer arrives.
      await settle(FEED_POLL_MS);
      expect(pending).toHaveLength(1);
      expect(await app.markFeedSeen('2026-11-08T10:00:00Z')).toBe(true);
      expect(get(app.state).user?.feedUnread).toBe(0);
      pending[0](4);
      await settle();
      expect(get(app.state).user?.feedUnread).toBe(0);
    } finally {
      stop();
    }
  });

  it('asks nothing once the app stopped, also after an answer that was on its way', async () => {
    slowBadge();
    const { stop } = await started();
    await settle(FEED_POLL_MS);
    expect(polls).toBe(1);
    stop();
    pending[0](0);
    await settle(FEED_POLL_MAX_MS * 2);
    expect(polls).toBe(1);
  });

  it('is back at the interval once the connection returns after failures', async () => {
    const { stop } = await started();
    try {
      let failures = 0;
      routes['GET /api/feed/unread'] = () => {
        failures++;
        return Promise.reject(new TypeError('Failed to fetch'));
      };
      // Three failures: the wait grew to 4 minutes.
      await settle(FEED_POLL_MS + 2 * FEED_POLL_MS + 4 * FEED_POLL_MS);
      expect(failures).toBe(3);
      routes['GET /api/feed/unread'] = () => {
        polls++;
        return Response.json({ unread: 0, newest: null });
      };
      window.dispatchEvent(new Event('online'));
      await settle();
      polls = 0;
      await settle(FEED_POLL_MS);
      expect(polls).toBe(1);
    } finally {
      stop();
    }
  });

  it('saves a changed count with the account, so an offline start shows it', async () => {
    routes['GET /api/feed/unread'] = () => Response.json({ unread: 6, newest: '2026-11-08T10:00:00Z' });
    const { stop } = await started();
    try {
      await settle(FEED_POLL_MS);
      expect(readLastUser()?.feedUnread).toBe(6);
    } finally {
      stop();
    }
  });

  it('asks nothing while a load runs (its `/me` brings the count)', async () => {
    const { app, stop } = await started();
    try {
      routes['GET /api/feed/unread'] = () => {
        polls++;
        return Response.json({ unread: 0, newest: null });
      };
      routes['GET /api/sync'] = () => new Promise<Response>(() => {});
      void app.refresh();
      await settle(FEED_POLL_MS * 3);
      expect(polls).toBe(0);
    } finally {
      stop();
    }
  });

  it('is back at the interval after one answer that followed failures', async () => {
    const { stop } = await started();
    try {
      let failing = true;
      routes['GET /api/feed/unread'] = () => {
        polls++;
        return failing ? Response.json({ error: 'Too many requests' }, { status: 429 }) : Response.json({ unread: 0, newest: null });
      };
      // Failures at 30 s, 90 s and 210 s; the wait is 4 minutes, then the answer at 450 s.
      await settle(FEED_POLL_MS + 2 * FEED_POLL_MS + 4 * FEED_POLL_MS);
      expect(polls).toBe(3);
      failing = false;
      await settle(8 * FEED_POLL_MS);
      expect(polls).toBe(4);
      await settle(FEED_POLL_MS);
      expect(polls).toBe(5);
    } finally {
      stop();
    }
  });

  it('asks at once when the page is visible again without a load, from the interval after failures', async () => {
    const { stop } = await started();
    try {
      routes['GET /api/feed/unread'] = () => {
        polls++;
        return Response.json({ error: 'Too many requests' }, { status: 429 });
      };
      await settle(FEED_POLL_MS + 2 * FEED_POLL_MS + 4 * FEED_POLL_MS);
      expect(polls).toBe(3);
      // The resume asks (or loads and the poll waits the interval); a failure then waits twice the interval, not 8 minutes.
      vi.stubGlobal('document', { visibilityState: 'hidden' });
      window.dispatchEvent(new Event('visibilitychange'));
      vi.stubGlobal('document', { visibilityState: 'visible' });
      window.dispatchEvent(new Event('visibilitychange'));
      await settle(3 * FEED_POLL_MS + 10_000);
      expect(polls).toBe(5);
    } finally {
      stop();
    }
  });

  it('asks at once when the page is visible again shortly after a load', async () => {
    const { stop } = await started();
    try {
      routes['GET /api/feed/unread'] = () => {
        polls++;
        return Response.json({ unread: 0, newest: null });
      };
      await settle(10_000);
      vi.stubGlobal('document', { visibilityState: 'hidden' });
      window.dispatchEvent(new Event('visibilitychange'));
      await settle(5_000);
      vi.stubGlobal('document', { visibilityState: 'visible' });
      window.dispatchEvent(new Event('visibilitychange'));
      await settle();
      expect(polls).toBe(1);
    } finally {
      stop();
    }
  });

  it('checks the session after a 401 instead of asking on with an ended one', async () => {
    const { app, stop } = await started();
    try {
      app.state.subscribe(() => {});
      routes['GET /api/feed/unread'] = () => {
        polls++;
        return Response.json({ error: 'Please sign in.' }, { status: 401 });
      };
      routes['GET /api/auth/me'] = () => Response.json({ error: 'Please sign in.' }, { status: 401 });
      await settle(FEED_POLL_MS);
      expect(polls).toBe(1);
      expect(get(app.state).user).toBeNull();
      await settle(FEED_POLL_MAX_MS * 2);
      expect(polls).toBe(1);
    } finally {
      stop();
    }
  });
});
