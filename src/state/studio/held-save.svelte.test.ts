import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { createAppController } from '../app/app-controller';
import { createHeldSave } from './held-save.svelte';
import { studioLeaveQuestion } from '../../lib/studio/held-save';
import { flat, routes, stubBrowser, unreachable, useMockApi, user } from '../app/test-helpers';

useMockApi();

interface Request {
  input: { title: string; steps: never[] };
  id?: string;
  draft: boolean;
}

const settle = () => new Promise((resolve) => setTimeout(resolve));
const draftRequest: Request = { input: { title: 'Blue over cream', steps: [] }, draft: true };

describe('createHeldSave with signals', () => {
  let stop: (() => void) | undefined;
  afterEach(() => stop?.());

  function setup() {
    const sent: Request[] = [];
    let ready = $state(false);
    let account = $state<string | undefined>('u1');
    let answer = $state(true);
    let held!: ReturnType<typeof createHeldSave<Request>>;
    stop = $effect.root(() => {
      held = createHeldSave<Request>({
        account: () => account,
        ready: () => ready,
        send: async (request) => {
          sent.push(request);
          return answer;
        },
      });
    });
    return {
      held,
      sent,
      setReady: (value: boolean) => (ready = value),
      setAccount: (value: string | undefined) => (account = value),
      setAnswer: (value: boolean) => (answer = value),
    };
  }

  it('waits until ready, then sends once however often ready flaps afterwards', async () => {
    const s = setup();
    expect(s.held.hold(draftRequest)).toBe(true);
    await settle();
    expect(s.sent).toEqual([]);
    s.setReady(true);
    await settle();
    s.setReady(false);
    await settle();
    s.setReady(true);
    await settle();
    expect(s.sent).toEqual([draftRequest]);
    expect(s.held.phase).toBe('done');
  });

  it('sends nothing when the writer cancels before the effect sees the connection', async () => {
    const s = setup();
    s.held.hold(draftRequest);
    s.setReady(true);
    s.held.cancel();
    await settle();
    expect(s.sent).toEqual([]);
    expect(s.held.phase).toBe('cancelled');
  });

  it('cannot cancel a save that is sending', async () => {
    const s = setup();
    s.setReady(true);
    s.held.hold(draftRequest);
    await Promise.resolve();
    expect(s.held.phase).toBe('sending');
    s.held.cancel();
    expect(s.held.phase).toBe('sending');
    await settle();
    expect(s.sent).toHaveLength(1);
    expect(s.held.phase).toBe('done');
  });

  it('ends failed when the send fails and holds again afterwards', async () => {
    const s = setup();
    s.setAnswer(false);
    s.setReady(true);
    s.held.hold(draftRequest);
    await settle();
    expect(s.held.phase).toBe('failed');
    expect(s.held.active).toBe(false);
    expect(s.held.request).toBeUndefined();
    expect(s.held.hold({ ...draftRequest, draft: false })).toBe(true);
  });

  it('refuses a second hold while one waits and holds nothing for nobody', () => {
    const s = setup();
    expect(s.held.hold(draftRequest)).toBe(true);
    expect(s.held.hold({ ...draftRequest, draft: false })).toBe(false);
    expect(s.held.request).toBe(draftRequest);
    s.setAccount(undefined);
    s.held.cancel();
    expect(s.held.hold(draftRequest)).toBe(false);
  });

  it('drops the request when the account changes or signs out, even if it returns', async () => {
    const s = setup();
    s.held.hold(draftRequest);
    s.setAccount('u2');
    await settle();
    expect(s.held.phase).toBe('cancelled');
    s.setAccount('u1');
    s.setReady(true);
    await settle();
    expect(s.sent).toEqual([]);

    s.held.hold(draftRequest);
    s.setReady(false);
    s.setAccount(undefined);
    await settle();
    s.setAccount('u1');
    s.setReady(true);
    await settle();
    expect(s.sent).toEqual([]);
  });

  it('never lets the late answer of a dropped send end a newer one', async () => {
    const answers: ((ok: boolean) => void)[] = [];
    let account = $state<string | undefined>('u1');
    let held!: ReturnType<typeof createHeldSave<Request>>;
    stop = $effect.root(() => {
      held = createHeldSave<Request>({
        account: () => account,
        ready: () => true,
        send: () => new Promise<boolean>((resolve) => answers.push(resolve)),
      });
    });
    held.hold(draftRequest);
    await settle();
    expect(held.phase).toBe('sending');
    account = 'u2';
    await settle();
    expect(held.phase).toBe('cancelled');
    held.hold({ ...draftRequest, draft: false });
    await settle();
    expect(held.phase).toBe('sending');
    answers[0](true);
    await settle();
    // The form stays locked until its own request answers.
    expect(held.phase).toBe('sending');
    answers[1](false);
    await settle();
    expect(held.phase).toBe('failed');
  });

  it('sends nothing after the page is gone', async () => {
    const s = setup();
    s.held.hold(draftRequest);
    stop?.();
    s.setReady(true);
    await settle();
    expect(s.sent).toEqual([]);
  });
});

