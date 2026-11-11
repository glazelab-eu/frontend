import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { TOO_MANY_REQUESTS } from '../../lib/api/client';
import type { Buddies } from '../../lib/api/models';
import { emptyBuddies, requestCount } from '../../lib/buddies/buddies';
import { readSnapshot } from '../../lib/offline/snapshots';
import { createAppController } from './app-controller';
import { buddyMemberForm } from './app-state';
import { flat, loaded, routes, tooMany, unreachable, useMockApi, user } from './test-helpers';

useMockApi();

const ada = { id: 'u2', displayName: 'Ada', since: '2026-10-31T10:00:00Z', avatarId: null };
const ben = { id: 'u3', displayName: 'Ben', since: '2026-10-31T11:00:00Z', avatarId: null };
const cy = { id: 'u4', displayName: 'Cy', since: '2026-10-31T12:00:00Z', avatarId: null };
const lists: Buddies = { buddies: [ada], incoming: [ben], outgoing: [cy], hasLink: true };
const noContent = () => new Response(null, { status: 204 });
const changed = () => Response.json({ error: 'This changed meanwhile. Please try again.' }, { status: 409 });

let replaced: unknown[];
beforeEach(() => {
  replaced = [];
  vi.stubGlobal('window', Object.assign(new EventTarget(), { scrollTo: vi.fn() }));
  vi.stubGlobal('location', { hash: '#/account', origin: 'https://glazelab.eu', pathname: '/' });
  vi.stubGlobal('history', { state: null, replaceState: (...args: unknown[]) => replaced.push(args[2]) });
  routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
  routes['GET /api/buddies'] = () => Response.json(lists);
});

/** Answers a request only when the test says so, so an action can be overtaken by an account change. */
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

describe('loading the buddies', () => {
  it('reads them with the other listings and counts the requests to the account', async () => {
    const { state } = await loaded();
    expect(state.buddies).toEqual(lists);
    expect(requestCount(state.buddies)).toBe(1);
  });

  it('asks a guest for none and shows none', async () => {
    routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
    routes['GET /api/buddies'] = () => {
      throw new Error('a guest has no buddies');
    };
    const { state } = await loaded();
    expect(state.user).toBeNull();
    expect(state.buddies).toEqual(emptyBuddies());
  });

  it('saves them with the snapshot and shows the saved ones when the API is unreachable', async () => {
    await loaded();
    expect((await readSnapshot(user.id))?.buddies).toEqual(lists);
    for (const key of Object.keys(routes)) routes[key] = unreachable;
    const { state } = await loaded();
    expect(flat(state)).toMatchObject({ online: false, loadFailed: true, buddies: lists });
  });

  it('drops them with the account: another account starts with none', async () => {
    const { app } = await loaded();
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u9' });
    const request = delayed('GET /api/buddies');
    const pending = app.refresh();
    await request.requested;
    // The previous account's buddies are gone before anything of the new account arrives.
    expect(flat(get(app.state))).toMatchObject({ user: { id: 'u9' }, loading: true, buddies: emptyBuddies() });
    request.answer(Response.json(emptyBuddies()));
    await pending;
    expect(get(app.state).buddies).toEqual(emptyBuddies());
  });

  it('keeps a load that fails on the buddies as a failed load with the saved ones', async () => {
    await loaded();
    routes['GET /api/buddies'] = tooMany;
    const { state } = await loaded();
    expect(flat(state)).toMatchObject({ loadFailed: true, loadFailure: 'rateLimited', buddies: lists });
  });
});

