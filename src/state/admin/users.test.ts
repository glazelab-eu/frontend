import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { loaded, routes, useMockApi } from '../app/test-helpers';

useMockApi();

beforeEach(() => {
  vi.stubGlobal('window', { scrollTo: vi.fn() });
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('location', { hash: '#/' });
});

describe('the account list of the site admins', () => {
  it('reads pages by number and fails at its own form', async () => {
    const { app } = await loaded();
    const queries: string[] = [];
    const page = { entries: [{ id: 'u1', displayName: 'Ada', email: 'ada@example.test', status: 'ACTIVE', siteAdmin: false }], hasMore: true };
    routes['GET /api/admin/users'] = (request) => {
      queries.push(new URL(request.url).search);
      return Response.json(page);
    };
    expect(await app.loadUsers(0)).toEqual(page);
    expect(await app.loadUsers(2)).toEqual(page);
    expect(queries).toEqual(['?page=0', '?page=2']);
    routes['GET /api/admin/users'] = () => Response.json({ error: 'Admin only' }, { status: 403 });
    expect(await app.loadUsers(0)).toBeNull();
    expect(get(app.state).formError?.form).toBe('users');
  });
});
