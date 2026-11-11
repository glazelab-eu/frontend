import { describe, expect, it, vi } from 'vitest';
import { readSnapshot } from '../../lib/offline/snapshots';
import { get } from 'svelte/store';
import { createAppController } from '../app/app-controller';
import { termsPending } from '../app/app-state';
import { enterViewer } from '../../lib/images/viewer-history';
import { healthy, loaded, nginx, routes, stubBrowser, stubSessionHistory, useMockApi, user } from '../app/test-helpers';

useMockApi();

describe('unsaved drafts', () => {
  const studio = { name: 'studio' } as const;
  const message = 'drafts.discardCombination' as const;

  it('asks before navigating away from unsaved input, and Discard or Stay decide', async () => {
    stubBrowser('#/studio');
    const { app } = await loaded();
    let dirty = true;
    const release = app.registerLeaveGuard({ dirty: () => dirty, message });
    app.navigate({ name: 'stock' });
    expect(get(app.state)).toMatchObject({ route: studio, leaving: { route: { name: 'stock' } } });
    expect(location.hash).toBe('#/studio');
    app.stay();
    expect(get(app.state)).toMatchObject({ route: studio, leaving: null });
    app.navigate({ name: 'stock' }, { replace: true });
    app.leaveAnyway();
    expect(get(app.state)).toMatchObject({ route: { name: 'stock' }, leaving: null });
    // Without input, or once the page's guard is gone, navigation does not ask.
    dirty = false;
    app.navigate(studio, { replace: true });
    app.navigate({ name: 'clubs' }, { replace: true });
    expect(get(app.state)).toMatchObject({ route: { name: 'clubs' }, leaving: null });
    app.navigate(studio, { replace: true });
    dirty = true;
    release();
    app.navigate({ name: 'clubs' }, { replace: true });
    expect(get(app.state)).toMatchObject({ route: { name: 'clubs' }, leaving: null });
  });

  it('puts the page back after a link, back or forward, and Discard then goes on', async () => {
    const { events, entry } = stubBrowser('#/studio');
    const { app } = await loaded();
    const stop = app.start();
    try {
      await app.refresh();
      app.registerLeaveGuard({ dirty: () => true, message });
      location.hash = '#/clubs';
      events.dispatchEvent(new Event('hashchange'));
      expect(entry.replaceState).toHaveBeenLastCalledWith(expect.objectContaining({ glazelabNavigation: expect.any(Object) }), '', '#/studio');
      expect(get(app.state)).toMatchObject({
        route: studio,
        leaving: { route: { name: 'clubs' } },
      });
      app.leaveAnyway();
      expect(location.hash).toBe('#/clubs');
      expect(get(app.state)).toMatchObject({ route: { name: 'clubs' }, leaving: null });
    } finally {
      stop();
    }
  });

  it('closes an open leave question when the account changes', async () => {
    stubBrowser('#/studio');
    const { app } = await loaded();
    app.registerLeaveGuard({ dirty: () => true, message });
    app.navigate({ name: 'stock' });
    expect(get(app.state).leaving).not.toBeNull();
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2' });
    await app.refresh();
    expect(get(app.state)).toMatchObject({ user: { id: 'u2' }, leaving: null, route: studio });
  });

  it('stops following the hash and the unload prompt once stopped', async () => {
    const { events } = stubBrowser('#/studio');
    const { app } = await loaded();
    const stop = app.start();
    await app.refresh();
    app.registerLeaveGuard({ dirty: () => true, message });
    stop();
    location.hash = '#/clubs';
    events.dispatchEvent(new Event('hashchange'));
    expect(get(app.state)).toMatchObject({ route: studio, leaving: null });
    const unload = new Event('beforeunload', { cancelable: true });
    events.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });

  it('lets a pushed Discard through and ignores filter changes on the same page', async () => {
    const { events } = stubBrowser('#/studio');
    const { app } = await loaded();
    const stop = app.start();
    try {
      await app.refresh();
      app.registerLeaveGuard({ dirty: () => true, message });
      app.navigate({ name: 'stock' });
      app.leaveAnyway();
      expect(location.hash).toBe('#/stock');
      events.dispatchEvent(new Event('hashchange'));
      expect(get(app.state)).toMatchObject({ route: { name: 'stock' }, leaving: null });
      app.navigate({ name: 'stock', barcode: '96385074' }, { replace: true });
      expect(get(app.state).leaving).toMatchObject({ route: { barcode: '96385074' } });
      app.stay();
      app.navigate({ name: 'discover' }, { replace: true });
      app.leaveAnyway();
      app.navigate({ name: 'discover', q: 'rutile' }, { replace: true });
      expect(get(app.state)).toMatchObject({ route: { q: 'rutile' }, leaving: null });
    } finally {
      stop();
    }
  });

  it('asks the browser before reloading or closing with unsaved input', async () => {
    const { events } = stubBrowser('#/studio');
    const { app } = await loaded();
    const stop = app.start();
    try {
      const unload = () => {
        const event = new Event('beforeunload', { cancelable: true });
        events.dispatchEvent(event);
        return event.defaultPrevented;
      };
      expect(unload()).toBe(false);
      const release = app.registerLeaveGuard({ dirty: () => true, message });
      expect(unload()).toBe(true);
      release();
      expect(unload()).toBe(false);
    } finally {
      stop();
    }
  });

  it('reports unsaved work for an update reload, and lets the unload pass without the browser question after a discard', async () => {
    const { events } = stubBrowser('#/studio');
    const { app } = await loaded();
    vi.useFakeTimers();
    const stop = app.start();
    try {
      const unload = () => {
        const event = new Event('beforeunload', { cancelable: true });
        events.dispatchEvent(event);
        return event.defaultPrevented;
      };
      let dirty = false;
      const release = app.registerLeaveGuard({ dirty: () => dirty, message });
      expect(app.hasUnsavedWork()).toBe(false);
      dirty = true;
      expect(app.hasUnsavedWork()).toBe(true);
      expect(unload()).toBe(true);
      app.allowUnload();
      expect(unload()).toBe(false);
      // The permission covers the one unload it was given for: a cancelled reload leaves the question in place.
      expect(unload()).toBe(true);
      app.allowUnload();
      vi.advanceTimersByTime(9_000);
      app.allowUnload();
      vi.advanceTimersByTime(9_000);
      expect(unload()).toBe(false);
      app.allowUnload();
      vi.advanceTimersByTime(10_000);
      expect(unload()).toBe(true);
      release();
      expect(app.hasUnsavedWork()).toBe(false);
    } finally {
      stop();
      vi.useRealTimers();
    }
  });
});

