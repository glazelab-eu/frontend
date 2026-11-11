import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { emptyBuddies } from '../../lib/buddies/buddies';
import { createAppController } from './app-controller';
import { FEED_POLL_MS } from './load';
import { routes, useMockApi, user } from './test-helpers';

useMockApi();

/**
 * The new-request toast (FEED-2) as the badge poll drives it: the first answer or load sets the baseline, a request that arrived since
 * gets one toast, nothing twice, nothing while the activity page shows it, nothing for an API without the fields, nothing for the next
 * account from the previous one's memory, and no store update when nothing changed.
 */
async function settle(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
  for (let round = 0; round < 30; round++) {
    await new Promise((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(0);
  }
}

const ben = { id: 'u2', email: 'ben@example.test', displayName: 'Ben' };
const ADA = 'a0000000-0000-4000-8000-000000000001';
const CY = 'c0000000-0000-4000-8000-000000000003';
type Waiting = { id: string; name: string; at: string; count: number } | null;
let waiting: Waiting = null;
/** The answer of an API from before FEED-2: no request fields at all. */
let oldApi = false;
/** While set, badge answers wait in `held` until the test releases them. */
let hold = false;
let held: (() => void)[] = [];
let incoming: { id: string; displayName: string; avatarId: null; since: string }[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  vi.stubGlobal('window', Object.assign(new EventTarget(), { scrollTo: vi.fn() }));
  vi.stubGlobal('location', { hash: '#/' });
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('document', { visibilityState: 'visible' });
  waiting = null;
  oldApi = false;
  incoming = [];
  routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
  routes['GET /api/auth/me'] = () => Response.json({ ...user, feedUnread: 0, feedBuddies: true, feedClubs: true });
  routes['GET /api/health'] = () => Response.json({ status: 'UP' });
  routes['GET /api/buddies'] = () => Response.json({ ...emptyBuddies(), incoming });
  held = [];
  hold = false;
  routes['GET /api/feed/unread'] = () => {
    if (hold) {
      // Answered later with what waits at the time of asking.
      const answer = feedAnswer();
      return new Promise<Response>((resolve) => held.push(() => resolve(answer)));
    }
    return feedAnswer();
  };
});

/** The poll's answer for what waits now. */
function feedAnswer() {
  const unread = waiting ? waiting.count : 0;
  const base = { unread, newest: waiting?.at ?? null };
  if (oldApi) return Response.json(base);
  return Response.json({
    ...base,
    requesterId: waiting?.id ?? null,
    requesterName: waiting?.name ?? null,
    requestedAt: waiting?.at ?? null,
    requests: waiting?.count ?? 0,
  });
}

afterEach(() => vi.useRealTimers());

async function started() {
  const app = createAppController();
  const stop = app.start();
  await settle();
  return { app, stop };
}

const toastOf = (app: ReturnType<typeof createAppController>) => get(app.state).requestToast;

describe('the new-request toast', () => {
  it('announces a request that arrived after the load once, and never one the load already listed', async () => {
    incoming = [{ id: ADA, displayName: 'Ada', avatarId: null, since: '2026-11-08T09:00:00Z' }];
    waiting = { id: ADA, name: 'Ada', at: '2026-11-08T09:00:00Z', count: 1 };
    const { app, stop } = await started();
    try {
      await settle(FEED_POLL_MS);
      expect(toastOf(app)).toBeNull();
      waiting = { id: CY, name: 'Cy', at: '2026-11-08T10:00:00Z', count: 2 };
      await settle(FEED_POLL_MS);
      expect(toastOf(app)).toEqual({ id: CY, name: 'Cy', others: 1 });
      app.dismissRequestToast();
      expect(toastOf(app)).toBeNull();
      // The same request again: no second toast.
      await settle(FEED_POLL_MS * 2);
      expect(toastOf(app)).toBeNull();
    } finally {
      stop();
    }
  });

  it('announces a request in the first answer when the loaded list did not hold it yet', async () => {
    const { app, stop } = await started();
    try {
      waiting = { id: ADA, name: 'Ada', at: '2026-11-08T10:00:00Z', count: 1 };
      await settle(FEED_POLL_MS);
      expect(toastOf(app)).toEqual({ id: ADA, name: 'Ada', others: 0 });
    } finally {
      stop();
    }
  });

  it('patches nothing while nothing changes, and closes the toast once the request was answered or seen elsewhere', async () => {
    const { app, stop } = await started();
    try {
      let updates = 0;
      const unsubscribe = app.state.subscribe(() => updates++);
      updates = 0;
      await settle(FEED_POLL_MS * 3);
      expect(updates).toBe(0);
      waiting = { id: ADA, name: 'Ada', at: '2026-11-08T10:00:00Z', count: 1 };
      await settle(FEED_POLL_MS);
      // The count and the toast: two patches, then none while the same request waits.
      expect(toastOf(app)?.name).toBe('Ada');
      const after = updates;
      await settle(FEED_POLL_MS * 2);
      expect(updates).toBe(after);
      waiting = null;
      await settle(FEED_POLL_MS);
      expect(toastOf(app)).toBeNull();
      unsubscribe();
    } finally {
      stop();
    }
  });

  it('stays quiet while the activity page is open and does not announce that request afterwards', async () => {
    const { app, stop } = await started();
    try {
      app.navigate({ name: 'activity' });
      location.hash = '#/activity';
      window.dispatchEvent(new Event('hashchange'));
      await settle();
      expect(get(app.state).route.name).toBe('activity');
      waiting = { id: ADA, name: 'Ada', at: '2026-11-08T10:00:00Z', count: 1 };
      await settle(FEED_POLL_MS);
      expect(toastOf(app)).toBeNull();
      location.hash = '#/';
      window.dispatchEvent(new Event('hashchange'));
      await settle(FEED_POLL_MS);
      expect(get(app.state).route.name).toBe('discover');
      expect(toastOf(app)).toBeNull();
    } finally {
      stop();
    }
  });

  it('shows nothing against an API without the request fields', async () => {
    oldApi = true;
    const { app, stop } = await started();
    try {
      waiting = { id: ADA, name: 'Ada', at: '2026-11-08T10:00:00Z', count: 1 };
      await settle(FEED_POLL_MS * 2);
      expect(get(app.state).user?.feedUnread).toBe(1);
      expect(toastOf(app)).toBeNull();
    } finally {
      stop();
    }
  });

  it('drops the toast with the account and starts the next account from its baseline', async () => {
    const { app, stop } = await started();
    try {
      waiting = { id: ADA, name: 'Ada', at: '2026-11-08T10:00:00Z', count: 1 };
      await settle(FEED_POLL_MS);
      expect(toastOf(app)?.name).toBe('Ada');
      routes['POST /api/auth/logout'] = () => {
        routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
        return new Response(null, { status: 200 });
      };
      routes['GET /api/auth/clear-cache'] = () => new Response(null, { status: 204 });
      routes['POST /api/auth/login'] = () => {
        routes['GET /api/auth/me'] = () => Response.json({ ...ben, feedUnread: 1, feedBuddies: true, feedClubs: true });
        return new Response(null, { status: 200 });
      };
      await app.logout();
      expect(toastOf(app)).toBeNull();
      // Ben's request from Cy is already in the list his sign-in loads: no toast for it.
      incoming = [{ id: CY, displayName: 'Cy', avatarId: null, since: '2026-11-08T10:05:00Z' }];
      waiting = { id: CY, name: 'Cy', at: '2026-11-08T10:05:00Z', count: 1 };
      expect(await app.submitAuth({ mode: 'login', email: ben.email, password: 'secret' })).toBe('done');
      await settle(FEED_POLL_MS * 2);
      expect(get(app.state).user?.id).toBe(ben.id);
      expect(toastOf(app)).toBeNull();
    } finally {
      stop();
    }
  });

  it('never toasts a late answer asked before a sign-out, for the next account or the same one signed in again (FEED-2 review)', async () => {
    const { app, stop } = await started();
    try {
      routes['GET /api/auth/clear-cache'] = () => new Response(null, { status: 204 });
      const signOut = () => {
        routes['POST /api/auth/logout'] = () => {
          routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
          return new Response(null, { status: 200 });
        };
        return app.logout();
      };
      const signIn = async (who: typeof user) => {
        routes['POST /api/auth/login'] = () => {
          routes['GET /api/auth/me'] = () => Response.json({ ...who, feedUnread: 0, feedBuddies: true, feedClubs: true });
          return new Response(null, { status: 200 });
        };
        expect(await app.submitAuth({ mode: 'login', email: who.email, password: 'secret' })).toBe('done');
        await settle();
      };
      // Ada's request waits for Ana when the poll asks; the answer arrives after Ana signed out and Ben signed in.
      await settle(FEED_POLL_MS);
      hold = true;
      waiting = { id: ADA, name: 'Ada', at: '2026-11-08T10:00:00Z', count: 1 };
      await settle(FEED_POLL_MS);
      expect(held).toHaveLength(1);
      hold = false;
      waiting = null;
      await signOut();
      await signIn(ben);
      held[0]();
      await settle();
      expect(get(app.state).user?.id).toBe(ben.id);
      expect(toastOf(app)).toBeNull();
      // The same with Ana signing in again after Ada withdrew: the old answer is not her new baseline.
      await signOut();
      await signIn(user);
      hold = true;
      waiting = { id: ADA, name: 'Ada', at: '2026-11-08T10:10:00Z', count: 1 };
      await settle(FEED_POLL_MS);
      expect(held).toHaveLength(2);
      hold = false;
      waiting = null;
      await signOut();
      await signIn(user);
      held[1]();
      await settle();
      expect(get(app.state).user?.id).toBe(user.id);
      expect(toastOf(app)).toBeNull();
    } finally {
      stop();
    }
  });

  it('shows nothing from an answer that arrives after the app stopped (FEED-2 review)', async () => {
    const { app, stop } = await started();
    await settle(FEED_POLL_MS);
    hold = true;
    waiting = { id: ADA, name: 'Ada', at: '2026-11-08T10:00:00Z', count: 1 };
    await settle(FEED_POLL_MS);
    expect(held).toHaveLength(1);
    stop();
    held[0]();
    await settle();
    expect(toastOf(app)).toBeNull();
  });

  it('closes the toast when the account or activity page opens, and Dismiss without a toast patches nothing (FEED-2 review)', async () => {
    const { app, stop } = await started();
    try {
      const go = async (hash: string) => {
        location.hash = hash;
        window.dispatchEvent(new Event('hashchange'));
        await settle();
      };
      for (const [hash, name, minute] of [
        ['#/account', 'account', 10],
        ['#/activity', 'activity', 20],
      ] as const) {
        waiting = { id: CY, name: 'Cy', at: `2026-11-08T10:${minute}:00Z`, count: 1 };
        await settle(FEED_POLL_MS);
        expect(toastOf(app)?.name).toBe('Cy');
        await go(hash);
        expect(get(app.state).route.name).toBe(name);
        expect(toastOf(app)).toBeNull();
        await go('#/');
      }
      let updates = 0;
      const unsubscribe = app.state.subscribe(() => updates++);
      updates = 0;
      app.dismissRequestToast();
      expect(updates).toBe(0);
      unsubscribe();
    } finally {
      stop();
    }
  });

  it('asks nothing and shows nothing offline', async () => {
    const { app, stop } = await started();
    try {
      routes['GET /api/health'] = () => Promise.reject(new TypeError('Failed to fetch'));
      vi.stubGlobal('navigator', { onLine: false });
      window.dispatchEvent(new Event('offline'));
      await settle();
      expect(get(app.state).online).toBe(false);
      waiting = { id: ADA, name: 'Ada', at: '2026-11-08T10:00:00Z', count: 1 };
      await settle(FEED_POLL_MS * 3);
      expect(toastOf(app)).toBeNull();
    } finally {
      stop();
    }
  });
});
