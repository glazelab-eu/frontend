import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { AuthOptions } from '../../lib/api/models';
import { readSnapshot } from '../../lib/offline/snapshots';
import { get } from 'svelte/store';
import { createAppController } from './app-controller';
import { termsVersion } from '../../lib/api/terms';
import { clubMember, combination, imageInfo, stockItem } from '../../test/fixtures';
import { cachesDeleted, flat, glaze, listing, loaded, nginx, routes, tooMany, unreachable, useMockApi, user } from './test-helpers';

useMockApi();

/** The shape of a club invite token (43 base64url characters). */
const inviteToken = 'I'.repeat(43);

describe('registration', () => {
  const input = { mode: 'register' as const, email: 'new@example.test', displayName: 'New potter' };
  /** The setup step's form: the terms ticked, error reports as chosen. */
  const activation = (password: string, diagnosticsOptIn = false) => ({ password, displayName: 'Ana', termsAccepted: true, diagnosticsOptIn });
  const setupToken = 'S'.repeat(43);

  /** A guest with the sign-in dialog open, on a server with or without mail. */
  async function guest(emailEnabled: boolean) {
    routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
    routes['GET /api/auth/options'] = () => Response.json({ emailEnabled, termsVersion });
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    vi.stubGlobal('location', { hash: '#/' });
    const { app } = await loaded();
    app.openAuth();
    await vi.waitFor(() => expect(get(app.state).authOptions).toMatchObject({ emailEnabled }));
    return app;
  }

  /** Records the bodies a route received and answers each with `answer`. */
  function record(route: string, answer: () => Response) {
    const bodies: unknown[] = [];
    routes[route] = async (request) => {
      bodies.push(request.headers.get('Content-Type')?.includes('json') ? await request.json() : await request.text());
      return answer();
    };
    return bodies;
  }

  it('with mail, sends no password and keeps the dialog open to say the link was emailed', async () => {
    const app = await guest(true);
    const sent = record('POST /api/auth/register', () => Response.json({ verificationRequired: true, setupToken: null }));
    expect(await app.submitAuth(input)).toBe('mail');
    expect(sent).toEqual([{ email: 'new@example.test', displayName: 'New potter' }]);
    expect(get(app.state)).toMatchObject({ authOpen: true, accountSetup: null, formError: null, toast: '' });
    // The check-email step offers the existing resend request for the same address.
    const resent = record('POST /api/auth/verification/request', () => new Response(null, { status: 200 }));
    expect(await app.requestAccountMail('verify', 'new@example.test')).toBe(true);
    expect(resent).toEqual([{ email: 'new@example.test' }]);
  });

  it('without mail, goes straight to the password step and keeps the token out of the store, history and storage', async () => {
    const app = await guest(false);
    record('POST /api/auth/register', () => Response.json({ verificationRequired: true, setupToken }));
    const stored = vi.spyOn(localStorage, 'setItem');
    expect(await app.submitAuth(input)).toBe('done');
    const state = get(app.state);
    expect(state).toMatchObject({ authOpen: false, accountSetup: { email: 'new@example.test', displayName: 'New potter' } });
    expect(JSON.stringify(state)).not.toContain(setupToken);
    expect(JSON.stringify(vi.mocked(history.replaceState).mock.calls)).not.toContain(setupToken);
    expect(location.hash).toBe('#/');
    expect(get(app.state).route).toEqual({ name: 'discover' });

    const confirmed = record('POST /api/auth/verification/confirm', () => new Response(null, { status: 200 }));
    const signedIn = record('POST /api/auth/login', () => {
      routes['GET /api/auth/me'] = () => Response.json(user);
      return new Response(null, { status: 200 });
    });
    expect(await app.completeAccountSetup(activation('first-secret', true))).toBe('used');
    // The activation carries the consent: the terms this app shows and the error-report choice.
    expect(confirmed).toEqual([{ token: setupToken, password: 'first-secret', displayName: 'Ana', termsAccepted: true, termsVersion, diagnosticsOptIn: true }]);
    expect(signedIn).toEqual(['email=new%40example.test&password=first-secret']);
    expect(get(app.state)).toMatchObject({ user, accountSetup: null, toast: 'notices.welcome' });
    expect(JSON.stringify(await readSnapshot('u1'))).not.toContain(setupToken);
    expect(JSON.stringify(stored.mock.calls)).not.toContain(setupToken);
    // Single use: the token left memory with the request.
    expect(await app.completeAccountSetup(activation('again'))).toBe('failed');
    expect(confirmed).toHaveLength(1);
  });

  it('keeps the password step and its token after a refused password, and sends the same token again', async () => {
    const app = await guest(false);
    record('POST /api/auth/register', () => Response.json({ verificationRequired: true, setupToken }));
    await app.submitAuth(input);
    let refuse = true;
    const confirmed = record('POST /api/auth/verification/confirm', () =>
      refuse ? Response.json({ error: 'Check your new password and display name.' }, { status: 400 }) : new Response(null, { status: 200 }),
    );
    expect(await app.completeAccountSetup(activation('short'))).toBe('failed');
    expect(get(app.state)).toMatchObject({
      accountSetup: { email: 'new@example.test' },
      formError: { form: 'account-link', message: 'Check your new password and display name.' },
    });
    refuse = false;
    routes['POST /api/auth/login'] = () => new Response(null, { status: 200 });
    routes['GET /api/auth/me'] = () => Response.json(user);
    expect(await app.completeAccountSetup(activation('long enough'))).toBe('used');
    expect(confirmed.map((body) => (body as { token: string }).token)).toEqual([setupToken, setupToken]);
  });

  it('opens the sign-in dialog when only the sign-in after the password step fails', async () => {
    const app = await guest(false);
    record('POST /api/auth/register', () => Response.json({ verificationRequired: true, setupToken }));
    await app.submitAuth(input);
    routes['POST /api/auth/verification/confirm'] = () => new Response(null, { status: 200 });
    routes['POST /api/auth/login'] = unreachable;
    expect(await app.completeAccountSetup(activation('first-secret'))).toBe('used');
    expect(get(app.state)).toMatchObject({ user: null, accountSetup: null, authOpen: true, toast: 'notices.emailVerified' });
  });

  it('drops the token when the password step is closed or the account changes', async () => {
    const app = await guest(false);
    record('POST /api/auth/register', () => Response.json({ verificationRequired: true, setupToken }));
    const confirmed = record('POST /api/auth/verification/confirm', () => new Response(null, { status: 200 }));
    await app.submitAuth(input);
    app.closeAccountSetup();
    expect(get(app.state).accountSetup).toBeNull();
    expect(await app.completeAccountSetup(activation('first-secret'))).toBe('failed');

    app.openAuth();
    await app.submitAuth(input);
    expect(get(app.state).accountSetup).not.toBeNull();
    // Someone signs in meanwhile (another tab): the step and its token belong to nobody now.
    routes['GET /api/auth/me'] = () => Response.json(user);
    await app.refresh();
    expect(get(app.state)).toMatchObject({ user, accountSetup: null });
    expect(await app.completeAccountSetup(activation('first-secret'))).toBe('failed');
    expect(confirmed).toEqual([]);
  });

  it('without mail and without a token, says at the form that the address cannot be registered here', async () => {
    const app = await guest(false);
    record('POST /api/auth/register', () => Response.json({ verificationRequired: true, setupToken: null }));
    expect(await app.submitAuth(input)).toBe('failed');
    expect(get(app.state)).toMatchObject({
      authOpen: true,
      accountSetup: null,
      error: '',
      formError: { form: 'auth', message: 'auth.register.unavailable' },
    });
  });

  it('shows a refused or unreachable registration at the form and keeps the dialog', async () => {
    const app = await guest(true);
    routes['POST /api/auth/register'] = () => Response.json({ error: 'Please check the form fields and try again.' }, { status: 400 });
    expect(await app.submitAuth(input)).toBe('failed');
    expect(get(app.state)).toMatchObject({
      authOpen: true,
      error: '',
      formError: { form: 'auth', message: 'Please check the form fields and try again.' },
    });
    routes['POST /api/auth/register'] = unreachable;
    expect(await app.submitAuth(input)).toBe('failed');
    expect(get(app.state)).toMatchObject({ authOpen: true, accountSetup: null, online: false, formError: { form: 'auth' } });
  });
});

