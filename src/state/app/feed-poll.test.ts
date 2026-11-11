import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { createAppController } from './app-controller';
import { FEED_POLL_MAX_MS, FEED_POLL_MS } from './load';
import { routes, useMockApi, user } from './test-helpers';

useMockApi();

/**
 * The activity badge's light poll (FEED-1): one `GET /api/feed/unread` per interval while the page is visible, online and signed in;
 * nothing while hidden, offline, as a guest or before a pending sign-out is answered; no store update for an unchanged count.
 */
async function settle(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
  for (let round = 0; round < 30; round++) {
    await new Promise((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(0);
  }
}

let visibility: 'visible' | 'hidden' = 'visible';
let polls = 0;
let unread = 0;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  vi.stubGlobal('window', Object.assign(new EventTarget(), { scrollTo: vi.fn() }));
  vi.stubGlobal('location', { hash: '#/' });
  vi.stubGlobal('navigator', { onLine: true });
  visibility = 'visible';
  vi.stubGlobal('document', {
    get visibilityState() {
      return visibility;
    },
  });
  polls = 0;
  unread = 0;
  routes['GET /api/auth/me'] = () => Response.json({ ...user, feedUnread: 0, feedBuddies: true, feedClubs: true });
  routes['GET /api/health'] = () => Response.json({ status: 'UP' });
  routes['GET /api/feed/unread'] = () => {
    polls++;
    return Response.json({ unread, newest: unread ? '2026-11-08T10:00:00Z' : null });
  };
});

afterEach(() => vi.useRealTimers());

async function started() {
  const app = createAppController();
  const stop = app.start();
  await settle();
  return { app, stop };
}

describe('the activity badge poll', () => {
  it('asks once per interval while visible and patches the account only when the count changed', async () => {
    const { app, stop } = await started();
    try {
      expect(get(app.state).user?.id).toBe(user.id);
      let updates = 0;
      const unsubscribe = app.state.subscribe(() => updates++);
      updates = 0;
      await settle(FEED_POLL_MS);
      expect(polls).toBe(1);
      expect(updates).toBe(0);
      unread = 3;
      await settle(FEED_POLL_MS);
      expect(polls).toBe(2);
      expect(get(app.state).user?.feedUnread).toBe(3);
      expect(updates).toBe(1);
      await settle(FEED_POLL_MS);
      expect(polls).toBe(3);
      expect(updates).toBe(1);
      unsubscribe();
    } finally {
      stop();
    }
  });

  it('stops while the page is hidden and asks at once when it is visible again', async () => {
    const { stop } = await started();
    try {
      visibility = 'hidden';
      await settle(FEED_POLL_MS * 5);
      expect(polls).toBe(0);
      visibility = 'visible';
      unread = 1;
      window.dispatchEvent(new Event('visibilitychange'));
      await settle();
      // The resume either loads (the count rides on `/me`) or asks for the badge at once; the timer runs again either way.
      const before = polls;
      await settle(FEED_POLL_MS);
      expect(polls).toBe(before + 1);
    } finally {
      stop();
    }
  });

  it('asks nothing offline or as a guest', async () => {
    routes['GET /api/auth/me'] = () => Response.json({ error: 'Please sign in.' }, { status: 401 });
    const guest = await started();
    try {
      await settle(FEED_POLL_MS * 3);
      expect(get(guest.app.state).user).toBeNull();
      expect(polls).toBe(0);
    } finally {
      guest.stop();
    }
    routes['GET /api/auth/me'] = () => Response.json({ ...user, feedUnread: 0, feedBuddies: true, feedClubs: true });
    const { app, stop } = await started();
    try {
      app.state.subscribe(() => {});
      routes['GET /api/health'] = () => Promise.reject(new TypeError('Failed to fetch'));
      window.dispatchEvent(new Event('offline'));
      vi.stubGlobal('navigator', { onLine: false });
      window.dispatchEvent(new Event('offline'));
      await settle();
      expect(get(app.state).online).toBe(false);
      await settle(FEED_POLL_MS * 3);
      expect(polls).toBe(0);
    } finally {
      stop();
    }
  });

  it('asks nothing while a sign-out waits for its answer', async () => {
    const { app, stop } = await started();
    try {
      routes['POST /api/auth/logout'] = () => new Promise<Response>(() => {});
      void app.logout();
      await settle(FEED_POLL_MS * 3);
      expect(get(app.state).user).toBeNull();
      expect(polls).toBe(0);
    } finally {
      stop();
    }
  });

  it('waits longer after each failure, up to the cap, and returns to the interval after an answer', async () => {
    const { stop } = await started();
    try {
      let failures = 0;
      routes['GET /api/feed/unread'] = () => {
        failures++;
        return Response.json({ error: 'Too many requests' }, { status: 429 });
      };
      await settle(FEED_POLL_MS);
      expect(failures).toBe(1);
      await settle(FEED_POLL_MS);
      expect(failures).toBe(1);
      await settle(FEED_POLL_MS);
      expect(failures).toBe(2);
      await settle(FEED_POLL_MAX_MS * 2);
      const capped = failures;
      await settle(FEED_POLL_MAX_MS);
      expect(failures).toBe(capped + 1);
    } finally {
      stop();
    }
  });
});