describe('createHeldSave with the controller', () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => cleanup?.());

  /** A controller loaded while the device is offline, and a held save wired as Studio wires it. */
  async function offline() {
    const { events } = stubBrowser('#/studio');
    vi.stubGlobal('navigator', { onLine: false });
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    const posts: unknown[] = [];
    routes['POST /api/combinations'] = async (request) => {
      posts.push(await request.json());
      return Response.json({ id: 'd1' });
    };
    const app = createAppController();
    const stopApp = app.start();
    await vi.waitFor(() => expect(flat(get(app.state)).loading).toBe(false));
    expect(get(app.state)).toMatchObject({ user, online: false });
    let snapshot = $state.raw(get(app.state));
    const unsubscribe = app.state.subscribe((value) => (snapshot = value));
    let held!: ReturnType<typeof createHeldSave<Request>>;
    const stopEffects = $effect.root(() => {
      held = createHeldSave<Request>({
        account: () => snapshot.user?.id,
        ready: () => snapshot.online && !flat(snapshot).loading,
        send: async ({ input, id, draft }) => !!(await app.saveCombination(input, id, draft)),
      });
    });
    cleanup = () => {
      stopEffects();
      unsubscribe();
      stopApp();
    };
    const goOnline = () => {
      vi.stubGlobal('navigator', { onLine: true });
      events.dispatchEvent(new Event('online'));
    };
    return { app, held, posts, goOnline, events, stopEffects };
  }

  it('sends the held draft once when the connection returns, then opens it like a normal save', async () => {
    const s = await offline();
    expect(s.held.hold(draftRequest)).toBe(true);
    await settle();
    expect(s.posts).toEqual([]);
    s.goOnline();
    s.goOnline();
    await vi.waitFor(() => expect(s.held.phase).toBe('done'));
    await settle();
    expect(s.posts).toEqual([{ title: 'Blue over cream', steps: [], draft: true }]);
    expect(location.hash).toBe('#/combinations/d1');
    expect(get(s.app.state).toast).toBe('notices.draftSaved');
  });

  it('does not send while the API stays unreachable and flapping, only when it answers', async () => {
    const s = await offline();
    const answer = routes['GET /api/auth/me'];
    routes['GET /api/auth/me'] = unreachable;
    s.held.hold(draftRequest);
    s.goOnline();
    await settle();
    s.events.dispatchEvent(new Event('offline'));
    await settle();
    s.goOnline();
    await settle();
    expect(s.posts).toEqual([]);
    expect(s.held.phase).toBe('held');
    routes['GET /api/auth/me'] = answer;
    s.goOnline();
    await vi.waitFor(() => expect(s.held.phase).toBe('done'));
    expect(s.posts).toHaveLength(1);
  });

  it('sends nothing for a cancelled save', async () => {
    const s = await offline();
    s.held.hold(draftRequest);
    s.held.cancel();
    s.goOnline();
    await vi.waitFor(() => expect(flat(get(s.app.state))).toMatchObject({ online: true, loading: false }));
    await settle();
    expect(s.posts).toEqual([]);
  });

  it('drops the held save on sign-out, so signing in again sends nothing', async () => {
    const s = await offline();
    s.held.hold(draftRequest);
    await s.app.logout();
    expect(get(s.app.state).user).toBeNull();
    await settle();
    expect(s.held.phase).toBe('cancelled');
    routes['POST /api/auth/logout'] = () => new Response(null, { status: 204 });
    s.goOnline();
    await vi.waitFor(() => expect(get(s.app.state)).toMatchObject({ online: true, user }));
    await settle();
    expect(s.posts).toEqual([]);
    expect(s.held.phase).toBe('cancelled');
  });

  it('drops the held save when the session turns out to belong to another account', async () => {
    const s = await offline();
    s.held.hold(draftRequest);
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2', displayName: 'Bo' });
    s.goOnline();
    await vi.waitFor(() => expect(get(s.app.state).user?.id).toBe('u2'));
    await settle();
    expect(s.posts).toEqual([]);
    expect(s.held.phase).toBe('cancelled');
  });

  it('sends nothing once the page is gone', async () => {
    const s = await offline();
    s.held.hold(draftRequest);
    s.stopEffects();
    s.goOnline();
    await vi.waitFor(() => expect(flat(get(s.app.state))).toMatchObject({ online: true, loading: false }));
    await settle();
    expect(s.posts).toEqual([]);
  });

  it.each([
    [400, 'Give the combination a title before publishing it.'],
    [500, 'Something went wrong'],
  ])('keeps the form and shows a %i at the combination form', async (status, message) => {
    const s = await offline();
    routes['POST /api/combinations'] = () => Response.json({ error: message }, { status });
    s.held.hold({ ...draftRequest, draft: false });
    s.goOnline();
    await vi.waitFor(() => expect(s.held.phase).toBe('failed'));
    expect(get(s.app.state).formError).toEqual({ form: 'combination', message });
    expect(location.hash).toBe('#/studio');
    expect(s.held.active).toBe(false);
  });

  it('sends the edit of a published combination as one PUT', async () => {
    const s = await offline();
    const puts: unknown[] = [];
    routes['PUT /api/combinations/c1'] = async (request) => {
      puts.push(await request.json());
      return new Response(null, { status: 204 });
    };
    const input = { title: 'Edited', steps: [] };
    s.held.hold({ input, id: 'c1', draft: false });
    s.goOnline();
    await vi.waitFor(() => expect(s.held.phase).toBe('done'));
    expect(puts).toEqual([input]);
    expect(location.hash).toBe('#/combinations/c1');
  });

  it('rewords a leave question that is open when the held save starts sending, so it never offers a discard it cannot keep', async () => {
    const s = await offline();
    let answer!: () => void;
    routes['POST /api/combinations'] = async () => {
      await new Promise<void>((resolve) => (answer = resolve));
      return Response.json({ id: 'd1' });
    };
    // Studio registers its guard again whenever its question changes (an `$effect` over `studioLeaveQuestion`).
    const register = () => {
      const { dirty, ...question } = studioLeaveQuestion({ dirty: true, phase: s.held.phase, saving: false });
      return s.app.registerLeaveGuard({ dirty: () => dirty, ...question });
    };
    let release = register();
    s.held.hold(draftRequest);
    release();
    release = register();
    s.app.navigate({ name: 'discover' });
    expect(get(s.app.state).leaving).toMatchObject({ route: { name: 'discover' }, message: 'studio.held.discard' });
    s.goOnline();
    await vi.waitFor(() => expect(s.held.phase).toBe('sending'));
    release();
    release = register();
    expect(get(s.app.state).leaving).toMatchObject({
      route: { name: 'discover' },
      message: 'studio.leave.saving',
      body: 'studio.leave.savingBody',
      leave: 'studio.leave.anyway',
    });
    await vi.waitFor(() => expect(answer).toBeTypeOf('function'));
    answer();
    await vi.waitFor(() => expect(s.held.phase).toBe('done'));
    release();
  });

  it('asks a different question while the held save is sending, and a Leave keeps the writer where they went', async () => {
    const s = await offline();
    let answer!: () => void;
    routes['POST /api/combinations'] = async () => {
      await new Promise<void>((resolve) => {
        answer = resolve;
      });
      return Response.json({ id: 'd1' });
    };
    // Studio's guard, as `StudioPage` registers it.
    const question = () => studioLeaveQuestion({ dirty: true, phase: s.held.phase, saving: false });
    const release = s.app.registerLeaveGuard({
      dirty: () => question().dirty,
      get message() {
        return question().message;
      },
      get body() {
        return question().body;
      },
      get leave() {
        return question().leave;
      },
    });
    s.held.hold(draftRequest);
    s.app.navigate({ name: 'discover' });
    expect(get(s.app.state).leaving).toMatchObject({ message: 'studio.held.discard' });
    s.app.stay();
    s.goOnline();
    await vi.waitFor(() => expect(s.held.phase).toBe('sending'));
    await vi.waitFor(() => expect(answer).toBeTypeOf('function'));
    s.app.navigate({ name: 'discover' });
    expect(get(s.app.state).leaving).toMatchObject({ message: 'studio.leave.saving', leave: 'studio.leave.anyway' });
    s.app.leaveAnyway();
    s.events.dispatchEvent(new Event('hashchange'));
    expect(get(s.app.state).route).toEqual({ name: 'discover' });
    release();
    answer();
    await vi.waitFor(() => expect(get(s.app.state).toast).toBe('notices.combinationSavedAway'));
    expect(get(s.app.state).route).toEqual({ name: 'discover' });
  });
});