describe('account deletion', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { scrollTo: vi.fn() });
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('location', { hash: '#/stock' });
    vi.stubGlobal('history', { replaceState: vi.fn() });
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
  });

  it('confirms once, clears identity, private caches and snapshot, and replaces the route', async () => {
    const { app } = await loaded();
    let answer!: () => void;
    let calls = 0;
    let body: unknown;
    routes['POST /api/auth/delete'] = async (request) => {
      calls++;
      body = await request.json();
      expect(request.headers.get('X-XSRF-TOKEN')).toBe('csrf');
      return new Promise<Response>((resolve) => {
        answer = () => {
          routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
          routes['GET /api/glazes'] = () => Response.json([]);
          resolve(new Response(null, { status: 204 }));
        };
      });
    };
    const pending = app.deleteAccount('password');
    expect(await app.deleteAccount('password')).toBe(false);
    await vi.waitFor(() => expect(answer).toBeDefined());
    answer();
    expect(await pending).toBe(true);
    expect(calls).toBe(1);
    expect(body).toEqual({ password: 'password' });
    expect(flat(get(app.state))).toMatchObject({
      user: null,
      glazes: [],
      combinations: [],
      stock: [],
      clubs: [],
      loading: false,
      error: '',
      toast: 'notices.accountDeleted',
    });
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '#/');
    expect(await readSnapshot('u1')).toBeNull();
    expect(localStorage.getItem('glazelab:v1:lastUser')).toBeNull();
    expect(cachesDeleted).toContain('glazelab-images-u1');
  });

  it('still removes the deleted account snapshot and image cache when localStorage throws', async () => {
    const { app } = await loaded();
    routes['POST /api/auth/delete'] = () => new Response(null, { status: 204 });
    // The reload stays pending, so only the cleanup itself (not the reload's own clean-up of the last user) is observed.
    routes['GET /api/auth/me'] = () => new Promise<Response>(() => {});
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw new DOMException('Denied', 'SecurityError');
    });
    void app.deleteAccount('password');
    await vi.waitFor(() => expect(cachesDeleted).toContain('glazelab-images-u1'));
    expect(await readSnapshot('u1')).toBeNull();
    expect(get(app.state).storageWarning).toBe(true);
  });

  describe('the per-account device flags (27-7)', () => {
    const mine = ['glazelab:include-buddies:u1', 'glazelab:include-clubs:u1', 'glazelab:intro-dismissed:u1'];
    const others = ['glazelab:include-buddies:u2', 'glazelab:include-clubs:u2', 'glazelab:intro-dismissed:u2'];
    const remember = () => [...mine, ...others].forEach((key) => localStorage.setItem(key, '1'));
    const keys = () => [...mine, ...others].filter((key) => localStorage.getItem(key) !== null);

    it("removes them on account deletion, and only the deleted account's", async () => {
      const { app } = await loaded();
      remember();
      routes['POST /api/auth/delete'] = () => new Response(null, { status: 204 });
      routes['GET /api/auth/me'] = () => new Promise<Response>(() => {});
      void app.deleteAccount('password');
      await vi.waitFor(() => expect(keys()).toEqual(others));
    });

    it("removes them at sign-out, online and offline, and only the signed-out account's", async () => {
      for (const online of [true, false]) {
        if (!online) for (const key of Object.keys(routes)) routes[key] = unreachable;
        const { app } = await loaded();
        remember();
        if (online) routes['POST /api/auth/logout'] = () => new Response(null, { status: 204 });
        await app.logout();
        expect(keys()).toEqual(others);
        others.forEach((key) => localStorage.removeItem(key));
      }
    });

    it('still signs out when the device refuses to remove them', async () => {
      const { app } = await loaded();
      remember();
      routes['POST /api/auth/logout'] = () => new Response(null, { status: 204 });
      vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
        throw new DOMException('Denied', 'SecurityError');
      });
      await app.logout();
      expect(cachesDeleted).toContain('glazelab-images-u1');
    });
  });

  it('forgets the device account, leaves no pending logout and starts the reload signed out and loading', async () => {
    const { app } = await loaded();
    routes['POST /api/auth/delete'] = () => new Response(null, { status: 204 });
    // The reload after the cleanup stays pending, so only the cleanup itself is observed.
    routes['GET /api/auth/me'] = () => new Promise<Response>(() => {});
    const states: { user: unknown; loading: boolean }[] = [];
    const unsubscribe = app.state.subscribe((state) => states.push({ user: state.user, loading: flat(state).loading }));
    void app.deleteAccount('password');
    await vi.waitFor(() => expect(localStorage.getItem('glazelab:v1:lastUser')).toBeNull());
    unsubscribe();
    expect(localStorage.getItem('glazelab:v1:pendingLogout')).toBeNull();
    expect(states.find((state) => state.user === null)).toEqual({ user: null, loading: true });
  });

  it('opens and closes the confirmation dialog, clearing the banner error, only for a signed-in account', async () => {
    const { app } = await loaded();
    app.dismissError();
    routes['GET /api/glazes'] = () => Response.json({ error: 'Down' }, { status: 500 });
    await app.refresh();
    expect(get(app.state).error).not.toBe('');
    app.openAccountDeletion();
    expect(get(app.state)).toMatchObject({ deletingAccount: true, error: '' });
    app.closeAccountDeletion();
    expect(get(app.state)).toMatchObject({ deletingAccount: false, error: '' });

    routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
    await app.refresh();
    app.openAccountDeletion();
    expect(get(app.state).deletingAccount).toBe(false);
  });

  it('keeps the dialog across a refresh of the same account and resets it on an account change or sign-out', async () => {
    const { app } = await loaded();
    app.openAccountDeletion();
    await app.refresh();
    expect(get(app.state).deletingAccount).toBe(true);

    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2' });
    await app.refresh();
    expect(get(app.state)).toMatchObject({ user: { id: 'u2' }, deletingAccount: false });

    app.openAccountDeletion();
    expect(get(app.state).deletingAccount).toBe(true);
    routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
    await app.refresh();
    expect(get(app.state)).toMatchObject({ user: null, deletingAccount: false });
  });

  it('retains the account and snapshot on a failed confirmation and refuses offline deletion', async () => {
    const { app } = await loaded();
    routes['POST /api/auth/delete'] = () => Response.json({ error: 'Incorrect password. Your account was not deleted.' }, { status: 400 });
    app.openAccountDeletion();
    expect(await app.deleteAccount('wrong')).toBe(false);
    expect(get(app.state).user?.id).toBe('u1');
    expect((await readSnapshot('u1'))?.glazes).toEqual([glaze]);
    // The dialog's own refusal stays in the dialog (a failed load while it is open goes to the banner and never takes its focus).
    expect(get(app.state)).toMatchObject({ error: '', formError: { form: 'account-delete', message: 'Incorrect password. Your account was not deleted.' } });
    // Closed and opened again, the dialog starts without the old refusal.
    app.closeAccountDeletion();
    expect(get(app.state).formError).toBeNull();
    expect(await app.deleteAccount('wrong')).toBe(false);
    expect(get(app.state)).toMatchObject({ error: 'Incorrect password. Your account was not deleted.', formError: null });
    app.openAccountDeletion();
    expect(get(app.state)).toMatchObject({ error: '', formError: null });
    vi.stubGlobal('navigator', { onLine: false });
    await app.refresh();
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect(await app.deleteAccount('password')).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not clear another account when an earlier deletion request finishes', async () => {
    const { app } = await loaded();
    let answer!: (response: Response) => void;
    routes['POST /api/auth/delete'] = () =>
      new Promise<Response>((resolve) => {
        answer = resolve;
      });
    const pending = app.deleteAccount('password');
    await vi.waitFor(() => expect(answer).toBeDefined());
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2' });
    routes['GET /api/glazes'] = () => Response.json([{ ...glaze, id: 'g2' }]);
    await app.refresh();
    answer(new Response(null, { status: 204 }));
    expect(await pending).toBe(false);
    expect(get(app.state)).toMatchObject({ user: { id: 'u2' }, error: '', toast: '' });
    expect((await readSnapshot('u2'))?.glazes[0].id).toBe('g2');
  });
});