describe('content dialog lifecycle', () => {
  const target = { type: 'glaze' as const, id: 'g1', title: 'Blue' };

  function browser() {
    const events = new EventTarget();
    vi.stubGlobal('window', Object.assign(events, { scrollTo: vi.fn() }));
    vi.stubGlobal('location', { hash: '#/glazes/g1' });
    vi.stubGlobal('history', {
      replaceState: vi.fn((_state, _unused, href) => {
        location.hash = href;
      }),
    });
    vi.stubGlobal('navigator', { onLine: true });
    return events;
  }

  it('closes content dialogs on replacement navigation but preserves them on the same route', async () => {
    browser();
    const { app } = await loaded();
    app.openAuth();
    app.openUpload(target);
    app.navigate(get(app.state).route, { replace: true });
    expect(get(app.state)).toMatchObject({ authOpen: true, uploadFor: target });
    app.navigate({ name: 'stock' }, { replace: true });
    expect(get(app.state)).toMatchObject({ authOpen: false, uploadFor: null });
  });

  it('keeps the list positions when replacing within a page, and scrolls only for another page', async () => {
    browser();
    const saved = { glazelabLists: { combinations: { limit: 24, scrollY: 900 } } };
    const entry = {
      state: null as unknown,
      replaceState: vi.fn((state: unknown, _unused: string, href: string) => {
        entry.state = state;
        location.hash = href;
      }),
    };
    vi.stubGlobal('history', entry);
    const { app } = await loaded();
    app.navigate({ name: 'discover' }, { replace: true });
    // Another page's entry starts without list positions; PagedGrid then saves them.
    expect(entry.state).toBeNull();
    entry.state = saved;
    vi.mocked(window.scrollTo).mockClear();
    app.navigate({ name: 'discover', q: 'rutile' }, { replace: true });
    expect(history.replaceState).toHaveBeenLastCalledWith(saved, '', '#/?q=rutile');
    expect(entry.state).toBe(saved);
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(get(app.state).route).toEqual({ name: 'discover', q: 'rutile' });
    // The type is a filter of the same page: positions stay and nothing scrolls.
    app.navigate({ name: 'discover', type: 'glazes', q: 'rutile' }, { replace: true });
    expect(history.replaceState).toHaveBeenLastCalledWith(saved, '', '#/?type=glazes&q=rutile');
    expect(window.scrollTo).not.toHaveBeenCalled();
    app.navigate({ name: 'stock' }, { replace: true });
    expect(history.replaceState).toHaveBeenLastCalledWith(null, '', '#/stock');
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('closes content dialogs for hash navigation, including back and forward', async () => {
    const events = browser();
    const { app } = await loaded();
    const stop = app.start();
    try {
      await app.refresh();
      app.openAuth();
      app.openUpload(target);
      location.hash = '#/stock';
      events.dispatchEvent(new Event('hashchange'));
      expect(get(app.state)).toMatchObject({
        route: { name: 'stock' },
        authOpen: false,
        uploadFor: null,
      });
    } finally {
      stop();
    }
  });

  it('keeps content dialogs during same-account refresh and closes them on account change', async () => {
    const { app } = await loaded();
    app.openUpload(target);
    app.openAuth();
    await app.refresh();
    expect(get(app.state)).toMatchObject({ authOpen: true, uploadFor: target });
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2' });
    await app.refresh();
    expect(get(app.state)).toMatchObject({ authOpen: false, uploadFor: null });
  });

  it('closes content dialogs when the server session ends, and opens the sign-in with its notice', async () => {
    const { app } = await loaded();
    app.openUpload(target);
    app.openAuth();
    routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
    await app.refresh();
    expect(get(app.state)).toMatchObject({ user: null, authOpen: true, authNotice: 'sessionEnded', uploadFor: null });
  });

  it.each([true, false])('closes dialogs on sign-out (online: %s)', async (online) => {
    const events = browser();
    const { app } = await loaded();
    const stop = app.start();
    try {
      await app.refresh();
      if (!online) {
        vi.stubGlobal('navigator', { onLine: false });
        events.dispatchEvent(new Event('offline'));
      }
      routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
      routes['POST /api/auth/logout'] = () => {
        routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
        return new Response(null, { status: 200 });
      };
      app.openUpload(target);
      app.openAuth();
      await app.logout();
      expect(get(app.state)).toMatchObject({ user: null, authOpen: false, uploadFor: null });
      expect(await readSnapshot(user.id)).toBeNull();
    } finally {
      stop();
    }
  });

  it.each(['verify', 'reset', 'login', 'invite'] as const)('preserves the %s route across loading and account changes', async (name) => {
    browser();
    const { app } = await loaded();
    const route = { name, token: 'test-token' };
    app.openUpload(target);
    app.navigate(route, { replace: true });
    expect(get(app.state)).toMatchObject({ route, uploadFor: null });
    app.openAuth();
    await app.refresh();
    expect(get(app.state)).toMatchObject({ route, authOpen: true });
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2' });
    await app.refresh();
    expect(get(app.state)).toMatchObject({ route, authOpen: false });
    app.navigate({ name: 'discover' }, { replace: true });
    expect(history.replaceState).toHaveBeenLastCalledWith(null, '', '#/');
  });
});

describe('context-aware back navigation', () => {
  function browser(hash: string) {
    const events = new EventTarget();
    let index = 0;
    const entries = [{ hash, state: null as unknown }];
    vi.stubGlobal('window', Object.assign(events, { scrollTo: vi.fn() }));
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('location', {
      get hash() {
        return entries[index].hash;
      },
      set hash(value: string) {
        if (value === entries[index].hash) return;
        entries.splice(index + 1);
        entries.push({ hash: value, state: null });
        index++;
      },
    });
    const history = {
      get state() {
        return entries[index].state;
      },
      replaceState: vi.fn((state: unknown, _unused: string, href: string) => {
        entries[index] = { hash: href, state: structuredClone(state) };
      }),
      back: vi.fn(() => {
        if (index === 0) return;
        index--;
        events.dispatchEvent(new Event('hashchange'));
      }),
      forward() {
        if (index === entries.length - 1) return;
        index++;
        events.dispatchEvent(new Event('hashchange'));
      },
    };
    vi.stubGlobal('history', history);
    return {
      history,
      push(hash: string) {
        location.hash = hash;
        events.dispatchEvent(new Event('hashchange'));
      },
    };
  }

  describe('password change dialog', () => {
    it('closes on a link, stays across a filter change and reports a refusal after leaving in the banner', async () => {
      const browserState = browser('#/?q=rutile');
      const { app } = await loaded();
      const stop = app.start();
      let answer!: (response: Response) => void;
      routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
      routes['POST /api/auth/password/change'] = () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        });
      try {
        app.openPasswordChange();
        browserState.push('#/?q=celadon');
        expect(get(app.state)).toMatchObject({ route: { q: 'celadon' }, changingPassword: true });

        const pending = app.changePassword('wrong', 'new secret');
        await vi.waitFor(() => expect(answer).toBeDefined());
        browserState.push('#/clubs');
        expect(get(app.state)).toMatchObject({ route: { name: 'clubs' }, changingPassword: false });
        answer(Response.json({ error: 'Incorrect password. Your password was not changed.' }, { status: 400 }));
        expect(await pending).toBe(false);
        expect(get(app.state)).toMatchObject({
          user: { id: 'u1' },
          formError: null,
          error: 'Incorrect password. Your password was not changed.',
        });
      } finally {
        stop();
      }
    });
  });

  describe('account page dialogs', () => {
    it('opens on the account route and both dialogs close when the person leaves the page', async () => {
      const browserState = browser('#/account');
      const { app } = await loaded();
      const stop = app.start();
      try {
        expect(get(app.state).route).toEqual({ name: 'account' });
        app.openPasswordChange();
        expect(get(app.state).changingPassword).toBe(true);
        browserState.push('#/stock');
        expect(get(app.state)).toMatchObject({ route: { name: 'stock' }, changingPassword: false });

        browserState.history.back();
        app.openAccountDeletion();
        browserState.push('#/clubs');
        expect(get(app.state)).toMatchObject({ route: { name: 'clubs' }, deletingAccount: false });
      } finally {
        stop();
      }
    });
  });

  describe('feedback dialog', () => {
    it('closes when the person leaves the page and keeps its draft for the next opening', async () => {
      const browserState = browser('#/stock');
      const { app } = await loaded();
      const stop = app.start();
      try {
        app.openFeedback();
        app.keepFeedbackDraft({ message: 'Still here', photos: [], withContext: false });
        browserState.push('#/clubs');
        expect(get(app.state)).toMatchObject({ route: { name: 'clubs' }, feedbackOpen: false });
        expect(app.feedbackDraft()).toEqual({ message: 'Still here', photos: [], withContext: false });
      } finally {
        stop();
      }
    });
  });

  describe('account deletion dialog', () => {
    const outdated = { ...user, siteAdmin: false, acceptedTermsVersion: null };

    it('closes on a link, Back and Forward but stays on the same page and across a filter change', async () => {
      const browserState = browser('#/stock');
      const { app } = await loaded();
      const stop = app.start();
      try {
        app.openAccountDeletion();
        browserState.push('#/stock');
        browserState.push('#/?q=rutile');
        expect(get(app.state)).toMatchObject({
          route: { name: 'discover' },
          deletingAccount: false,
        });

        app.openAccountDeletion();
        browserState.push('#/?q=celadon');
        expect(get(app.state)).toMatchObject({ route: { q: 'celadon' }, deletingAccount: true });

        browserState.history.back();
        expect(get(app.state)).toMatchObject({ route: { q: 'rutile' }, deletingAccount: true });
        browserState.history.back();
        expect(get(app.state)).toMatchObject({ route: { name: 'stock' }, deletingAccount: false });

        app.openAccountDeletion();
        browserState.history.forward();
        expect(get(app.state)).toMatchObject({
          route: { name: 'discover' },
          deletingAccount: false,
        });
      } finally {
        stop();
      }
    });

    it('reports a deletion refused after leaving the page in the banner, still signed in', async () => {
      const browserState = browser('#/stock');
      const { app } = await loaded();
      const stop = app.start();
      let answer!: (response: Response) => void;
      routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
      routes['POST /api/auth/delete'] = () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        });
      try {
        app.openAccountDeletion();
        const pending = app.deleteAccount('wrong');
        await vi.waitFor(() => expect(answer).toBeDefined());
        browserState.push('#/clubs');
        expect(get(app.state)).toMatchObject({ route: { name: 'clubs' }, deletingAccount: false });
        answer(Response.json({ error: 'Incorrect password. Your account was not deleted.' }, { status: 400 }));
        expect(await pending).toBe(false);
        expect(get(app.state)).toMatchObject({
          route: { name: 'clubs' },
          user: { id: 'u1' },
          deletingAccount: false,
          error: 'Incorrect password. Your account was not deleted.',
        });
      } finally {
        stop();
      }
    });

    it('clears its own error but leaves a banner error alone when it was not open', async () => {
      browser('#/stock');
      const { app } = await loaded();
      routes['GET /api/glazes'] = () => Response.json({ error: 'Down' }, { status: 500 });
      await app.refresh();
      const banner = get(app.state).error;
      expect(banner).not.toBe('');
      app.navigate({ name: 'clubs' }, { replace: true });
      expect(get(app.state).error).toBe(banner);
      app.openAccountDeletion();
      app.navigate({ name: 'stock' }, { replace: true });
      expect(get(app.state)).toMatchObject({ deletingAccount: false, error: '' });
    });

    it('returns to the blocking terms dialog, which a route change neither closes nor signs out', async () => {
      routes['GET /api/auth/me'] = () => Response.json(outdated);
      const browserState = browser('#/stock');
      const { app } = await loaded();
      const stop = app.start();
      try {
        expect(termsPending(get(app.state))).toBe(true);
        app.openAccountDeletion();
        expect(get(app.state).deletingAccount).toBe(true);
        browserState.history.back();
        browserState.push('#/clubs');
        expect(get(app.state)).toMatchObject({ route: { name: 'clubs' }, deletingAccount: false });
        expect(termsPending(get(app.state))).toBe(true);
        expect(get(app.state).user).toEqual(outdated);
        // Navigation still works while the terms are pending, and a fresh deletion can start.
        browserState.push('#/stock');
        expect(get(app.state).route).toMatchObject({ name: 'stock' });
        app.openAccountDeletion();
        expect(get(app.state).deletingAccount).toBe(true);
      } finally {
        stop();
      }
    });

    it('leaves the leave question alone and closes with the page once it is discarded', async () => {
      const browserState = browser('#/studio');
      const { app } = await loaded();
      const stop = app.start();
      try {
        app.registerLeaveGuard({ dirty: () => true, message: 'drafts.discardCombination' });
        app.openAccountDeletion();
        browserState.push('#/stock');
        expect(get(app.state)).toMatchObject({
          route: { name: 'studio' },
          leaving: { route: { name: 'stock' } },
          deletingAccount: true,
        });
        app.leaveAnyway();
        expect(get(app.state)).toMatchObject({
          route: { name: 'stock' },
          leaving: null,
          deletingAccount: false,
        });
      } finally {
        stop();
      }
    });
  });

  it('falls back on a direct visit, even with a marker left by a previous controller', async () => {
    const browserState = browser('#/glazes/g1');
    browserState.history.replaceState({ glazelabNavigation: { session: 'old', previous: { name: 'stock' } } }, '', '#/glazes/g1');
    const { app } = await loaded();
    const stop = app.start();
    try {
      expect(get(app.state).previousRoute).toBeNull();
      app.back({ name: 'discover', type: 'glazes' });
      expect(browserState.history.back).not.toHaveBeenCalled();
      expect(location.hash).toBe('#/?type=glazes');
    } finally {
      stop();
    }
  });

  it('returns to the real previous entry and retains the chain across back and forward', async () => {
    const browserState = browser('#/?q=rutile');
    const { app } = await loaded();
    const stop = app.start();
    try {
      browserState.push('#/combinations/c1');
      expect(get(app.state).previousRoute).toEqual({
        name: 'discover',
        q: 'rutile',
      });
      browserState.push('#/glazes/g1');
      expect(get(app.state).previousRoute).toEqual({ name: 'combination', id: 'c1' });
      app.back({ name: 'discover', type: 'glazes' });
      expect(location.hash).toBe('#/combinations/c1');
      expect(get(app.state).previousRoute).toEqual({
        name: 'discover',
        q: 'rutile',
      });
      browserState.history.forward();
      expect(location.hash).toBe('#/glazes/g1');
      expect(get(app.state).previousRoute).toEqual({ name: 'combination', id: 'c1' });
      app.back({ name: 'discover', type: 'glazes' });
      app.back({ name: 'discover' });
      expect(location.hash).toBe('#/?q=rutile');
      expect(get(app.state).previousRoute).toBeNull();
    } finally {
      stop();
    }
  });

  it('keeps no photo pointer in the recorded predecessor, and opens the carousel photo of a link', async () => {
    const browserState = browser('#/image-reports');
    const { app } = await loaded();
    const stop = app.start();
    try {
      browserState.push('#/glazes/g1?photo=i1');
      expect(get(app.state).route).toEqual({ name: 'glaze', id: 'g1', photo: 'i1' });
      expect(get(app.state).previousRoute).toEqual({ name: 'image-reports' });
      browserState.push('#/combinations/c1');
      expect(get(app.state).previousRoute).toEqual({ name: 'glaze', id: 'g1' });
      browserState.push('#/glazes/g1?photo=i2');
      browserState.push('#/glazes/g1');
      expect(get(app.state).previousRoute).toBeNull();
      // The same page at another photo is no predecessor either: its back link would lead to itself.
      browserState.push('#/glazes/g1?photo=i3');
      expect(get(app.state).previousRoute).toBeNull();
    } finally {
      stop();
    }
  });

  it('preserves list state on search replacement and returns to the final filter entry', async () => {
    const browserState = browser('#/glazes');
    const { app } = await loaded();
    const stop = app.start();
    try {
      const positions = { glazes: { limit: 36, scrollY: 1200, focus: '#/glazes/g1' } };
      browserState.history.replaceState({ ...history.state, glazelabLists: positions }, '', '#/glazes');
      app.navigate({ name: 'discover', type: 'glazes', q: 'rutile', tags: ['blue'], sort: 'az' }, { replace: true });
      expect(history.state.glazelabLists).toEqual(positions);
      browserState.push('#/glazes/g1');
      expect(get(app.state).previousRoute).toEqual({
        name: 'discover',
        type: 'glazes',
        q: 'rutile',
        tags: ['blue'],
        sort: 'az',
      });
      app.back({ name: 'discover', type: 'glazes' });
      expect(location.hash).toBe('#/?type=glazes&q=rutile&tags=blue&sort=az');
      expect(history.state.glazelabLists).toEqual(positions);
    } finally {
      stop();
    }
  });

  it('does not turn a replaced page into a new predecessor or record raw tokens', async () => {
    const browserState = browser('#/stock');
    const { app } = await loaded();
    const stop = app.start();
    try {
      browserState.push('#/verify/secret-token');
      app.navigate({ name: 'discover' }, { replace: true });
      expect(get(app.state).previousRoute).toEqual({ name: 'stock' });
      expect(JSON.stringify(history.state)).not.toContain('secret-token');
      browserState.push('#/glazes/g1');
      app.navigate({ name: 'combination', id: 'c1' }, { replace: true });
      expect(get(app.state).previousRoute).toEqual({ name: 'discover' });
      app.back({ name: 'discover' });
      expect(location.hash).toBe('#/');
      browserState.push('#/login/other-secret');
      browserState.push('#/glazes/g1');
      expect(get(app.state).previousRoute).toBeNull();
      expect(JSON.stringify(history.state)).not.toContain('other-secret');
    } finally {
      stop();
    }
  });

  it('applies the draft guard when going back and permits Stay or Discard', async () => {
    const browserState = browser('#/glazes/g1');
    const { app } = await loaded();
    const stop = app.start();
    try {
      browserState.push('#/studio');
      app.registerLeaveGuard({ dirty: () => true, message: 'drafts.discardCombination' });
      app.back({ name: 'discover' });
      expect(get(app.state)).toMatchObject({
        route: { name: 'studio' },
        leaving: { route: { name: 'glaze', id: 'g1' } },
      });
      expect(location.hash).toBe('#/studio');
      app.stay();
      expect(get(app.state)).toMatchObject({ route: { name: 'studio' }, leaving: null });
      app.navigate({ name: 'glaze', id: 'g1' });
      app.leaveAnyway();
      browserState.push('#/glazes/g1');
      expect(get(app.state).leaving).toBeNull();
    } finally {
      stop();
    }
  });
  it('records no history and ignores the hash once stopped, and a restart forgets the old predecessor', async () => {
    const browserState = browser('#/stock');
    const { app } = await loaded();
    let stop = app.start();
    browserState.push('#/clubs');
    expect(get(app.state).previousRoute).toEqual({ name: 'stock' });
    stop();
    stop = app.start();
    try {
      expect(get(app.state).previousRoute).toBeNull();
    } finally {
      stop();
    }
    app.navigate({ name: 'discover' }, { replace: true });
    expect(get(app.state).route).toEqual({ name: 'discover' });
    expect(browserState.history.state).toBeNull();
  });
});

