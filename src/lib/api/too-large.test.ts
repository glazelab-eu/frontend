import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { api, ApiError, resetCsrf } from './client';
import { errorText, setLocale, translate } from '../i18n';

// Nginx answers a body over its `client_max_body_size` itself, before the API sees it. Both configs
// (`nginx.conf.template` and the deployment's Nginx config) send this exact JSON for every /api/ location.
const NGINX_413_BODY = '{"error":"This request is too large."}';

beforeEach(() => {
  resetCsrf();
  vi.stubGlobal('fetch', async (request: Request) => {
    const key = `${request.method} ${new URL(request.url).pathname}`;
    if (key === 'GET /api/auth/csrf') return Response.json({ token: 'csrf' });
    if (key === 'POST /api/glazes') return new Response(NGINX_413_BODY, { status: 413, headers: { 'Content-Type': 'application/json' } });
    throw new Error(`Unexpected request: ${key}`);
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await setLocale('en');
});

describe("the proxy's 413 answer", () => {
  it('reaches the app as the API’s own refusal and reads translated', async () => {
    const error = await api.addGlaze({ manufacturerId: 'm1', name: 'Blue', code: 'PC-20' }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ message: 'This request is too large.', status: 413 });
    const message = (error as ApiError).message;
    expect(get(errorText)(message)).toBe(translate('errors.requestTooLarge'));
    await setLocale('de');
    expect(get(errorText)(message)).toBe(translate('errors.requestTooLarge', { locale: 'de' }));
    expect(get(errorText)(message)).not.toBe(translate('errors.requestTooLarge', { locale: 'en' }));
  });
});
