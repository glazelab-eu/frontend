import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { flat, healthy, loaded, nginx, routes, tooMany, useMockApi } from './test-helpers';

useMockApi();

/**
 * The failed-request error is shown as a toast (26-7) straight from `AppState.error`: one message at a time that stays
 * until it is dismissed, replaced or cleared, so these are the rules the toast follows.
 */
describe('the error the toast shows', () => {
  it('stays until it is dismissed, however long nobody reacts', async () => {
    const { app } = await loaded();
    routes['GET /api/glazes'] = tooMany;
    await app.refresh();
    expect(flat(get(app.state))).toMatchObject({ error: 'Too many requests. Please wait a moment and try again.', loadFailed: true });
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(60_000);
    vi.useRealTimers();
    expect(get(app.state).error).not.toBe('');
    app.dismissError();
    expect(get(app.state).error).toBe('');
  });

  it('is replaced by a newer error, and an identical error is still one message', async () => {
    const { app } = await loaded();
    routes['GET /api/glazes'] = tooMany;
    await app.refresh();
    const seen: string[] = [];
    app.state.subscribe((state) => seen.push(state.error));
    await app.refresh();
    // The same text again: the same single value, never two.
    expect(new Set(seen.filter(Boolean)).size).toBe(1);
    routes['GET /api/glazes'] = nginx(503);
    await app.refresh();
    expect(get(app.state).error).toBe('The server is unreachable. Showing saved data when available.');
  });

  it('is cleared by a load that succeeds (Try again) and by the next write', async () => {
    const { app } = await loaded();
    routes['GET /api/glazes'] = nginx(502);
    await app.refresh();
    expect(flat(get(app.state))).toMatchObject({ loadFailed: true });
    expect(get(app.state).error).not.toBe('');
    routes['GET /api/glazes'] = healthy['GET /api/glazes'];
    await app.retry();
    expect(flat(get(app.state))).toMatchObject({ error: '', loadFailed: false });

    routes['PUT /api/favorites/glazes/g1'] = () => Response.json({ error: 'Request failed.' }, { status: 400 });
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    await app.setFavorite('glazes', 'g1', true);
    expect(get(app.state).error).toBe('Request failed.');
    routes['PUT /api/favorites/glazes/g1'] = () => new Response(null, { status: 204 });
    await app.setFavorite('glazes', 'g1', true);
    expect(get(app.state).error).toBe('');
  });
});
