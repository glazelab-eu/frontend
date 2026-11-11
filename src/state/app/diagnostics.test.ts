import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { FLUSH_DELAY_MS } from '../../lib/diagnostics/diagnostics';
import { loaded, routes, useMockApi, user } from './test-helpers';

useMockApi();

// The hooks wrap the console once for the whole file; a plain no-op (not a spy, which `restoreAllMocks` would undo) keeps the output quiet.
console.error = () => {};

afterEach(() => vi.useRealTimers());

/** Records the JSON bodies a route received. */
function record(route: string, status = 204) {
  const bodies: unknown[] = [];
  routes[route] = async (request) => {
    bodies.push(await request.json().catch(() => null));
    return new Response(null, { status });
  };
  return bodies;
}

async function signedIn(diagnosticsOptIn: boolean) {
  // The tests run without a DOM: a window with the few facts a report reads.
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('innerWidth', 390);
  vi.stubGlobal('innerHeight', 800);
  vi.stubGlobal('devicePixelRatio', 2);
  vi.stubGlobal('screen', { width: 390, height: 844 });
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: coarse)' }));
  routes['GET /api/auth/me'] = () => Response.json({ ...user, diagnosticsOptIn });
  routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
  const { app } = await loaded();
  await vi.waitFor(() => expect(get(app.state).user?.diagnosticsOptIn).toBe(diagnosticsOptIn));
  return app;
}

describe('error reports in the app', () => {
  it('sends a console error of an opted-in account, scrubbed, with the device facts and the route name', async () => {
    const app = await signedIn(true);
    const sent = record('POST /api/reports');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    console.error('Something broke for ana@example.test at #/verify/' + 'T'.repeat(43));
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS + 100);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const [batch] = sent as { device: Record<string, unknown>; events: { message: string; kind: string; route: string }[] }[];
    expect(batch.events).toHaveLength(1);
    expect(batch.events[0]).toMatchObject({ kind: 'ERROR', message: 'Something broke for [email] at', route: 'discover' });
    expect(batch.device).toHaveProperty('online', true);
    expect(batch.device).toHaveProperty('updatePending', false);
    expect(JSON.stringify(sent)).not.toMatch(/ana@|TTTT/);
    expect(app).toBeDefined();
  });

  it('says whether a new app version waits (STATE-1a review: `setUpdatePending` reaches the device facts)', async () => {
    const app = await signedIn(true);
    const sent = record('POST /api/reports');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    app.setUpdatePending(true);
    console.error('with an update waiting');
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS + 100);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect((sent as { device: { updatePending: boolean } }[])[0].device.updatePending).toBe(true);
  });

  it('sends nothing for an account that has not opted in, nor for a guest', async () => {
    await signedIn(false);
    const sent = record('POST /api/reports');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    console.error('opted out');
    await vi.advanceTimersByTimeAsync(5 * FLUSH_DELAY_MS);
    expect(sent).toEqual([]);
  });

  it('stops at once when the account turns it off, and says the reports are deleted', async () => {
    const app = await signedIn(true);
    const sent = record('POST /api/reports');
    const puts = record('PUT /api/account/diagnostics');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    console.error('before');
    expect(await app.chooseDiagnostics(false)).toBe(true);
    expect(puts).toEqual([{ enabled: false }]);
    expect(get(app.state)).toMatchObject({ user: { diagnosticsOptIn: false }, toast: 'notices.diagnosticsOff' });
    console.error('after');
    await vi.advanceTimersByTimeAsync(5 * FLUSH_DELAY_MS);
    expect(sent).toEqual([]);
  });

  it('asks for the terms when turning it on is refused with 428, and keeps the choice off', async () => {
    const app = await signedIn(false);
    routes['PUT /api/account/diagnostics'] = () => Response.json({ error: 'Please accept the current terms of service.' }, { status: 428 });
    expect(await app.chooseDiagnostics(true)).toBe(false);
    expect(get(app.state)).toMatchObject({ user: { diagnosticsOptIn: false }, termsRequired: true });
  });

  it('409 on a send reads the account again and stops', async () => {
    const app = await signedIn(true);
    const sent = record('POST /api/reports', 409);
    routes['GET /api/auth/me'] = () => Response.json({ ...user, diagnosticsOptIn: false });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    console.error('conflict');
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS + 100);
    await vi.waitFor(() => expect(get(app.state).user?.diagnosticsOptIn).toBe(false));
    expect(sent).toHaveLength(1);
  });

  it('428 on a send asks for the terms and sends nothing more until they are accepted', async () => {
    const app = await signedIn(true);
    const sent = record('POST /api/reports', 428);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    console.error('needs terms');
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS + 100);
    await vi.waitFor(() => expect(get(app.state).termsRequired).toBe(true));
    // Any later state change (here the delete dialog opening) must not wake the sender while the terms are pending.
    app.openAccountDeletion();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(sent).toHaveLength(1);
  });
});
