import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { readLastUser } from '../../lib/offline/offline';
import { loaded, routes, useMockApi, user } from './test-helpers';

useMockApi();

/** Records the JSON bodies a route received. */
function record(route: string, status = 204) {
  const bodies: unknown[] = [];
  routes[route] = async (request) => {
    bodies.push(await request.json().catch(() => null));
    return new Response(null, { status });
  };
  return bodies;
}

async function signedIn(feedUnread: number) {
  routes['GET /api/auth/me'] = () => Response.json({ ...user, feedUnread, feedBuddies: true, feedClubs: true });
  routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
  const { app } = await loaded();
  await vi.waitFor(() => expect(get(app.state).user?.feedUnread).toBe(feedUnread));
  return app;
}

describe('the activity feed in the app', () => {
  it('reads the badge with the account and clears it once the page was seen, also in the saved account', async () => {
    const app = await signedIn(4);
    const seen = record('POST /api/feed/seen');
    expect(await app.markFeedSeen('2026-11-08T10:00:00Z')).toBe(true);
    expect(seen).toEqual([{ through: '2026-11-08T10:00:00Z' }]);
    expect(get(app.state).user?.feedUnread).toBe(0);
    expect(readLastUser()?.feedUnread).toBe(0);
  });

  it('keeps the badge when the seen position could not be saved, without an error', async () => {
    const app = await signedIn(4);
    routes['POST /api/feed/seen'] = () => Response.json({ error: 'Too many requests' }, { status: 429 });
    expect(await app.markFeedSeen('2026-11-08T10:00:00Z')).toBe(false);
    expect(get(app.state)).toMatchObject({ user: { feedUnread: 4 }, error: '' });
  });

  it('saves the sources and reads the badge again', async () => {
    const app = await signedIn(4);
    const puts = record('PUT /api/account/feed');
    routes['GET /api/auth/me'] = () => Response.json({ ...user, feedUnread: 1, feedBuddies: false, feedClubs: true });
    expect(await app.chooseFeed(false, true)).toBe(true);
    expect(puts).toEqual([{ buddies: false, clubs: true }]);
    expect(get(app.state)).toMatchObject({ user: { feedBuddies: false, feedClubs: true, feedUnread: 1 }, toast: 'notices.feedSaved' });
  });

  it('reads a page, and reports a failure at the page', async () => {
    const app = await signedIn(0);
    routes['GET /api/feed'] = () => Response.json({ entries: [], next: null, seenAt: null });
    expect(await app.loadFeed()).toEqual({ entries: [], next: null, seenAt: null });
    routes['GET /api/feed'] = () => Response.json({ error: 'Something went wrong' }, { status: 500 });
    expect(await app.loadFeed()).toBeNull();
  });
});