describe('password change', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { scrollTo: vi.fn() });
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('location', { hash: '#/stock' });
    let issued = 0;
    // The server renews the token with the session: each fetch answers a new one.
    routes['GET /api/auth/csrf'] = () => Response.json({ token: `csrf-${++issued}` });
  });

  it('sends both passwords once, closes the dialog with the notice and fetches a new CSRF token for the renewed session', async () => {
    const { app } = await loaded();
    app.openPasswordChange();
    const bodies: unknown[] = [];
    const tokens: (string | null)[] = [];
    let answer!: () => void;
    routes['POST /api/auth/password/change'] = async (request) => {
      bodies.push(await request.json());
      tokens.push(request.headers.get('X-XSRF-TOKEN'));
      return new Promise<Response>((resolve) => {
        answer = () => resolve(new Response(null, { status: 200 }));
      });
    };
    const pending = app.changePassword('old secret', 'new secret');
    expect(await app.changePassword('old secret', 'new secret')).toBe(false);
    await vi.waitFor(() => expect(answer).toBeDefined());
    answer();
    expect(await pending).toBe(true);
    expect(bodies).toEqual([{ currentPassword: 'old secret', newPassword: 'new secret' }]);
    expect(get(app.state)).toMatchObject({ user: { id: 'u1' }, changingPassword: false, formError: null, toast: 'notices.passwordChangedHere' });

    routes['POST /api/clubs'] = async (request) => {
      tokens.push(request.headers.get('X-XSRF-TOKEN'));
      return Response.json({ id: 'c1' });
    };
    expect(await app.createClub('After the change')).toBe('c1');
    expect(tokens).toEqual(['csrf-1', 'csrf-2']);
  });

  it('keeps the dialog and shows a wrong current password at its form, never in the banner', async () => {
    const { app } = await loaded();
    app.openPasswordChange();
    routes['POST /api/auth/password/change'] = () => Response.json({ error: 'Incorrect password. Your password was not changed.' }, { status: 400 });
    expect(await app.changePassword('wrong', 'new secret')).toBe(false);
    expect(get(app.state)).toMatchObject({
      user: { id: 'u1' },
      changingPassword: true,
      error: '',
      formError: { form: 'password-change', message: 'Incorrect password. Your password was not changed.' },
    });
    // Closing and opening again starts clean.
    app.closePasswordChange();
    expect(get(app.state)).toMatchObject({ changingPassword: false, formError: null });
    app.openPasswordChange();
    expect(get(app.state)).toMatchObject({ changingPassword: true, formError: null });
  });

  it('opens only for a signed-in account, sends nothing offline and closes on an account change', async () => {
    const { app } = await loaded();
    app.openPasswordChange();
    await app.refresh();
    expect(get(app.state).changingPassword).toBe(true);
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2' });
    await app.refresh();
    expect(get(app.state)).toMatchObject({ user: { id: 'u2' }, changingPassword: false });

    vi.stubGlobal('navigator', { onLine: false });
    await app.refresh();
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect(await app.changePassword('old secret', 'new secret')).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();

    vi.stubGlobal('navigator', { onLine: true });
    routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
    await app.refresh();
    expect(get(app.state).user).toBeNull();
    app.openPasswordChange();
    expect(get(app.state).changingPassword).toBe(false);
  });
});

