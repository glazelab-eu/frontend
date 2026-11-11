import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { loaded, routes, useMockApi } from '../app/test-helpers';

useMockApi();

/** The site admins' bans (34-2): the ban itself, its reload and refusals, the list and lifting. */
beforeEach(() => {
  vi.stubGlobal('window', { scrollTo: vi.fn() });
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('location', { hash: '#/' });
  routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
});

describe('banning an account', () => {
  it('sends the reason and the picture choice, reads the lists again and says who was banned', async () => {
    const { app } = await loaded();
    const bodies: unknown[] = [];
    routes['POST /api/admin/users/u9/ban'] = async (request) => (bodies.push(await request.json()), new Response(null, { status: 204 }));
    let clubReads = 0;
    routes['GET /api/clubs'] = () => (clubReads++, Response.json([]));
    expect(await app.banUser('u9', 'Ben', 'Harassed members', true)).toBe(true);
    expect(bodies).toEqual([{ reason: 'Harassed members', blockPictures: true }]);
    expect(clubReads).toBeGreaterThan(0);
    expect(get(app.state)).toMatchObject({ toast: 'notices.banned', toastValues: { name: 'Ben' }, formError: null });
    expect(await app.banUser('u8', 'Cleo', 'Spam', false)).toBe(false);
  });

  it.each([
    [409, 'You cannot ban your own account.'],
    [409, 'Site admins cannot be banned.'],
    [409, 'This changed meanwhile. Please try again.'],
    [404, 'Account not found'],
  ])('answers %i (%s) at the dialog’s form after reading the lists again', async (status, message) => {
    const { app } = await loaded();
    routes['POST /api/admin/users/u9/ban'] = () => Response.json({ error: message }, { status });
    let clubReads = 0;
    routes['GET /api/clubs'] = () => (clubReads++, Response.json([]));
    expect(await app.banUser('u9', 'Ben', 'Reason', false)).toBe(false);
    expect(clubReads).toBeGreaterThan(0);
    expect(get(app.state)).toMatchObject({ toast: '', formError: { form: 'ban', message } });
  });

  it('keeps the lists when the failure is not a conflict', async () => {
    const { app } = await loaded();
    routes['POST /api/admin/users/u9/ban'] = () => Response.json({ error: 'Admin only' }, { status: 403 });
    let clubReads = 0;
    routes['GET /api/clubs'] = () => (clubReads++, Response.json([]));
    expect(await app.banUser('u9', 'Ben', 'Reason', false)).toBe(false);
    expect(clubReads).toBe(0);
  });

  it('is one ban at a time per account and silent offline', async () => {
    const { app } = await loaded();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let sent = 0;
    routes['POST /api/admin/users/u9/ban'] = async () => (sent++, await gate, new Response(null, { status: 204 }));
    const first = app.banUser('u9', 'Ben', 'Reason', false);
    expect(await app.banUser('u9', 'Ben', 'Reason', false)).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(sent).toBe(1);
  });
});

describe('the list of bans', () => {
  it('reads pages by number and fails at its own form', async () => {
    const { app } = await loaded();
    const queries: string[] = [];
    routes['GET /api/admin/bans'] = (request) => {
      queries.push(new URL(request.url).search);
      return Response.json({ entries: [], hasMore: false });
    };
    expect(await app.loadBans(0)).toEqual({ entries: [], hasMore: false });
    expect(await app.loadBans(3)).toEqual({ entries: [], hasMore: false });
    expect(queries).toEqual(['?page=0', '?page=3']);
    routes['GET /api/admin/bans'] = () => Response.json({ error: 'Admin only' }, { status: 403 });
    expect(await app.loadBans(0)).toBeNull();
    expect(get(app.state).formError?.form).toBe('bans');
  });

  it('lifts a ban with a notice, and shows a ban that is gone at its own form', async () => {
    const { app } = await loaded();
    const seen: string[] = [];
    routes['DELETE /api/admin/bans/b1'] = () => (seen.push('b1'), new Response(null, { status: 204 }));
    expect(await app.unbanUser('b1')).toBe(true);
    expect(get(app.state)).toMatchObject({ toast: 'notices.banLifted' });
    routes['DELETE /api/admin/bans/b2'] = () => Response.json({ error: 'Ban not found' }, { status: 404 });
    expect(await app.unbanUser('b2')).toBe(false);
    expect(get(app.state).formError).toEqual({ form: 'unban', message: 'Ban not found' });
    expect(seen).toEqual(['b1']);
  });
});
