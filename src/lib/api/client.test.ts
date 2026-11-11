import { termsVersion } from './terms';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCESS_DENIED, ACTIVATION_REQUIRED, api, ApiError, errorMessage, resetCsrf, TOO_MANY_REQUESTS } from './client';
import { serverMessages } from '../i18n/server-messages';

type Handler = (request: Request) => Response | Promise<Response>;

// The generated client resolves globalThis.fetch for every request, so a stub installed before
// each test intercepts both API calls and the CSRF lookup in the request interceptor.
let routes: Record<string, Handler>;
let requests: Request[];
let csrfTokens: number;

const route = (request: Request) => `${request.method} ${new URL(request.url).pathname}`;
const calls = (key: string) => requests.filter((request) => route(request) === key);
const csrfRoute: Handler = () => Response.json({ token: `token-${++csrfTokens}` });
const empty = () => new Response(null, { status: 204 });
const glaze = { manufacturerId: 'm1', name: 'Blue', code: 'PC-20' };

beforeEach(() => {
  resetCsrf();
  routes = { 'GET /api/auth/csrf': csrfRoute };
  requests = [];
  csrfTokens = 0;
  vi.stubGlobal('fetch', async (request: Request) => {
    requests.push(request.clone());
    const handler = routes[route(request)];
    if (!handler) throw new Error(`Unexpected request: ${route(request)}`);
    return handler(request);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CSRF handling', () => {
  it('fetches the token once and sends it only on unsafe methods', async () => {
    routes['GET /api/glazes'] = () => Response.json([]);
    routes['POST /api/glazes'] = () => Response.json({ id: 'g1' });

    await api.glazes();
    await api.addGlaze(glaze);
    await api.addGlaze(glaze);

    expect(calls('GET /api/auth/csrf')).toHaveLength(1);
    expect(calls('GET /api/glazes')[0].headers.has('X-XSRF-TOKEN')).toBe(false);
    for (const request of calls('POST /api/glazes')) {
      expect(request.headers.get('X-XSRF-TOKEN')).toBe('token-1');
    }
  });

  it('fetches a new token after resetCsrf', async () => {
    routes['POST /api/glazes'] = () => Response.json({ id: 'g1' });

    await api.addGlaze(glaze);
    resetCsrf();
    await api.addGlaze(glaze);

    expect(calls('GET /api/auth/csrf')).toHaveLength(2);
    const tokens = calls('POST /api/glazes').map((request) => request.headers.get('X-XSRF-TOKEN'));
    expect(tokens).toEqual(['token-1', 'token-2']);
  });

  it('clears the cached token when the CSRF request fails', async () => {
    routes['POST /api/glazes'] = () => Response.json({ id: 'g1' });
    routes['GET /api/auth/csrf'] = () => new Response(null, { status: 503 });

    await expect(api.addGlaze(glaze)).rejects.toBeInstanceOf(ApiError);
    expect(calls('POST /api/glazes')).toHaveLength(0);

    routes['GET /api/auth/csrf'] = csrfRoute;
    await api.addGlaze(glaze);

    expect(calls('GET /api/auth/csrf')).toHaveLength(2);
    expect(calls('POST /api/glazes')[0].headers.get('X-XSRF-TOKEN')).toBe('token-1');
  });

  // FE-4: another tab's sign-in, sign-out or link confirmation renews the cookie; this page's cached token is then refused.
  const deniedFor =
    (stale: string): Handler =>
    (request) =>
      request.headers.get('X-XSRF-TOKEN') === stale ? Response.json({ error: ACCESS_DENIED }, { status: 403 }) : Response.json({ id: 'g1' });

  it('fetches a fresh token once after a CSRF refusal and repeats the write with the same body', async () => {
    routes['POST /api/glazes'] = deniedFor('token-1');

    expect(await api.addGlaze(glaze)).toEqual({ id: 'g1' });

    expect(calls('GET /api/auth/csrf')).toHaveLength(2);
    const sent = calls('POST /api/glazes');
    expect(sent.map((request) => request.headers.get('X-XSRF-TOKEN'))).toEqual(['token-1', 'token-2']);
    expect(await sent[1].json()).toEqual(glaze);
    // The fresh token stays for the next write.
    await api.addGlaze(glaze);
    expect(calls('GET /api/auth/csrf')).toHaveLength(2);
  });

  it('repeats a refused write only once', async () => {
    routes['POST /api/glazes'] = () => Response.json({ error: ACCESS_DENIED }, { status: 403 });

    await expect(api.addGlaze(glaze)).rejects.toMatchObject({ status: 403, message: ACCESS_DENIED });

    expect(calls('POST /api/glazes')).toHaveLength(2);
    expect(calls('GET /api/auth/csrf')).toHaveLength(2);
  });

  it('never repeats a 403 that is no CSRF refusal', async () => {
    routes['POST /api/glazes'] = () => Response.json({ error: 'Only site admins can do this.' }, { status: 403 });

    await expect(api.addGlaze(glaze)).rejects.toMatchObject({ status: 403 });

    expect(calls('POST /api/glazes')).toHaveLength(1);
    expect(calls('GET /api/auth/csrf')).toHaveLength(1);
  });

  it('fetches one fresh token for writes that were refused together', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deny = deniedFor('token-1');
    routes['POST /api/glazes'] = async (request) => {
      if (request.headers.get('X-XSRF-TOKEN') === 'token-1') await held;
      return deny(request);
    };

    const writes = Promise.all([api.addGlaze(glaze), api.addGlaze(glaze), api.addGlaze(glaze)]);
    await vi.waitFor(() => expect(calls('POST /api/glazes')).toHaveLength(3));
    release();
    await writes;

    expect(calls('GET /api/auth/csrf')).toHaveLength(2);
    const tokens = calls('POST /api/glazes').map((request) => request.headers.get('X-XSRF-TOKEN'));
    expect(tokens).toEqual(['token-1', 'token-1', 'token-1', 'token-2', 'token-2', 'token-2']);
  });

  // Firefox has no `Request.body` getter: a write must still carry its body there, first try and repeat.
  it('sends the body of a write in a browser without Request.body', async () => {
    const body = Object.getOwnPropertyDescriptor(Request.prototype, 'body');
    Object.defineProperty(Request.prototype, 'body', { configurable: true, get: () => undefined });
    try {
      routes['POST /api/glazes'] = deniedFor('token-1');
      routes['DELETE /api/stock/s1'] = empty;
      await api.addGlaze(glaze);
      await api.removeStock('s1');
    } finally {
      Object.defineProperty(Request.prototype, 'body', body!);
    }
    const sent = calls('POST /api/glazes');
    expect(sent).toHaveLength(2);
    for (const request of sent) expect(await request.json()).toEqual(glaze);
    expect(await calls('DELETE /api/stock/s1')[0].text()).toBe('');
  });

  it('repeats a refused upload as the same multipart body with its boundary and length', async () => {
    routes['POST /api/avatars'] = deniedFor('token-1');
    const file = new File([new Uint8Array(300_000).fill(7)], 'a.png', { type: 'image/png' });
    await api.uploadAvatar(file);
    const sent = calls('POST /api/avatars');
    expect(sent).toHaveLength(2);
    for (const request of sent) {
      const part = (await request.formData()).get('file') as File;
      expect(part.size).toBe(300_000);
    }
  });

  it('answers the refusal when no fresh token can be fetched', async () => {
    routes['POST /api/glazes'] = deniedFor('token-1');
    routes['GET /api/auth/csrf'] = () => (++csrfTokens === 1 ? Response.json({ token: 'token-1' }) : new Response(null, { status: 503 }));

    await expect(api.addGlaze(glaze)).rejects.toMatchObject({ status: 403, message: ACCESS_DENIED });

    expect(calls('POST /api/glazes')).toHaveLength(1);
  });
});

describe('request encoding', () => {
  it.each([
    ['/api/auth/verification/confirm', api.verifyEmail],
    ['/api/auth/magic/confirm', api.confirmMagicLink],
  ] as const)('keeps the %s activation challenge and submits fresh credentials on confirmation', async (path, confirm) => {
    routes[`POST ${path}`] = async (request) => {
      const body = await request.json();
      return body.password ? empty() : Response.json({ error: ACTIVATION_REQUIRED }, { status: 409 });
    };
    await expect(confirm('mailbox-token')).rejects.toMatchObject({
      status: 409,
      message: ACTIVATION_REQUIRED,
    });
    await confirm('mailbox-token', {
      password: 'owner-fresh-password',
      displayName: 'Mailbox owner',
      termsAccepted: true,
      diagnosticsOptIn: false,
    });
    expect(await calls(`POST ${path}`)[0].json()).toEqual({ token: 'mailbox-token' });
    // The activation is the consent: the terms version this app shows goes with it.
    expect(await calls(`POST ${path}`)[1].json()).toEqual({
      token: 'mailbox-token',
      password: 'owner-fresh-password',
      displayName: 'Mailbox owner',
      termsAccepted: true,
      termsVersion,
      diagnosticsOptIn: false,
    });
    expect(calls('GET /api/auth/csrf')).toHaveLength(1);
  });

  it('includes first-activation details in a password reset without changing verified resets', async () => {
    routes['POST /api/auth/password/reset'] = empty;
    await api.resetPassword('reset-token', 'fresh-password');
    await api.resetPassword('reset-token', 'fresh-password', {
      password: 'fresh-password',
      displayName: 'Mailbox owner',
      termsAccepted: true,
      diagnosticsOptIn: true,
    });
    const sent = await Promise.all(calls('POST /api/auth/password/reset').map((request) => request.json()));
    expect(sent).toEqual([
      { token: 'reset-token', password: 'fresh-password' },
      { token: 'reset-token', password: 'fresh-password', displayName: 'Mailbox owner', termsAccepted: true, termsVersion, diagnosticsOptIn: true },
    ]);
  });

  it('sends login credentials as a form', async () => {
    routes['POST /api/auth/login'] = empty;

    await api.login('ana@example.test', 'secret & more');

    const [request] = calls('POST /api/auth/login');
    expect(request.headers.get('Content-Type')).toContain('application/x-www-form-urlencoded');
    const form = new URLSearchParams(await request.text());
    expect(Object.fromEntries(form)).toEqual({
      email: 'ana@example.test',
      password: 'secret & more',
    });
  });

  it.each([
    ['combination', 'combinations', 'CLUB', 'club-1'],
    ['combination', 'combinations', 'PRIVATE', null],
    ['glaze', 'glazes', 'CLUB', 'club-1'],
    ['glaze', 'glazes', 'PUBLIC', null],
  ] as const)('uploads a %s image (%s path) with %s visibility as multipart form data', async (type, path, visibility, clubId) => {
    const key = `POST /api/${path}/target-1/images`;
    routes[key] = () => Response.json({ id: 'image-1' });
    const file = new File(['tile'], 'tile.png', { type: 'image/png' });

    await api.uploadImage({
      target: { type, id: 'target-1' },
      file,
      visibility,
      kind: 'TEST_TILE',
      clubId: 'club-1',
    });

    const [request] = calls(key);
    expect(request.headers.get('Content-Type')).toMatch(/^multipart\/form-data; boundary=/);
    const query = new URL(request.url).searchParams;
    expect(query.get('visibility')).toBe(visibility);
    expect(query.get('kind')).toBe('TEST_TILE');
    expect(query.get('clubId')).toBe(clubId);
    const uploaded = (await request.formData()).get('file');
    expect(uploaded).toBeInstanceOf(File);
    expect(await (uploaded as File).text()).toBe('tile');
  });

  it.each([
    ['glazes', true, 'PUT'],
    ['glazes', false, 'DELETE'],
    ['combinations', true, 'PUT'],
    ['combinations', false, 'DELETE'],
  ] as const)('sets %s favorite %s with %s', async (kind, active, method) => {
    const key = `${method} /api/favorites/${kind}/item-1`;
    routes[key] = empty;

    await api.setFavorite(kind, 'item-1', active);

    expect(calls(key)).toHaveLength(1);
  });
});

describe('error mapping', () => {
  it('shows an error’s message and the generic key for anything else', () => {
    expect(errorMessage(new ApiError('Not allowed.', 403))).toBe('Not allowed.');
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('boom')).toBe('errors.generic');
    expect(errorMessage(undefined)).toBe('errors.generic');
  });

  const unreachable = 'The server is unreachable. Showing saved data when available.';

  it.each([
    ['the server error message and status', 'POST /api/glazes', () => Response.json({ error: 'x' }, { status: 409 }), () => api.addGlaze(glaze), 'x', 409],
    ['an empty 401 as "sign in"', 'GET /api/auth/me', () => new Response(null, { status: 401 }), () => api.me(), 'Please sign in.', 401],
    ['a network failure as unreachable', 'GET /api/auth/me', () => Promise.reject(new TypeError('fetch failed')), () => api.me(), unreachable, 0],
    ['a 5xx error with a message by its status', 'GET /api/glazes', () => Response.json({ error: 'Boom' }, { status: 503 }), () => api.glazes(), 'Boom', 503],
    [
      'a server error without a message as unreachable',
      'GET /api/auth/me',
      () => new Response('Internal error', { status: 500 }),
      () => api.me(),
      unreachable,
      0,
    ],
  ] as const)('maps %s', async (_case, key, respond, call, message, status) => {
    routes[key] = respond;

    const error = await call().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ message, status });
  });

  it.each([502, 503, 504])('reports an nginx %i HTML page as unreachable', async (status) => {
    routes['GET /api/glazes'] = () =>
      new Response(`<html><body><center><h1>${status}</h1></center></body></html>`, {
        status,
        headers: { 'Content-Type': 'text/html' },
      });

    await expect(api.glazes()).rejects.toMatchObject({ message: unreachable, status: 0 });
  });

  it('reports a 429 as rate limited, with the API JSON body or a bare proxy page', async () => {
    routes['GET /api/glazes'] = () => Response.json({ error: TOO_MANY_REQUESTS }, { status: 429, headers: { 'Retry-After': '5' } });
    await expect(api.glazes()).rejects.toMatchObject({ message: TOO_MANY_REQUESTS, status: 429 });

    routes['GET /api/glazes'] = () =>
      new Response('<html>429 Too Many Requests</html>', {
        status: 429,
        headers: { 'Content-Type': 'text/html' },
      });
    await expect(api.glazes()).rejects.toMatchObject({ message: TOO_MANY_REQUESTS, status: 429 });
    expect(serverMessages[TOO_MANY_REQUESTS]).toBe('errors.tooManyRequests');
  });

  it("keeps the API's own 429 text: a delayed sign-in says why", async () => {
    const delayed = 'Too many failed sign-ins for this address. Please wait a few minutes or sign in with an email link.';
    routes['POST /api/auth/login'] = () => Response.json({ error: delayed }, { status: 429, headers: { 'Retry-After': '60' } });
    await expect(api.login('a@example.test', 'secret-1')).rejects.toMatchObject({ message: delayed, status: 429 });
    expect(serverMessages[delayed]).toBe('errors.signInDelayed');
  });
});
