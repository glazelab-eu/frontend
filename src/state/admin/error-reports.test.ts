import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { loaded, routes, useMockApi } from '../app/test-helpers';

useMockApi();

/** Reading the error reports (32-3): the lists through the controller, deleting, and refusals. */
beforeEach(() => {
  vi.stubGlobal('window', { scrollTo: vi.fn() });
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('location', { hash: '#/' });
  routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
});

describe('error report lists', () => {
  it('asks for a page with the set filters only', async () => {
    const { app } = await loaded();
    const urls: string[] = [];
    routes['GET /api/admin/error-reports'] = (request) => (urls.push(new URL(request.url).search), Response.json({ groups: [], hasMore: false }));
    expect(await app.loadErrorReportGroups(2, { kind: 'ERROR', q: 'boom' })).toEqual({ groups: [], hasMore: false });
    expect(await app.loadErrorReportGroups(0, {})).toEqual({ groups: [], hasMore: false });
    expect(urls).toEqual(['?page=2&kind=ERROR&q=boom', '?page=0']);
  });

  it('shows a failed list at the page’s form and answers null', async () => {
    const { app } = await loaded();
    routes['GET /api/admin/error-reports'] = () => Response.json({ error: 'Site admin role required' }, { status: 403 });
    expect(await app.loadErrorReportGroups(0, {})).toBeNull();
    expect(get(app.state).formError).toMatchObject({ form: 'error-reports' });
  });

  it('reads one message’s reports by its fingerprint', async () => {
    const { app } = await loaded();
    routes['GET /api/admin/error-reports/abc/occurrences'] = (request) =>
      Response.json({ occurrences: [], hasMore: false, search: new URL(request.url).search });
    expect(await app.loadErrorReportOccurrences('abc', 1)).toMatchObject({ search: '?page=1' });
  });
});

describe('deleting error reports', () => {
  it('deletes a whole message and one report and says so', async () => {
    const { app } = await loaded();
    const calls: string[] = [];
    routes['DELETE /api/admin/error-reports/abc'] = () => (calls.push('group'), new Response(null, { status: 204 }));
    routes['DELETE /api/admin/error-reports/occurrences/r1'] = () => (calls.push('one'), new Response(null, { status: 204 }));
    expect(await app.deleteErrorReports({ fingerprint: 'abc' })).toBe(true);
    expect(get(app.state)).toMatchObject({ toast: 'notices.errorReportGroupDeleted' });
    expect(await app.deleteErrorReports({ id: 'r1' })).toBe(true);
    expect(get(app.state)).toMatchObject({ toast: 'notices.errorReportDeleted' });
    expect(calls).toEqual(['group', 'one']);
  });

  it('shows a report that was gone meanwhile at the delete form', async () => {
    const { app } = await loaded();
    routes['DELETE /api/admin/error-reports/abc'] = () => Response.json({ error: 'Report not found' }, { status: 404 });
    expect(await app.deleteErrorReports({ fingerprint: 'abc' })).toBe(false);
    expect(get(app.state).formError).toMatchObject({ form: 'error-report-delete', message: 'Report not found' });
  });

  it('is silent offline', async () => {
    const { app } = await loaded();
    vi.stubGlobal('navigator', { onLine: false });
    await app.refresh();
    let sent = 0;
    routes['DELETE /api/admin/error-reports/abc'] = () => (sent++, new Response(null, { status: 204 }));
    expect(await app.deleteErrorReports({ fingerprint: 'abc' })).toBe(false);
    expect(sent).toBe(0);
  });
});