describe('profile picture (31-2)', () => {
  const square = () => new File([new Uint8Array([1, 2, 3])], 'profile-picture.jpg', { type: 'image/jpeg' });
  const withPicture = (avatarId: string | null) => (routes['GET /api/auth/me'] = () => Response.json({ ...user, avatarId }));

  beforeEach(() => {
    vi.stubGlobal('window', { scrollTo: vi.fn() });
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('location', { hash: '#/account' });
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
  });

  it('uploads the square once, takes the new ID into the account and the saved copy of the account, and says so', async () => {
    withPicture('old-picture');
    const { app } = await loaded();
    const files: (FormDataEntryValue | null)[] = [];
    let answer!: () => void;
    routes['POST /api/avatars'] = async (request) => {
      files.push((await request.formData()).get('file'));
      return new Promise<Response>((resolve) => (answer = () => resolve(Response.json({ id: 'new-picture' }))));
    };
    const pending = app.uploadAvatar(square());
    expect(await app.uploadAvatar(square())).toBe(false);
    await vi.waitFor(() => expect(answer).toBeDefined());
    answer();
    expect(await pending).toBe(true);
    expect(files).toHaveLength(1);
    expect((files[0] as File).name).toBe('profile-picture.jpg');
    expect(get(app.state)).toMatchObject({ user: { id: 'u1', avatarId: 'new-picture' }, formError: null, error: '', toast: 'notices.avatarSaved' });
    expect(JSON.parse(localStorage.getItem('glazelab:v1:lastUser')!)).toMatchObject({ avatarId: 'new-picture' });
  });

  it('forgets the saved copies of the replaced picture (both sizes), not of the new one', async () => {
    withPicture('old-picture');
    const { app } = await loaded();
    const kept = new Map([
      ['http://localhost/api/avatars/old-picture', 1],
      ['http://localhost/api/avatars/old-picture/small', 1],
      ['http://localhost/api/avatars/new-picture', 1],
    ]);
    vi.stubGlobal('caches', {
      has: async () => true,
      open: async () => ({
        keys: async () => [...kept.keys()].map((url) => new Request(url)),
        delete: async (request: Request) => kept.delete(request.url),
      }),
      delete: async () => true,
    });
    routes['POST /api/avatars'] = () => Response.json({ id: 'new-picture' });
    expect(await app.uploadAvatar(square())).toBe(true);
    expect([...kept.keys()]).toEqual(['http://localhost/api/avatars/new-picture']);
  });

  it('forgets the saved copies of a picture that was replaced or removed elsewhere when the account loads', async () => {
    withPicture('old-picture');
    const { app } = await loaded();
    const kept = new Map([
      ['http://localhost/api/avatars/old-picture', 1],
      ['http://localhost/api/avatars/old-picture/small', 1],
      ['http://localhost/api/avatars/new-picture/small', 1],
    ]);
    vi.stubGlobal('caches', {
      has: async () => true,
      open: async () => ({
        keys: async () => [...kept.keys()].map((url) => new Request(url)),
        delete: async (request: Request) => kept.delete(request.url),
      }),
      delete: async () => true,
    });
    withPicture('new-picture');
    await app.refresh();
    expect(get(app.state).user?.avatarId).toBe('new-picture');
    expect([...kept.keys()]).toEqual(['http://localhost/api/avatars/new-picture/small']);
  });

  it('shows a refused upload at the picture form and keeps the old picture', async () => {
    withPicture('old-picture');
    const { app } = await loaded();
    routes['POST /api/avatars'] = tooMany;
    expect(await app.uploadAvatar(square())).toBe(false);
    expect(get(app.state)).toMatchObject({
      user: { avatarId: 'old-picture' },
      error: '',
      formError: { form: 'avatar', message: expect.stringContaining('Too many requests') },
    });
    routes['POST /api/avatars'] = () => Response.json({ error: 'Unsupported image' }, { status: 400 });
    expect(await app.uploadAvatar(square())).toBe(false);
    expect(get(app.state).formError).toEqual({ form: 'avatar', message: 'Unsupported image' });
  });

  it('removes the picture, and a picture that is already gone counts as removed', async () => {
    withPicture('a1');
    const { app } = await loaded();
    const deleted: string[] = [];
    routes['DELETE /api/avatars/a1'] = () => {
      deleted.push('a1');
      return new Response(null, { status: 204 });
    };
    expect(await app.removeAvatar()).toBe(true);
    expect(deleted).toEqual(['a1']);
    expect(get(app.state)).toMatchObject({ user: { avatarId: null }, toast: 'notices.avatarRemoved' });
    expect(JSON.parse(localStorage.getItem('glazelab:v1:lastUser')!)).toMatchObject({ avatarId: null });
    // Nothing to remove now: no request.
    expect(await app.removeAvatar()).toBe(false);
    expect(deleted).toEqual(['a1']);

    withPicture('a2');
    await app.refresh();
    routes['DELETE /api/avatars/a2'] = () => Response.json({ error: 'Profile picture not found' }, { status: 404 });
    expect(await app.removeAvatar()).toBe(true);
    expect(get(app.state).user?.avatarId).toBeNull();

    withPicture('a3');
    await app.refresh();
    routes['DELETE /api/avatars/a3'] = () => Response.json({ error: 'Only its owner or a site admin can remove a profile picture' }, { status: 403 });
    expect(await app.removeAvatar()).toBe(false);
    expect(get(app.state)).toMatchObject({ user: { avatarId: 'a3' }, formError: { form: 'avatar' } });
  });

  it('sends nothing offline or as a guest', async () => {
    withPicture('a1');
    const { app } = await loaded();
    vi.stubGlobal('navigator', { onLine: false });
    await app.refresh();
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect(await app.uploadAvatar(square())).toBe(false);
    expect(await app.removeAvatar()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
    vi.stubGlobal('navigator', { onLine: true });
    routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
    await app.refresh();
    expect(await app.uploadAvatar(square())).toBe(false);
  });

  it('puts an answer that arrives after an account change nowhere', async () => {
    withPicture(null);
    const { app } = await loaded();
    let answer!: () => void;
    routes['POST /api/avatars'] = () => new Promise<Response>((resolve) => (answer = () => resolve(Response.json({ id: 'late' }))));
    const pending = app.uploadAvatar(square());
    await vi.waitFor(() => expect(answer).toBeDefined());
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2', avatarId: null });
    await app.refresh();
    answer();
    expect(await pending).toBe(false);
    expect(get(app.state).user).toMatchObject({ id: 'u2', avatarId: null });
  });
});

describe('club, account and admin actions', () => {
  type App = ReturnType<typeof createAppController>;
  const members = [{ id: 'u1', displayName: 'Ana', role: 'ADMIN' }];
  const adminClub = { id: 'c1', name: 'Kiln', role: 'ADMIN' };
  const refused = () => Response.json({ error: 'Please accept the updated terms of service to continue.' }, { status: 428 });
  const failed = () => Response.json({ error: 'Not allowed.' }, { status: 403 });

  interface Case {
    name: string;
    /** The request that fails or is answered late; the others in `setup` succeed. */
    key: string;
    form: string;
    run: (app: App) => Promise<unknown>;
    /** What the action answers on success. */
    result: unknown;
    /** What it answers after a failure or a dropped late result. */
    failure: unknown;
    setup?: () => void;
  }
  const writes: Case[] = [
    {
      name: 'updateClub',
      key: 'PUT /api/clubs/c1',
      form: 'club-settings:c1',
      run: (app) => app.updateClub('c1', { name: 'Kiln', houseRules: '', invitesEnabled: true }),
      result: true,
      failure: false,
      setup: () => (routes['PUT /api/clubs/c1'] = () => Response.json({})),
    },
    {
      name: 'changeClubRole',
      key: 'PUT /api/clubs/c1/members/u2',
      form: 'club-members:c1',
      run: (app) => app.changeClubRole('c1', 'u2', 'ADMIN'),
      result: true,
      failure: false,
      setup: () => {
        routes['PUT /api/clubs/c1/members/u2'] = () => Response.json({});
        routes['GET /api/clubs'] = () => Response.json([adminClub]);
        routes['GET /api/clubs/c1/members'] = () => Response.json(members);
      },
    },
    {
      name: 'leaveClub',
      key: 'DELETE /api/clubs/c1/members/u1',
      form: 'club-leave:c1',
      run: (app) => app.leaveClub('c1'),
      result: true,
      failure: false,
      setup: () => (routes['DELETE /api/clubs/c1/members/u1'] = () => new Response(null, { status: 204 })),
    },
    {
      name: 'removeClubMember',
      key: 'DELETE /api/clubs/c1/members/u2',
      form: 'club-members:c1',
      run: (app) => app.removeClubMember('c1', 'u2'),
      result: true,
      failure: false,
      setup: () => (routes['DELETE /api/clubs/c1/members/u2'] = () => new Response(null, { status: 204 })),
    },
    {
      name: 'regenerateInvite',
      key: 'POST /api/clubs/c1/invite',
      form: 'club-invite:c1',
      run: (app) => app.regenerateInvite('c1'),
      result: 'https://glazelab.eu/#/invite/tok',
      failure: null,
      setup: () => {
        routes['POST /api/clubs/c1/invite'] = () => Response.json({ token: 'tok' });
        routes['GET /api/clubs'] = () => Response.json([{ ...adminClub, hasInviteLink: true }]);
        routes['GET /api/clubs/c1/members'] = () => Response.json(members);
      },
    },
    {
      name: 'joinClub',
      key: 'POST /api/clubs/join',
      form: 'invite',
      run: (app) => app.joinClub(inviteToken),
      result: true,
      failure: false,
      setup: () => (routes['POST /api/clubs/join'] = () => Response.json({ id: 'c1' })),
    },
    {
      name: 'requestAccountMail',
      key: 'POST /api/auth/magic/request',
      form: 'account-mail',
      run: (app) => app.requestAccountMail('login', 'ana@example.test'),
      result: true,
      failure: false,
      setup: () => (routes['POST /api/auth/magic/request'] = () => Response.json({})),
    },
    {
      name: 'confirmAccountLink',
      key: 'POST /api/auth/magic/confirm',
      form: 'account-link',
      run: (app) => app.confirmAccountLink('login', 'tok'),
      result: 'used',
      failure: 'failed',
      setup: () => (routes['POST /api/auth/magic/confirm'] = () => Response.json({})),
    },
    {
      name: 'reportImage',
      key: 'POST /api/images/i1/reports',
      form: 'image-report',
      run: (app) => app.reportImage({ id: 'i1' }, 'Not a glaze'),
      result: true,
      failure: false,
      setup: () => (routes['POST /api/images/i1/reports'] = () => new Response(null, { status: 204 })),
    },
    {
      name: 'dismissImageReport',
      key: 'POST /api/admin/image-reports/r1/dismiss',
      form: 'image-reports',
      run: (app) => app.dismissImageReport('r1'),
      result: true,
      failure: false,
      setup: () => (routes['POST /api/admin/image-reports/r1/dismiss'] = () => new Response(null, { status: 204 })),
    },
  ];
  const reads: Case[] = [
    {
      name: 'previewInvite',
      key: 'POST /api/clubs/invitations/preview',
      form: 'invite',
      run: (app) => app.previewInvite(inviteToken),
      result: { name: 'Kiln', houseRules: 'Be kind' },
      failure: null,
      setup: () => (routes['POST /api/clubs/invitations/preview'] = () => Response.json({ name: 'Kiln', houseRules: 'Be kind' })),
    },
    {
      name: 'loadImageDeletions',
      key: 'GET /api/admin/image-deletions',
      form: 'image-deletions',
      run: (app) => app.loadImageDeletions(0),
      result: { entries: [], hasMore: false },
      failure: null,
      setup: () => (routes['GET /api/admin/image-deletions'] = () => Response.json({ entries: [], hasMore: false })),
    },
    {
      name: 'loadImageReports',
      key: 'GET /api/admin/image-reports',
      form: 'image-reports',
      run: (app) => app.loadImageReports(0),
      result: { entries: [], hasMore: false },
      failure: null,
      setup: () => (routes['GET /api/admin/image-reports'] = () => Response.json({ entries: [], hasMore: false })),
    },
  ];

  let replaced: unknown[];
  /** Every `replaceState` call with its state, for the privacy checks. */
  let replacedCalls: unknown[][];
  beforeEach(() => {
    replaced = [];
    replacedCalls = [];
    vi.stubGlobal('window', Object.assign(new EventTarget(), { scrollTo: vi.fn() }));
    vi.stubGlobal('location', { hash: '#/clubs', origin: 'https://glazelab.eu', pathname: '/' });
    vi.stubGlobal('history', {
      state: null,
      replaceState: (...args: unknown[]) => replacedCalls.push(args) && replaced.push(args[2]),
    });
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
  });

  function delayed(key: string) {
    let answer!: (response: Response) => void;
    const requested = new Promise<void>((resolve) => {
      routes[key] = () =>
        new Promise<Response>((done) => {
          answer = done;
          resolve();
        });
    });
    return { requested, answer: (response: Response) => answer(response) };
  }

  it.each([...writes, ...reads])('$name answers its result without error', async (c) => {
    c.setup?.();
    const { app } = await loaded();
    expect(await c.run(app)).toEqual(c.result);
    expect(get(app.state)).toMatchObject({ error: '', formError: null, termsRequired: false });
  });

  it.each([...writes, ...reads])('$name reports a failure at its form', async (c) => {
    c.setup?.();
    routes[c.key] = failed;
    const { app } = await loaded();
    expect(await c.run(app)).toBe(c.failure);
    expect(get(app.state)).toMatchObject({
      error: '',
      formError: { form: c.form, message: 'Not allowed.' },
    });
    // The next attempt starts clean.
    c.setup?.();
    expect(await c.run(app)).toEqual(c.result);
    expect(get(app.state).formError).toBeNull();
  });

  it.each(writes)('$name keeps the session and asks for the terms on a 428', async (c) => {
    c.setup?.();
    routes[c.key] = refused;
    const { app } = await loaded();
    expect(await c.run(app)).toBe(c.failure);
    expect(get(app.state)).toMatchObject({
      user: { id: 'u1' },
      online: true,
      termsRequired: true,
      error: '',
      formError: {
        form: c.form,
        message: 'Please accept the updated terms of service to continue.',
      },
    });
  });

  it.each([...writes, ...reads])('$name goes offline when the API is unreachable', async (c) => {
    c.setup?.();
    routes[c.key] = unreachable;
    const { app } = await loaded();
    expect(await c.run(app)).toBe(c.failure);
    expect(get(app.state)).toMatchObject({
      user: { id: 'u1' },
      online: false,
      formError: { form: c.form },
    });
  });

  it.each([...writes, ...reads])('$name drops a failure after an account change', async (c) => {
    c.setup?.();
    const request = delayed(c.key);
    const { app } = await loaded();
    const pending = c.run(app);
    await request.requested;
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2' });
    await app.refresh();
    request.answer(failed());
    expect(await pending).toBe(c.failure);
    expect(get(app.state)).toMatchObject({ user: { id: 'u2' }, error: '', formError: null });
  });

  it.each(reads)('$name drops a late result after an account change', async (c) => {
    c.setup?.();
    const request = delayed(c.key);
    const { app } = await loaded();
    const pending = c.run(app);
    await request.requested;
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2' });
    await app.refresh();
    request.answer(Response.json(c.result));
    expect(await pending).toBeNull();
  });

  it.each(writes.filter((c) => ['updateClub', 'changeClubRole', 'regenerateInvite'].includes(c.name)))(
    '$name drops a late success after an account change',
    async (c) => {
      c.setup?.();
      const request = delayed(c.key);
      const { app } = await loaded();
      const pending = c.run(app);
      await request.requested;
      routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2' });
      await app.refresh();
      request.answer(Response.json(c.key.endsWith('/invite') ? { token: 'tok' } : {}));
      expect(await pending).toBe(c.failure);
    },
  );

  it.each(writes.filter((c) => ['updateClub', 'changeClubRole', 'regenerateInvite'].includes(c.name)))(
    '$name reloads on a 404 (a club this account no longer sees), so the club leaves the listings before the error shows',
    async (c) => {
      c.setup?.();
      routes['GET /api/clubs'] = () => Response.json([adminClub]);
      routes['GET /api/clubs/c1/members'] = () => Response.json(members);
      const { app } = await loaded();
      expect(get(app.state).clubs.map((club) => club.id)).toEqual(['c1']);
      routes[c.key] = () => {
        // Removed from the club meanwhile: the API answers exactly as for an unknown club.
        routes['GET /api/clubs'] = () => Response.json([]);
        return Response.json({ error: 'Club not found' }, { status: 404 });
      };
      expect(await c.run(app)).toBe(c.failure);
      expect(get(app.state)).toMatchObject({ clubs: [], clubMembers: {}, error: '', formError: { form: c.form, message: 'Club not found' } });
    },
  );

  it.each(['joinClub', 'confirmAccountLink'] as const)('%s replaces the route only after the POST succeeded', async (name) => {
    const c = writes.find((entry) => entry.name === name)!;
    c.setup?.();
    const { app } = await loaded();
    expect(replaced).toEqual([]);
    expect(await c.run(app)).toEqual(c.result);
    expect(replaced).toContain(name === 'joinClub' ? '#/clubs/c1' : '#/');
    replaced.length = 0;
    routes[c.key] = failed;
    await c.run(app);
    expect(replaced).toEqual([]);
  });

  it('joinClub does not navigate when the account changed during the POST', async () => {
    const request = delayed('POST /api/clubs/join');
    const { app } = await loaded();
    const pending = app.joinClub(inviteToken);
    await request.requested;
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2' });
    await app.refresh();
    request.answer(Response.json({}));
    expect(await pending).toBe(false);
    expect(replaced).toEqual([]);
    expect(get(app.state)).toMatchObject({ user: { id: 'u2' }, formError: null });
  });

  it('dismissImageReport counts a report already gone as dismissed', async () => {
    routes['POST /api/admin/image-reports/r1/dismiss'] = () => Response.json({ error: 'Report not found' }, { status: 404 });
    const { app } = await loaded();
    expect(await app.dismissImageReport('r1')).toBe(true);
    expect(get(app.state)).toMatchObject({
      error: '',
      formError: null,
      toast: 'notices.reportDismissed',
    });
  });

  it.each([['abc'], [`${inviteToken}.`], [inviteToken.slice(0, -1)], ['L'.repeat(5000)]])(
    'calls malformed invite token case %# invalid without a request (preview and join)',
    async (malformed) => {
      routes['POST /api/clubs/invitations/preview'] = routes['POST /api/clubs/join'] = () => {
        throw new Error('a malformed token must not be sent');
      };
      const { app } = await loaded();
      expect(await app.previewInvite(malformed)).toBeNull();
      expect(get(app.state).formError).toEqual({ form: 'invite', message: 'errors.inviteInvalid' });
      expect(await app.joinClub(malformed)).toBe(false);
      expect(get(app.state).formError).toEqual({ form: 'invite', message: 'errors.inviteInvalid' });
    },
  );

  it('previewInvite joins nothing', async () => {
    routes['POST /api/clubs/invitations/preview'] = () => Response.json({ name: 'Kiln', houseRules: '' });
    routes['POST /api/clubs/join'] = () => {
      throw new Error('joined');
    };
    const { app } = await loaded();
    expect(await app.previewInvite(inviteToken)).toEqual({ name: 'Kiln', houseRules: '' });
    expect(replaced).toEqual([]);
  });

  it('loads the member list of every club with the clubs and keeps it in the state and the snapshot', async () => {
    routes['GET /api/clubs'] = () => Response.json([adminClub]);
    routes['GET /api/clubs/c1/members'] = () => Response.json(members);
    const { state } = await loaded();
    expect(state.clubMembers).toEqual({ c1: members });
    expect((await readSnapshot('u1'))?.clubMembers).toEqual({ c1: members });
  });

  it('keeps a generated invite link in memory for the session only: never in the state, the snapshot or the history', async () => {
    const token = 'A'.repeat(43);
    routes['POST /api/clubs/c1/invite'] = () => Response.json({ token, version: 'v1' });
    routes['GET /api/clubs'] = () => Response.json([{ ...adminClub, hasInviteLink: true, inviteVersion: 'v1' }]);
    routes['GET /api/clubs/c1/members'] = () => Response.json(members);
    const { app } = await loaded();
    const stored = vi.spyOn(localStorage, 'setItem');
    expect(app.inviteLink('c1')).toBeNull();
    const link = `https://glazelab.eu/#/invite/${token}`;
    expect(await app.regenerateInvite('c1')).toBe(link);
    expect(app.inviteLink('c1')).toEqual({ link, version: 'v1' });
    // A later read (panel reopened, the page left and entered again) shows the same link.
    await app.refresh();
    expect(app.inviteLink('c1')).toEqual({ link, version: 'v1' });
    expect(app.inviteLink('c2')).toBeNull();
    expect(JSON.stringify(get(app.state))).not.toContain(token);
    expect(JSON.stringify(await readSnapshot('u1'))).not.toContain(token);
    expect(JSON.stringify(replacedCalls)).not.toContain(token);
    expect(JSON.stringify(stored.mock.calls)).not.toContain(token);
    // Another account never sees it.
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2' });
    await app.refresh();
    expect(app.inviteLink('c1')).toBeNull();
  });

  it('keeps the shown invite link when replacing it fails', async () => {
    let answer = () => Response.json({ token: 'first', version: 'v1' });
    routes['POST /api/clubs/c1/invite'] = () => answer();
    routes['GET /api/clubs'] = () => Response.json([{ ...adminClub, hasInviteLink: true, inviteVersion: 'v1' }]);
    routes['GET /api/clubs/c1/members'] = () => Response.json(members);
    const { app } = await loaded();
    await app.regenerateInvite('c1');
    answer = () => Response.json({ error: 'Club admin role required' }, { status: 403 });
    expect(await app.regenerateInvite('c1')).toBeNull();
    expect(app.inviteLink('c1')?.link).toBe('https://glazelab.eu/#/invite/first');
  });

  it('forgets the invite link when the account leaves the club', async () => {
    routes['POST /api/clubs/c1/invite'] = () => Response.json({ token: 'first', version: 'v1' });
    routes['GET /api/clubs'] = () => Response.json([{ ...adminClub, hasInviteLink: true, inviteVersion: 'v1' }]);
    routes['GET /api/clubs/c1/members'] = () => Response.json(members);
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['DELETE /api/clubs/c1/members/u1'] = () => new Response(null, { status: 204 });
    const { app } = await loaded();
    await app.regenerateInvite('c1');
    expect(app.inviteLink('c1')).not.toBeNull();
    routes['GET /api/clubs'] = () => Response.json([]);
    expect(await app.leaveClub('c1')).toBe(true);
    expect(app.inviteLink('c1')).toBeNull();
  });

  it('copyLink copies with the notice and reports a refused clipboard', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', { onLine: true, clipboard: { writeText } });
    const { app } = await loaded();
    // A refused copy claims nothing: the settings select the field for a manual copy instead.
    expect(await app.copyLink('https://glazelab.eu/#/invite/tok')).toBe(false);
    expect(get(app.state).toast).not.toBe('notices.linkCopied');
    writeText.mockResolvedValue(undefined);
    expect(await app.copyLink('https://glazelab.eu/#/invite/tok')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('https://glazelab.eu/#/invite/tok');
    expect(get(app.state).toast).toBe('notices.linkCopied');
  });

  it('leaves out the members of a club the account left between the two requests, and loads the rest', async () => {
    routes['GET /api/clubs'] = () => Response.json([adminClub, { ...adminClub, id: 'c2', name: 'Gone' }]);
    routes['GET /api/clubs/c1/members'] = () => Response.json(members);
    routes['GET /api/clubs/c2/members'] = () => Response.json({ error: 'Club membership required' }, { status: 403 });
    const { state } = await loaded();
    expect(flat(state)).toMatchObject({ loadFailed: false, error: '', clubMembers: { c1: members } });
    expect(state.clubs.map((club) => club.id)).toEqual(['c1', 'c2']);
    expect(state.clubMembers.c2).toBeUndefined();
  });

  it('changeClubRole reloads the clubs and members, so the account sees its own demotion', async () => {
    let role = 'ADMIN';
    routes['PUT /api/clubs/c1/members/u1'] = () => {
      role = 'MEMBER';
      return Response.json({});
    };
    routes['GET /api/clubs'] = () => Response.json([{ ...adminClub, role }]);
    routes['GET /api/clubs/c1/members'] = () => Response.json([{ ...members[0], role }]);
    const { app } = await loaded();
    expect(get(app.state).clubs[0].role).toBe('ADMIN');
    expect(await app.changeClubRole('c1', 'u1', 'MEMBER')).toBe(true);
    expect(get(app.state)).toMatchObject({ clubs: [{ role: 'MEMBER' }], clubMembers: { c1: [{ role: 'MEMBER' }] }, error: '', formError: null });
  });

  it('changeClubRole refreshes a stale list before reporting the refusal', async () => {
    routes['GET /api/clubs'] = () => Response.json([adminClub]);
    let admins = [members[0], { id: 'u2', displayName: 'Bo', role: 'ADMIN' }];
    routes['GET /api/clubs/c1/members'] = () => Response.json(admins);
    routes['PUT /api/clubs/c1/members/u1'] = () => {
      // Bo was demoted meanwhile, so Ana is the last admin on the server.
      admins = [members[0], { id: 'u2', displayName: 'Bo', role: 'MEMBER' }];
      return Response.json({ error: 'A club must have at least one admin' }, { status: 409 });
    };
    const { app } = await loaded();
    expect(await app.changeClubRole('c1', 'u1', 'MEMBER')).toBe(false);
    expect(get(app.state)).toMatchObject({
      clubMembers: { c1: [{ role: 'ADMIN' }, { role: 'MEMBER' }] },
      formError: { form: 'club-members:c1', message: 'A club must have at least one admin' },
    });
  });

  describe('leaving a club and removing a member', () => {
    const kept = { ...adminClub, id: 'c2', name: 'Other', role: 'MEMBER' };
    const left = { ...adminClub, role: 'MEMBER' };
    const clubPhoto = imageInfo({ id: 'i1', url: '/api/images/i1', visibility: 'CLUB', clubId: 'c1' });
    const ownClubPhoto = imageInfo({ id: 'i2', url: '/api/images/i2', visibility: 'CLUB', clubId: 'c1', own: true });
    const otherClubPhoto = imageInfo({ id: 'i3', url: '/api/images/i3', visibility: 'CLUB', clubId: 'c2' });
    const publicPhoto = imageInfo({ id: 'i4', url: '/api/images/i4', visibility: 'PUBLIC' });
    const shelf = [
      stockItem({ id: 's1' }),
      stockItem({ id: 's2', userId: null, clubId: 'c1', clubName: 'Kiln', addedById: 'u1' }),
      stockItem({ id: 's3', userId: null, clubId: 'c2', clubName: 'Other', canRemove: false }),
    ];
    const members = [clubMember({ id: 'u1' }), clubMember({ id: 'u2', displayName: 'Bo', role: 'ADMIN' })];

    function signedInClubs() {
      routes['GET /api/clubs'] = () => Response.json([left, kept]);
      routes['GET /api/clubs/c1/members'] = () => Response.json(members);
      routes['GET /api/clubs/c2/members'] = () => Response.json(members);
      routes['GET /api/stock'] = () => Response.json(shelf);
      routes['GET /api/sync/combinations'] = listing([combination({ id: 'k1', images: [clubPhoto, ownClubPhoto, otherClubPhoto, publicPhoto] })]);
    }

    it('leaveClub drops what only the club saw at once, from the state and the snapshot, even when the reload fails', async () => {
      signedInClubs();
      routes['POST /api/clubs/c1/invite'] = () => Response.json({ token: 'tok' });
      routes['DELETE /api/clubs/c1/members/u1'] = () => new Response(null, { status: 204 });
      const { app } = await loaded();
      await app.regenerateInvite('c1');
      expect(app.inviteLink('c1')).not.toBeNull();
      routes['GET /api/glazes'] = nginx(502);
      const cached = ['/api/images/i1', '/api/images/i2', '/api/images/i3', '/api/images/i4'];
      vi.stubGlobal('caches', {
        delete: async () => true,
        has: async (name: string) => name === 'glazelab-images-u1',
        open: async () => ({
          keys: async () => cached.map((path) => new Request(`http://localhost${path}`)),
          delete: async (request: Request) => {
            cached.splice(cached.indexOf(new URL(request.url).pathname), 1);
            return true;
          },
        }),
      });
      expect(await app.leaveClub('c1')).toBe(true);
      // The club's photos leave the picture cache too (the failed reload prunes nothing).
      expect(cached).toEqual(['/api/images/i3', '/api/images/i4']);
      for (const saved of [get(app.state), await readSnapshot('u1')]) {
        expect(saved?.clubs.map((club) => club.id)).toEqual(['c2']);
        expect(Object.keys(saved?.clubMembers ?? {})).toEqual(['c2']);
        expect(saved?.stock.map((entry) => entry.id)).toEqual(['s1', 's3']);
        expect(saved?.combinations[0].images.map((photo) => photo.id)).toEqual(['i3', 'i4']);
      }
      expect(app.inviteLink('c1')).toBeNull();
      expect(get(app.state).toast).toBe('notices.clubLeft');
    });

    it('leaveClub reloads before it shows a refusal (the last admin) at the club card', async () => {
      signedInClubs();
      let clubs = [left, kept];
      routes['GET /api/clubs'] = () => Response.json(clubs);
      routes['DELETE /api/clubs/c1/members/u1'] = () => {
        // Bo was demoted meanwhile: Ana is now the last admin.
        clubs = [{ ...left, role: 'ADMIN' }, kept];
        return Response.json({ error: 'A club must have at least one admin' }, { status: 409 });
      };
      const { app } = await loaded();
      expect(await app.leaveClub('c1')).toBe(false);
      expect(get(app.state)).toMatchObject({
        clubs: [{ id: 'c1', role: 'ADMIN' }, { id: 'c2' }],
        stock: shelf,
        formError: { form: 'club-leave:c1', message: 'A club must have at least one admin' },
      });
    });

    it('leaving and removing send nothing offline', async () => {
      signedInClubs();
      routes['DELETE /api/clubs/c1/members/u1'] = routes['DELETE /api/clubs/c1/members/u2'] = () => {
        throw new Error('no request while offline');
      };
      const { app } = await loaded();
      vi.stubGlobal('navigator', { onLine: false });
      await app.refresh();
      expect(await app.leaveClub('c1')).toBe(false);
      expect(await app.removeClubMember('c1', 'u2')).toBe(false);
      expect(get(app.state).clubs).toHaveLength(2);
    });

    it('removeClubMember reloads the members; a member gone meanwhile reloads before the refusal shows', async () => {
      signedInClubs();
      let listed = members;
      routes['GET /api/clubs/c1/members'] = () => Response.json(listed);
      routes['DELETE /api/clubs/c1/members/u2'] = () => {
        listed = [members[0]];
        return new Response(null, { status: 204 });
      };
      const { app } = await loaded();
      expect(await app.removeClubMember('c1', 'u2')).toBe(true);
      expect(get(app.state)).toMatchObject({ clubMembers: { c1: [{ id: 'u1' }] }, toast: 'notices.memberRemoved', formError: null });
      listed = members;
      await app.refresh();
      routes['DELETE /api/clubs/c1/members/u2'] = () => {
        listed = [members[0]];
        return Response.json({ error: 'Member not found' }, { status: 404 });
      };
      expect(await app.removeClubMember('c1', 'u2')).toBe(false);
      expect(get(app.state)).toMatchObject({
        clubMembers: { c1: [{ id: 'u1' }] },
        formError: { form: 'club-members:c1', message: 'Member not found' },
      });
    });
  });

  describe('confirmAccountLink', () => {
    const body = (request: Request) => request.json();
    it('signs in, reloads and shows the notice', async () => {
      routes['POST /api/auth/magic/confirm'] = () => Response.json({});
      const { app } = await loaded();
      expect(await app.confirmAccountLink('login', 'tok')).toBe('used');
      expect(get(app.state)).toMatchObject({ toast: 'notices.signedIn', formError: null });
    });

    it('asks for the activation details without showing an error, then sends them', async () => {
      const sent: unknown[] = [];
      routes['POST /api/auth/magic/confirm'] = async (request) => {
        sent.push(await body(request));
        return sent.length === 1
          ? Response.json({ error: 'Set a fresh password and your display name to activate this account.' }, { status: 409 })
          : Response.json({});
      };
      const { app } = await loaded();
      expect(await app.confirmAccountLink('login', 'tok')).toBe('activation');
      expect(get(app.state)).toMatchObject({ error: '', formError: null });
      expect(replaced).toEqual([]);
      expect(await app.confirmAccountLink('login', 'tok', { password: 'secret-1', displayName: 'Ana', termsAccepted: true })).toBe('used');
      // The activation sends the mailbox owner's consent; error reports stay off unless ticked.
      expect(sent).toEqual([
        { token: 'tok' },
        { token: 'tok', password: 'secret-1', displayName: 'Ana', termsAccepted: true, termsVersion, diagnosticsOptIn: false },
      ]);
    });

    it('resets a password and continues to the sign-in dialog', async () => {
      let sent: unknown;
      routes['POST /api/auth/password/reset'] = async (request) => {
        sent = await body(request);
        return Response.json({});
      };
      const { app } = await loaded();
      expect(await app.confirmAccountLink('reset', 'tok', { password: 'secret-1' })).toBe('used');
      // An active account's reset sends no consent fields.
      expect(sent).toEqual({ token: 'tok', password: 'secret-1' });
      expect(get(app.state)).toMatchObject({ toast: 'notices.passwordChanged', authOpen: true });
    });

    it.each([
      ['login', 'POST /api/auth/magic/confirm'],
      ['reset', 'POST /api/auth/password/reset'],
    ] as const)('fetches a fresh CSRF token after a %s link changed the session', async (kind, route) => {
      let issued = 0;
      const sentTokens: (string | null)[] = [];
      routes['GET /api/auth/csrf'] = () => Response.json({ token: `csrf-${++issued}` });
      routes[route] = (request) => (sentTokens.push(request.headers.get('X-XSRF-TOKEN')), Response.json({}));
      const { app } = await loaded();
      await app.confirmAccountLink(kind, 'tok', { password: 'secret-1' });
      await app.confirmAccountLink(kind, 'tok', { password: 'secret-1' });
      expect(sentTokens).toEqual(['csrf-1', 'csrf-2']);
    });

    it('verifies an email', async () => {
      routes['POST /api/auth/verification/confirm'] = () => Response.json({});
      const { app } = await loaded();
      expect(await app.confirmAccountLink('verify', 'tok')).toBe('used');
      expect(get(app.state).toast).toBe('notices.emailVerified');
    });

    it('keeps another 409 as an error at the link form', async () => {
      routes['POST /api/auth/magic/confirm'] = () => Response.json({ error: 'This link has expired.' }, { status: 409 });
      const { app } = await loaded();
      expect(await app.confirmAccountLink('login', 'tok')).toBe('failed');
      expect(get(app.state).formError).toEqual({
        form: 'account-link',
        message: 'This link has expired.',
      });
    });
  });

  describe('authOptions', () => {
    const options = { emailEnabled: true, termsVersion };

    it('loads once with the first successful load, not with every later one', async () => {
      const requests = vi.fn();
      routes['GET /api/auth/options'] = () => (requests(), Response.json(options));
      const { app } = await loaded();
      await vi.waitFor(() => expect(get(app.state).authOptions).toEqual(options));
      await app.refresh();
      app.openAuth();
      await app.refresh();
      expect(requests).toHaveBeenCalledTimes(1);
    });

    it('stays silent when unavailable and is asked again when the dialog opens', async () => {
      routes['GET /api/auth/options'] = unreachable;
      const { app } = await loaded();
      await vi.waitFor(() => expect(get(app.state).authOptions).toBeNull());
      expect(get(app.state)).toMatchObject({ error: '', online: true });
      routes['GET /api/auth/options'] = () => Response.json(options);
      app.openAuth();
      await vi.waitFor(() => expect(get(app.state).authOptions).toEqual(options));
    });

    it("keeps the server's source URL for the footer when the connection drops", async () => {
      const sourceUrl = 'https://code.example.test/glazelab';
      routes['GET /api/auth/options'] = () => Response.json({ ...options, sourceUrl });
      const { app } = await loaded();
      await vi.waitFor(() => expect(get(app.state).authOptions?.sourceUrl).toBe(sourceUrl));
      routes['GET /api/sync'] = unreachable;
      await app.refresh();
      expect(get(app.state).online).toBe(false);
      expect(get(app.state).authOptions?.sourceUrl).toBe(sourceUrl);
    });

    it('is not loaded before a load reached the API', async () => {
      vi.stubGlobal('navigator', { onLine: false });
      const { app } = await loaded();
      expect(get(app.state).authOptions).toBeUndefined();
    });
  });

  describe('operator contact', () => {
    const address = 'op@example.test';

    it('is not part of the options type, and is fetched only by operatorContact, never kept in the state or storage', async () => {
      expectTypeOf<AuthOptions>().not.toHaveProperty('operatorEmail');
      const requests = vi.fn();
      routes['GET /api/auth/operator-contact'] = () => (requests(), Response.json({ email: address }));
      routes['GET /api/auth/options'] = () => Response.json({ emailEnabled: true, termsVersion });
      const stored = vi.spyOn(localStorage, 'setItem');
      const { app } = await loaded();
      await vi.waitFor(() => expect(get(app.state).authOptions).toEqual({ emailEnabled: true, termsVersion }));
      app.openAuth();
      await app.refresh();
      expect(requests).not.toHaveBeenCalled();
      expect(await app.operatorContact()).toBe(address);
      expect(requests).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(get(app.state))).not.toContain(address);
      expect(JSON.stringify(await readSnapshot(get(app.state).user?.id ?? null))).not.toContain(address);
      expect(stored.mock.calls.flat().join()).not.toContain(address);
    });

    it('throws when the answer is missing, so the caller words the failure', async () => {
      const { app } = await loaded();
      routes['GET /api/auth/operator-contact'] = () => Response.json({ error: 'No contact address is configured.' }, { status: 404 });
      await expect(app.operatorContact()).rejects.toThrow('No contact address is configured.');
      routes['GET /api/auth/operator-contact'] = unreachable;
      await expect(app.operatorContact()).rejects.toThrow();
    });
  });

  it('clears a form error when the sign-in dialog opens or closes', async () => {
    routes['POST /api/auth/password/request'] = failed;
    const { app } = await loaded();
    await app.requestAccountMail('reset', 'ana@example.test');
    expect(get(app.state).formError?.form).toBe('account-mail');
    app.openAuth();
    expect(get(app.state).formError).toBeNull();
    await app.requestAccountMail('reset', 'ana@example.test');
    app.closeAuth();
    expect(get(app.state).formError).toBeNull();
  });
});