describe('answering a request, ending a pair and cancelling', () => {
  const after: Buddies = { buddies: [ada, ben], incoming: [], outgoing: [cy], hasLink: true };

  it.each([
    ['acceptBuddy', ben, 'POST /api/buddies/u3/accept', 'notices.buddiesNow', { ...lists, buddies: [ada, ben], incoming: [] }],
    ['declineBuddy', ben, 'POST /api/buddies/u3/decline', 'notices.buddyDeclined', { ...lists, incoming: [] }],
    ['cancelBuddyRequest', cy, 'POST /api/buddies/u4/cancel', 'notices.buddyCancelled', { ...lists, outgoing: [] }],
    ['removeBuddy', ada, 'DELETE /api/buddies/u2', 'notices.buddyRemoved', { ...lists, buddies: [] }],
  ] as const)('%s sends its request, reloads the lists and names the buddy in the notice', async (action, buddy, key, notice, result) => {
    const { app } = await loaded();
    routes[key] = () => {
      routes['GET /api/buddies'] = () => Response.json(result);
      return noContent();
    };
    expect(await app[action](buddy)).toBe(true);
    expect(get(app.state)).toMatchObject({ buddies: result, toast: notice, toastValues: { name: buddy.displayName }, formError: null, error: '' });
    // The saved copy follows, so a reload without a connection shows the same lists.
    expect((await readSnapshot(user.id))?.buddies).toEqual(result);
  });

  it('sends the request and nothing else for an accept', async () => {
    const { app } = await loaded();
    const sent: string[] = [];
    routes['POST /api/buddies/u3/accept'] = (request) => {
      sent.push(`${request.method} ${new URL(request.url).pathname} ${request.headers.get('X-XSRF-TOKEN')}`);
      routes['GET /api/buddies'] = () => Response.json(after);
      return noContent();
    };
    await app.acceptBuddy(ben);
    expect(sent).toEqual(['POST /api/buddies/u3/accept csrf']);
  });

  it('shows a refusal at the Buddies form, after reloading what changed meanwhile', async () => {
    const { app } = await loaded();
    routes['POST /api/buddies/u4/cancel'] = () => {
      routes['GET /api/buddies'] = () => Response.json({ ...lists, outgoing: [], buddies: [ada, cy] });
      return changed();
    };
    expect(await app.cancelBuddyRequest(cy)).toBe(false);
    expect(get(app.state)).toMatchObject({
      buddies: { buddies: [ada, cy], outgoing: [] },
      formError: { form: 'buddies', message: 'This changed meanwhile. Please try again.' },
      toast: '',
    });
  });

  it('reports a request that no longer exists and refreshes the lists', async () => {
    const { app } = await loaded();
    routes['POST /api/buddies/u3/accept'] = () => {
      routes['GET /api/buddies'] = () => Response.json({ ...lists, incoming: [] });
      return Response.json({ error: 'Buddy request not found' }, { status: 404 });
    };
    expect(await app.acceptBuddy(ben)).toBe(false);
    expect(get(app.state)).toMatchObject({ buddies: { incoming: [] }, formError: { form: 'buddies', message: 'Buddy request not found' } });
  });

  it('shows a refused accept from a club member row at that row, after reloading the lists', async () => {
    const { app } = await loaded();
    routes['POST /api/buddies/u3/accept'] = () => {
      routes['GET /api/buddies'] = () => Response.json({ ...lists, incoming: [] });
      return Response.json({ error: 'Buddy request not found' }, { status: 404 });
    };
    expect(await app.acceptBuddy(ben, buddyMemberForm('u3'))).toBe(false);
    // The club page shows only its member rows' errors: a refusal at the Buddies form would never be seen there.
    expect(get(app.state)).toMatchObject({ buddies: { incoming: [] }, formError: { form: buddyMemberForm('u3'), message: 'Buddy request not found' } });
  });

  it('reports a rate limit without signing out or losing the lists', async () => {
    const { app } = await loaded();
    routes['DELETE /api/buddies/u2'] = tooMany;
    expect(await app.removeBuddy(ada)).toBe(false);
    expect(get(app.state)).toMatchObject({ user, online: true, buddies: lists, formError: { form: 'buddies', message: TOO_MANY_REQUESTS } });
  });

  it('does nothing offline: no request, the saved lists stay', async () => {
    await loaded();
    for (const key of Object.keys(routes)) routes[key] = unreachable;
    const { app } = await loaded();
    expect(get(app.state).online).toBe(false);
    routes['POST /api/buddies/u3/accept'] = () => {
      throw new Error('an offline write must not be sent');
    };
    expect(await app.acceptBuddy(ben)).toBe(false);
    expect(await app.createBuddyLink(false)).toBeNull();
    expect(get(app.state)).toMatchObject({ buddies: lists, formError: null });
  });

  it('answers one action per buddy at a time', async () => {
    const { app } = await loaded();
    const request = delayed('POST /api/buddies/u3/accept');
    const first = app.acceptBuddy(ben);
    await request.requested;
    expect(await app.acceptBuddy(ben)).toBe(false);
    request.answer(noContent());
    expect(await first).toBe(true);
  });

  it('drops a late answer after an account change: no notice, no lists of the other account', async () => {
    const { app } = await loaded();
    const request = delayed('POST /api/buddies/u3/accept');
    const pending = app.acceptBuddy(ben);
    await request.requested;
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u9' });
    routes['GET /api/buddies'] = () => Response.json(emptyBuddies());
    await app.refresh();
    request.answer(noContent());
    expect(await pending).toBe(false);
    expect(get(app.state)).toMatchObject({ user: { id: 'u9' }, buddies: emptyBuddies(), toast: '', formError: null });
  });

  it('drops a late failure after an account change', async () => {
    const { app } = await loaded();
    const request = delayed('DELETE /api/buddies/u2');
    const pending = app.removeBuddy(ada);
    await request.requested;
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u9' });
    routes['GET /api/buddies'] = () => Response.json(emptyBuddies());
    await app.refresh();
    request.answer(Response.json({ error: 'Not allowed.' }, { status: 403 }));
    expect(await pending).toBe(false);
    expect(get(app.state)).toMatchObject({ user: { id: 'u9' }, error: '', formError: null });
  });
});

