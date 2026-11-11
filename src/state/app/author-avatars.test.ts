import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { avatarIdsConfirmed, forgetLoadedImages, imageUrl, networkReachable } from '../../lib/offline/offline';
import { readSnapshot } from '../../lib/offline/snapshots';
import { clubMember } from '../../test/fixtures';
import { flat, loaded, routes, tooMany, useMockApi } from './test-helpers';

useMockApi();

/** The profile pictures of other people (31-3): author IDs with the lists, stale IDs, reports, and the admin queue. */
beforeEach(() => {
  vi.stubGlobal('window', { scrollTo: vi.fn() });
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('location', { hash: '#/' });
  routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
  forgetLoadedImages();
  avatarIdsConfirmed.set(true);
});
afterEach(() => {
  forgetLoadedImages();
  avatarIdsConfirmed.set(true);
  networkReachable.set(true);
});

/** Counts the requests a route answers. */
function counted(route: string, answer: () => Response) {
  const seen = { count: 0 };
  routes[route] = () => {
    seen.count++;
    return answer();
  };
  return seen;
}
const authors =
  (...pairs: [string, string][]) =>
  () =>
    Response.json(pairs.map(([userId, avatarId]) => ({ userId, avatarId })));

describe('author pictures with the lists', () => {
  it('reads them in full with a load, by author ID, and saves the IDs with the snapshot', async () => {
    routes['GET /api/combinations/author-avatars'] = authors(['u2', 'a2'], ['u3', 'a3']);
    const { app } = await loaded();
    expect(get(app.state).authorAvatars).toEqual({ u2: 'a2', u3: 'a3' });
    await vi.waitFor(async () => expect((await readSnapshot('u1'))?.authorAvatars).toEqual({ u2: 'a2', u3: 'a3' }));
  });

  it('asks nothing of a guest, who never sees a picture', async () => {
    routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
    const seen = counted('GET /api/combinations/author-avatars', () => Response.json([]));
    const { app } = await loaded();
    expect(get(app.state).authorAvatars).toEqual({});
    expect(seen.count).toBe(0);
  });

  it('keeps what is shown when the read fails (a convenience must not cost the library)', async () => {
    routes['GET /api/combinations/author-avatars'] = authors(['u2', 'a2']);
    const { app } = await loaded();
    routes['GET /api/combinations/author-avatars'] = tooMany;
    await app.refresh();
    expect(flat(get(app.state))).toMatchObject({ authorAvatars: { u2: 'a2' }, loadFailed: false });
  });

  it('shows no picture of the saved snapshot for download until a load confirmed its IDs, offline included', async () => {
    routes['GET /api/combinations/author-avatars'] = authors(['u2', 'a2']);
    await loaded();
    expect(get(avatarIdsConfirmed)).toBe(true);
    avatarIdsConfirmed.set(false);
    // A second session of the same device: the snapshot shows at once, and its IDs wait for the answer.
    let release!: () => void;
    routes['GET /api/combinations/author-avatars'] = () => new Promise((resolve) => (release = () => resolve(authors(['u2', 'a2'])())));
    const { createAppController } = await import('./app-controller');
    const app = createAppController();
    const loading = app.refresh();
    await vi.waitFor(() => expect(flat(get(app.state)).loading).toBe(false));
    expect(get(app.state).authorAvatars).toEqual({ u2: 'a2' });
    expect(get(avatarIdsConfirmed)).toBe(false);
    await vi.waitFor(() => expect(release).toBeDefined());
    release();
    await loading;
    expect(get(avatarIdsConfirmed)).toBe(true);
  });
});

describe('a picture that answered 404', () => {
  /** A Cache Storage that holds nothing, so a picture is downloaded. */
  const emptyCaches = () =>
    vi.stubGlobal('caches', {
      has: async () => false,
      delete: async () => true,
      open: async () => ({ match: async () => undefined, put: async () => undefined, keys: async () => [], delete: async () => true }),
    });
  const missing = () => Response.json({ error: 'Profile picture not found' }, { status: 404 });

  it('reads the lists again once, so the next render has the new ID, and never asks for the old ID twice', async () => {
    routes['GET /api/combinations/author-avatars'] = authors(['u2', 'old']);
    routes['GET /api/avatars/old/small'] = missing;
    const { app } = await loaded();
    emptyCaches();
    routes['GET /api/clubs'] = () => Response.json([]);
    const reads = counted('GET /api/combinations/author-avatars', authors(['u2', 'new']));
    expect(await imageUrl('/api/avatars/old/small', 'u1')).toBeNull();
    await vi.waitFor(() => expect(get(app.state).authorAvatars).toEqual({ u2: 'new' }));
    expect(reads.count).toBe(1);
    // A second view, a second size, a second stale picture within the throttle: no more reads and no second request for the old ID.
    const oldAgain = counted('GET /api/avatars/old/small', missing);
    expect(await imageUrl('/api/avatars/old/small', 'u1')).toBeNull();
    expect(oldAgain.count).toBe(0);
    routes['GET /api/avatars/other/small'] = missing;
    expect(await imageUrl('/api/avatars/other/small', 'u1')).toBeNull();
    expect(reads.count).toBe(1);
  });

  it('takes the member and buddy lists along', async () => {
    const member = clubMember({ id: 'u2', displayName: 'Ada', avatarId: 'old' });
    routes['GET /api/clubs'] = () => Response.json([{ id: 'k1', name: 'Club', role: 'MEMBER' }]);
    routes['GET /api/clubs/k1/members'] = () => Response.json([member]);
    routes['GET /api/avatars/old/small'] = missing;
    const { app } = await loaded();
    expect(get(app.state).clubMembers.k1[0].avatarId).toBe('old');
    emptyCaches();
    routes['GET /api/clubs/k1/members'] = () => Response.json([{ ...member, avatarId: 'new' }]);
    await imageUrl('/api/avatars/old/small', 'u1');
    await vi.waitFor(() => expect(get(app.state).clubMembers.k1[0].avatarId).toBe('new'));
  });

  it('reads the buddy list again too (STATE-1a review: `reloadBuddies` handed back to the controller)', async () => {
    const buddy = { id: 'u3', displayName: 'Bea', avatarId: 'old', since: '2026-10-01T10:00:00Z' };
    const buddies = (avatarId: string) => () => Response.json({ buddies: [{ ...buddy, avatarId }], incoming: [], outgoing: [], hasLink: false });
    routes['GET /api/buddies'] = buddies('old');
    routes['GET /api/avatars/old/small'] = missing;
    const { app } = await loaded();
    expect(get(app.state).buddies.buddies[0].avatarId).toBe('old');
    emptyCaches();
    routes['GET /api/buddies'] = buddies('new');
    await imageUrl('/api/avatars/old/small', 'u1');
    await vi.waitFor(() => expect(get(app.state).buddies.buddies[0].avatarId).toBe('new'));
  });
});