describe('the photo viewer entry (24-11)', () => {
  const settle = () => new Promise<void>((done) => setTimeout(done, 0));

  it('pops the viewer before a link, a replacement or the Back link moves on, so no entry of the viewer remains', async () => {
    const { session } = stubSessionHistory('#/glazes/g1');
    const { app } = await loaded();
    const stop = app.start();
    try {
      session.entries.length = 1; // the page entry is the first one
      enterViewer(() => {});
      expect(session.length).toBe(2);
      app.navigate({ name: 'stock' });
      expect(location.hash).toBe('#/glazes/g1'); // waits for the pop
      await settle();
      await settle();
      expect(location.hash).toBe('#/stock');
      expect(session.entries.map((entry) => entry.hash)).toEqual(['#/glazes/g1', '#/stock']);
      expect(get(app.state)).toMatchObject({ route: { name: 'stock' }, previousRoute: { name: 'glaze', id: 'g1' } });
      // The Back link goes to the page, not to a viewer entry.
      app.back({ name: 'discover' });
      await settle();
      expect(session.index).toBe(0);
      expect(location.hash).toBe('#/glazes/g1');
      expect(session.state).not.toHaveProperty('glazelabViewer');

      // A replacement (sign-out, session end) takes the same way: the page's entry is replaced, none is left in front of it.
      enterViewer(() => {});
      app.navigate({ name: 'discover' }, { replace: true });
      await settle();
      expect(session.index).toBe(0);
      expect(location.hash).toBe('#/');
      expect(session.state).not.toHaveProperty('glazelabViewer');
    } finally {
      stop();
    }
  });

  it('goes back past the page, not just past the viewer, when the Back link is used with the viewer open', async () => {
    const { session } = stubSessionHistory('#/stock');
    const { app } = await loaded();
    const stop = app.start();
    try {
      app.navigate({ name: 'glaze', id: 'g1' });
      await settle();
      expect(session.index).toBe(1);
      enterViewer(() => {});
      app.back({ name: 'discover' });
      await settle();
      await settle();
      expect(session.index).toBe(0);
      expect(location.hash).toBe('#/stock');
    } finally {
      stop();
    }
  });

  it('steps back over a viewer entry the page was reloaded on, and over one reached again', async () => {
    const { session } = stubSessionHistory('#/glazes/g1');
    const { app } = await loaded();
    session.pushState({ glazelabViewer: 'old' }, '', '#/glazes/g1');
    const stop = app.start();
    try {
      await settle();
      expect(session.index).toBe(0);
      session.forward();
      await settle();
      await settle();
      expect(session.index).toBe(0);
    } finally {
      stop();
    }
  });
});