describe('the buddy link', () => {
  const token = 'T'.repeat(43);

  it('creates or replaces it, answers the link and keeps the token in memory only', async () => {
    routes['GET /api/buddies'] = () => Response.json({ ...lists, hasLink: false });
    const { app } = await loaded();
    expect(app.buddyLink()).toBeNull();
    routes['POST /api/buddies/link'] = () => Response.json({ token });
    const stored = vi.spyOn(localStorage, 'setItem');
    expect(await app.createBuddyLink(false)).toBe(`https://glazelab.eu/#/buddy/${token}`);
    expect(app.buddyLink()).toBe(`https://glazelab.eu/#/buddy/${token}`);
    expect(get(app.state).buddies.hasLink).toBe(true);
    // Never in the store, the snapshot, storage or history.
    expect(JSON.stringify(get(app.state))).not.toContain(token);
    expect(JSON.stringify(await readSnapshot(user.id))).not.toContain(token);
    expect(stored.mock.calls.flat().join(' ')).not.toContain(token);
    expect(replaced).toEqual([]);
  });

  it('never replaces a link made meanwhile elsewhere through Create: the page learns of it and Replace asks first', async () => {
    routes['GET /api/buddies'] = () => Response.json({ ...lists, hasLink: false });
    const { app } = await loaded();
    // Another device or tab made a link after this page read the lists.
    routes['GET /api/buddies'] = () => Response.json(lists);
    routes['POST /api/buddies/link'] = () => {
      throw new Error('Create must not replace a link it did not know of');
    };
    expect(await app.createBuddyLink(false)).toBeNull();
    expect(get(app.state)).toMatchObject({ buddies: { hasLink: true }, formError: { form: 'buddy-link', message: 'errors.buddyLinkExists' } });
    expect((await readSnapshot(user.id))?.buddies.hasLink).toBe(true);
    // Replace (after the question) sends it.
    routes['POST /api/buddies/link'] = () => Response.json({ token });
    expect(await app.createBuddyLink(true)).toBe(`https://glazelab.eu/#/buddy/${token}`);
    expect(get(app.state).formError).toBeNull();
  });

  it('creates a first link after checking that there is none', async () => {
    routes['GET /api/buddies'] = () => Response.json({ ...lists, hasLink: false });
    const { app } = await loaded();
    routes['POST /api/buddies/link'] = () => Response.json({ token });
    expect(await app.createBuddyLink(false)).toBe(`https://glazelab.eu/#/buddy/${token}`);
  });

  it('forgets the token when the account changes', async () => {
    const { app } = await loaded();
    routes['POST /api/buddies/link'] = () => Response.json({ token });
    await app.createBuddyLink(true);
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u9' });
    routes['GET /api/buddies'] = () => Response.json(emptyBuddies());
    await app.refresh();
    expect(app.buddyLink()).toBeNull();
  });

  it('keeps the shown link through a reload of the lists', async () => {
    const { app } = await loaded();
    routes['POST /api/buddies/link'] = () => Response.json({ token });
    await app.createBuddyLink(true);
    await app.refresh();
    expect(app.buddyLink()).toContain(token);
  });

  it('reports a failure at the link form and a rate limit with the existing message', async () => {
    const { app } = await loaded();
    routes['POST /api/buddies/link'] = tooMany;
    expect(await app.createBuddyLink(true)).toBeNull();
    expect(get(app.state)).toMatchObject({ formError: { form: 'buddy-link', message: TOO_MANY_REQUESTS }, error: '' });
    expect(app.buddyLink()).toBeNull();
  });

  it('drops a link that arrives after an account change', async () => {
    const { app } = await loaded();
    const request = delayed('POST /api/buddies/link');
    const pending = app.createBuddyLink(true);
    await request.requested;
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u9' });
    routes['GET /api/buddies'] = () => Response.json(emptyBuddies());
    await app.refresh();
    request.answer(Response.json({ token }));
    expect(await pending).toBeNull();
    expect(app.buddyLink()).toBeNull();
  });
});