describe('reporting a profile picture', () => {
  it('sends the reason once, trimmed by the dialog, and says thanks', async () => {
    const { app } = await loaded();
    const bodies: unknown[] = [];
    routes['POST /api/avatars/a2/reports'] = async (request) => {
      bodies.push(await request.json());
      return new Response(null, { status: 204 });
    };
    expect(await app.reportAvatar('a2', 'Shows someone else')).toBe(true);
    expect(bodies).toEqual([{ reason: 'Shows someone else' }]);
    expect(get(app.state)).toMatchObject({ toast: 'notices.avatarReported', formError: null });
    expect(await app.reportAvatar('a2', null)).toBe(true);
    expect(bodies[1]).toEqual({ reason: null });
  });

  it('answers the owner’s own picture with the server’s message at the report’s form', async () => {
    const { app } = await loaded();
    routes['POST /api/avatars/mine/reports'] = () => Response.json({ error: 'You cannot report your own profile picture; remove it instead' }, { status: 400 });
    expect(await app.reportAvatar('mine', null)).toBe(false);
    expect(get(app.state).formError).toEqual({ form: 'avatar-report', message: 'You cannot report your own profile picture; remove it instead' });
  });

  it('counts a picture that is already gone as done, says so and reads the lists again', async () => {
    routes['GET /api/combinations/author-avatars'] = authors(['u2', 'old']);
    const { app } = await loaded();
    routes['POST /api/avatars/old/reports'] = () => Response.json({ error: 'Profile picture not found' }, { status: 404 });
    const reads = counted('GET /api/combinations/author-avatars', authors(['u2', 'new']));
    expect(await app.reportAvatar('old', 'x')).toBe(true);
    expect(get(app.state).toast).toBe('notices.avatarAlreadyGone');
    await vi.waitFor(() => expect(get(app.state).authorAvatars).toEqual({ u2: 'new' }));
    expect(reads.count).toBe(1);
  });

  it('sends nothing offline', async () => {
    const { app } = await loaded();
    routes['GET /api/sync'] = () => Promise.reject(new TypeError('fetch failed'));
    await app.refresh();
    expect(get(app.state).online).toBe(false);
    const seen = counted('POST /api/avatars/a2/reports', () => new Response(null, { status: 204 }));
    expect(await app.reportAvatar('a2', null)).toBe(false);
    expect(seen.count).toBe(0);
  });
});

describe('the admin queue of profile pictures', () => {
  it('reads a page narrowed by status, and fails at its own form', async () => {
    const { app } = await loaded();
    const queries: string[] = [];
    routes['GET /api/admin/avatar-reports'] = (request) => {
      queries.push(new URL(request.url).search);
      return Response.json({ entries: [], hasMore: false });
    };
    expect(await app.loadAvatarReports(2, 'OPEN')).toEqual({ entries: [], hasMore: false });
    expect(await app.loadAvatarReports(0)).toEqual({ entries: [], hasMore: false });
    expect(queries).toEqual(['?page=2&status=OPEN', '?page=0']);
    routes['GET /api/admin/avatar-reports'] = () => Response.json({ error: 'Admin only' }, { status: 403 });
    expect(await app.loadAvatarReports(0)).toBeNull();
    expect(get(app.state).formError?.form).toBe('avatar-reports');
  });

  it('dismisses and removes by report ID, with a notice, and shows a conflict at the queue', async () => {
    const { app } = await loaded();
    const seen: string[] = [];
    routes['POST /api/admin/avatar-reports/r1/dismiss'] = () => (seen.push('dismiss'), new Response(null, { status: 204 }));
    routes['POST /api/admin/avatar-reports/r2/remove'] = () => (seen.push('remove'), new Response(null, { status: 204 }));
    routes['DELETE /api/avatars/a9'] = () => (seen.push('delete'), new Response(null, { status: 204 }));
    expect(await app.dismissAvatarReport('r1')).toBe(true);
    expect(get(app.state).toast).toBe('notices.avatarReportDismissed');
    expect(await app.removeReportedAvatar('r2')).toBe(true);
    expect(get(app.state).toast).toBe('notices.avatarReportRemoved');
    expect(await app.removeAvatarAsAdmin('a9')).toBe(true);
    expect(seen).toEqual(['dismiss', 'remove', 'delete']);
    routes['POST /api/admin/avatar-reports/r3/remove'] = () => Response.json({ error: 'This changed meanwhile. Please try again.' }, { status: 409 });
    expect(await app.removeReportedAvatar('r3')).toBe(false);
    expect(get(app.state).formError).toEqual({ form: 'avatar-reports', message: 'This changed meanwhile. Please try again.' });
  });
});