describe('opening a buddy link', () => {
  const token = 'L'.repeat(43);

  it('previews the owner and the relation without requesting anything', async () => {
    const { app } = await loaded();
    routes['POST /api/buddies/link/request'] = () => {
      throw new Error('a preview must not request');
    };
    const bodies: unknown[] = [];
    routes['POST /api/buddies/link/preview'] = async (request) => {
      bodies.push(await request.json());
      return Response.json({ displayName: 'Ada', relation: 'NONE' });
    };
    expect(await app.previewBuddyLink(token)).toEqual({ displayName: 'Ada', relation: 'NONE' });
    expect(bodies).toEqual([{ token }]);
    expect(replaced).toEqual([]);
  });

  it('says an invalid or replaced link at the buddy form, without detail', async () => {
    const { app } = await loaded();
    routes['POST /api/buddies/link/preview'] = () => Response.json({ error: 'This buddy link is invalid or was replaced' }, { status: 404 });
    expect(await app.previewBuddyLink(token)).toBeNull();
    expect(get(app.state).formError).toEqual({ form: 'buddy', message: 'This buddy link is invalid or was replaced' });
  });

  it.each([['abc'], [`${token}.`], [`${token} `], ['L'.repeat(44)], ['L'.repeat(42) + '+']])(
    'calls a malformed link %j invalid without asking the server (no form-field message, no rate-limit budget)',
    async (malformed) => {
      const { app } = await loaded();
      routes['POST /api/buddies/link/preview'] = () => {
        throw new Error('a malformed token must not be sent');
      };
      expect(await app.previewBuddyLink(malformed)).toBeNull();
      expect(get(app.state).formError).toEqual({ form: 'buddy', message: 'errors.buddyLinkInvalid' });
    },
  );

  it('shows a rate-limited preview with the existing message', async () => {
    const { app } = await loaded();
    routes['POST /api/buddies/link/preview'] = tooMany;
    expect(await app.previewBuddyLink(token)).toBeNull();
    expect(get(app.state).formError).toEqual({ form: 'buddy', message: TOO_MANY_REQUESTS });
  });

  it('drops a preview that arrives after an account change', async () => {
    const { app } = await loaded();
    const request = delayed('POST /api/buddies/link/preview');
    const pending = app.previewBuddyLink(token);
    await request.requested;
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u9' });
    routes['GET /api/buddies'] = () => Response.json(emptyBuddies());
    await app.refresh();
    request.answer(Response.json({ displayName: 'Ada', relation: 'NONE' }));
    expect(await pending).toBeNull();
  });

  it.each([
    ['OUTGOING', 'notices.buddyRequested'],
    ['BUDDIES', 'notices.buddiesNow'],
  ] as const)('requests, then leaves the route for the account page and says %s', async (relation, notice) => {
    const { app } = await loaded();
    vi.stubGlobal('location', { hash: `#/buddy/${token}`, origin: 'https://glazelab.eu', pathname: '/' });
    const bodies: unknown[] = [];
    routes['POST /api/buddies/link/request'] = async (request) => {
      bodies.push(await request.json());
      return Response.json({ relation });
    };
    expect(await app.requestBuddy(token, 'Ada')).toBe(true);
    expect(bodies).toEqual([{ token }]);
    expect(replaced).toEqual(['#/account']);
    expect(get(app.state)).toMatchObject({ toast: notice, toastValues: { name: 'Ada' }, formError: null });
  });

  it.each([
    ['a 429', tooMany],
    ['a 5xx', () => new Response('x', { status: 503 })],
    ['an unreachable API', unreachable],
  ])('still reports a request that was written when the refresh after it fails with %s', async (_, failure) => {
    const { app } = await loaded();
    vi.stubGlobal('location', { hash: `#/buddy/${token}`, origin: 'https://glazelab.eu', pathname: '/' });
    routes['POST /api/buddies/link/request'] = () => {
      routes['GET /api/buddies'] = failure;
      return Response.json({ relation: 'OUTGOING' });
    };
    expect(await app.requestBuddy(token, 'Ada')).toBe(true);
    expect(replaced).toEqual(['#/account']);
    expect(get(app.state)).toMatchObject({ toast: 'notices.buddyRequested', formError: null, buddies: lists });
  });

  it('keeps the route and shows the failure when the request is refused', async () => {
    const { app } = await loaded();
    routes['POST /api/buddies/link/request'] = () => Response.json({ error: 'This buddy link is invalid or was replaced' }, { status: 404 });
    expect(await app.requestBuddy(token, 'Ada')).toBe(false);
    expect(replaced).toEqual([]);
    expect(get(app.state).formError).toEqual({ form: 'buddy', message: 'This buddy link is invalid or was replaced' });
  });

  it('does not send a second request while one is out, nor offline', async () => {
    const { app } = await loaded();
    const request = delayed('POST /api/buddies/link/request');
    const first = app.requestBuddy(token, 'Ada');
    await request.requested;
    expect(await app.requestBuddy(token, 'Ada')).toBe(false);
    request.answer(Response.json({ relation: 'OUTGOING' }));
    expect(await first).toBe(true);

    const offline = createAppController();
    for (const key of Object.keys(routes)) routes[key] = unreachable;
    await offline.refresh();
    expect(await offline.requestBuddy(token, 'Ada')).toBe(false);
  });

  it('does not leave the route when the account changed during the request', async () => {
    const { app } = await loaded();
    vi.stubGlobal('location', { hash: `#/buddy/${token}`, origin: 'https://glazelab.eu', pathname: '/' });
    const request = delayed('POST /api/buddies/link/request');
    const pending = app.requestBuddy(token, 'Ada');
    await request.requested;
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u9' });
    routes['GET /api/buddies'] = () => Response.json(emptyBuddies());
    await app.refresh();
    request.answer(Response.json({ relation: 'OUTGOING' }));
    expect(await pending).toBe(false);
    expect(replaced).toEqual([]);
    expect(get(app.state)).toMatchObject({ toast: '', formError: null });
  });
});

describe('asking a club member', () => {
  it('sends the club and the member, reloads the lists and names no one in a notice', async () => {
    routes['GET /api/buddies'] = () => Response.json(emptyBuddies());
    const { app } = await loaded();
    const bodies: unknown[] = [];
    routes['POST /api/buddies/requests'] = async (request) => {
      bodies.push(await request.json());
      routes['GET /api/buddies'] = () => Response.json({ ...emptyBuddies(), outgoing: [ada] });
      return Response.json({ relation: 'OUTGOING' });
    };
    expect(await app.requestBuddyInClub('c1', 'u2')).toBe(true);
    expect(bodies).toEqual([{ clubId: 'c1', userId: 'u2' }]);
    expect(get(app.state)).toMatchObject({ buddies: { outgoing: [ada] }, toast: '', formError: null });
  });

  it('shows a refusal at that member and reloads the clubs first', async () => {
    const { app } = await loaded();
    let reloaded = 0;
    routes['GET /api/clubs'] = () => {
      reloaded++;
      return Response.json([]);
    };
    routes['POST /api/buddies/requests'] = () => Response.json({ error: 'Member not found' }, { status: 404 });
    expect(await app.requestBuddyInClub('c1', 'u2')).toBe(false);
    expect(reloaded).toBe(1);
    expect(get(app.state).formError).toEqual({ form: buddyMemberForm('u2'), message: 'Member not found' });
  });

  it('is not sent offline', async () => {
    for (const key of Object.keys(routes)) routes[key] = unreachable;
    const { app } = await loaded();
    routes['POST /api/buddies/requests'] = () => {
      throw new Error('an offline write must not be sent');
    };
    expect(await app.requestBuddyInClub('c1', 'u2')).toBe(false);
  });
});
