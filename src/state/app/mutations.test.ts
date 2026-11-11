import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readSnapshot } from '../../lib/offline/snapshots';
import { get } from 'svelte/store';
import { imageUrl } from '../../lib/offline/offline';
import type { ImageInfo, StockItem } from '../../lib/api/models';
import { club, clubMember, combination, glazeStep, imageInfo, stockItem } from '../../test/fixtures';
import { createAppController } from './app-controller';
import { inviteKind } from '../clubs/club-invite.svelte';
import { emptyAccountData } from './app-state';
import {
  created,
  flat,
  glaze,
  healthy,
  image,
  listing,
  loaded,
  nginx,
  routes,
  stockEntry,
  stubBrowser,
  tooMany,
  unreachable,
  useMockApi,
  user,
} from './test-helpers';

useMockApi();

describe('favorite writes', () => {
  it('clears an earlier write error on retry and saves favorites without reloading the catalog', async () => {
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['PUT /api/favorites/glazes/g1'] = () => Response.json({ error: 'Request failed.' }, { status: 400 });
    const { app } = await loaded();
    expect(await app.setFavorite('glazes', 'g1', true)).toBe(false);
    expect(get(app.state).error).toBe('Request failed.');
    routes['PUT /api/favorites/glazes/g1'] = () => new Response(null, { status: 204 });
    routes['GET /api/favorites'] = () => Response.json({ glazeIds: ['g1'], combinationIds: [] });
    routes['GET /api/favorites/counts'] = () => Response.json({ glazes: [{ id: 'g1', count: 3 }], combinations: [] });
    routes['GET /api/glazes'] = () => {
      throw new Error('No catalog reload for favorites');
    };
    expect(await app.setFavorite('glazes', 'g1', true)).toBe(true);
    expect(get(app.state)).toMatchObject({
      error: '',
      favorites: { glazeIds: ['g1'], combinationIds: [] },
    });
    expect((await readSnapshot('u1'))?.favorites.glazeIds).toEqual(['g1']);
    expect(get(app.state).favoriteCounts?.glazes).toEqual([{ id: 'g1', count: 3 }]);
    expect((await readSnapshot('u1'))?.favoriteCounts?.glazes).toEqual([{ id: 'g1', count: 3 }]);
    vi.stubGlobal('navigator', { onLine: false });
    await app.refresh();
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect(await app.setFavorite('glazes', 'g1', false)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ignores a favorite result when the account changes while the write is pending', async () => {
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    let finish!: (response: Response) => void;
    routes['PUT /api/favorites/glazes/g1'] = () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      });
    const { app } = await loaded();
    const pending = app.setFavorite('glazes', 'g1', true);
    await vi.waitFor(() => expect(finish).toBeDefined());
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2' });
    await app.refresh();
    finish(new Response(null, { status: 204 }));
    expect(await pending).toBe(false);
    expect(get(app.state)).toMatchObject({ user: { id: 'u2' }, error: '', toast: '' });
    expect((await readSnapshot('u2'))?.favorites.glazeIds).toEqual([]);
  });
});

describe('favourite answers out of order (FE-11)', () => {
  it('keeps both stars when the first write answers after the second, on screen and in the snapshot', async () => {
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    const { app } = await loaded();
    const server = new Set<string>();
    routes['PUT /api/favorites/glazes/a'] = () => (server.add('a'), new Response(null, { status: 204 }));
    routes['PUT /api/favorites/glazes/b'] = () => (server.add('b'), new Response(null, { status: 204 }));
    // Every read answers what the server held when it arrived; the first one after a's write (before b's) answers late.
    const held: (() => void)[] = [];
    const read = (answer: () => Response) => () => {
      const response = answer();
      return held.length || server.size > 1 ? response : new Promise<Response>((resolve) => held.push(() => resolve(response)));
    };
    routes['GET /api/favorites'] = read(() => Response.json({ glazeIds: [...server], combinationIds: [] }));
    routes['GET /api/favorites/counts'] = read(() => Response.json({ glazes: [...server].map((id) => ({ id, count: 1 })), combinations: [] }));
    const first = app.setFavorite('glazes', 'a', true);
    await vi.waitFor(() => expect(held).toHaveLength(1));
    expect(await app.setFavorite('glazes', 'b', true)).toBe(true);
    held.forEach((answer) => answer());
    expect(await first).toBe(true);
    expect([...get(app.state).favorites.glazeIds].sort()).toEqual(['a', 'b']);
    expect([...((await readSnapshot('u1'))?.favorites.glazeIds ?? [])].sort()).toEqual(['a', 'b']);
    // The older write's totals (a only) do not replace the newer ones.
    expect(
      get(app.state)
        .favoriteCounts?.glazes.map((count) => count.id)
        .sort(),
    ).toEqual(['a', 'b']);
  });
});

describe('the star', () => {
  it('opens the sign-in dialog for a guest and sends nothing', async () => {
    routes['GET /api/auth/me'] = () => Response.json({ error: 'Unauthenticated' }, { status: 401 });
    routes['GET /api/auth/options'] = () => Response.json({ emailEnabled: false, termsVersion: 'x' });
    const { app } = await loaded();
    expect(get(app.state)).toMatchObject({ user: null, authOpen: false });
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect(await app.toggleFavorite('glazes', 'g1')).toBe(false);
    expect(await app.toggleFavorite('combinations', 'c1')).toBe(false);
    expect(get(app.state).authOpen).toBe(true);
    expect(fetch.mock.calls.every(([request]) => (request as Request).method === 'GET')).toBe(true);
    expect(get(app.state).favorites).toEqual({ glazeIds: [], combinationIds: [] });
  });

  it('switches a signed-in favourite on and off from the current state', async () => {
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    let ids: string[] = [];
    routes['PUT /api/favorites/glazes/g1'] = () => ((ids = ['g1']), new Response(null, { status: 204 }));
    routes['DELETE /api/favorites/glazes/g1'] = () => ((ids = []), new Response(null, { status: 204 }));
    routes['GET /api/favorites'] = () => Response.json({ glazeIds: ids, combinationIds: [] });
    const { app } = await loaded();
    expect(await app.toggleFavorite('glazes', 'g1')).toBe(true);
    expect(get(app.state)).toMatchObject({ authOpen: false, favorites: { glazeIds: ['g1'] } });
    expect(await app.toggleFavorite('glazes', 'g1')).toBe(true);
    expect(get(app.state).favorites.glazeIds).toEqual([]);
  });
});

describe('sharing', () => {
  const stubShare = (navigator: object, href = 'https://glazelab.eu/?q=x#/login/secret-token') => {
    vi.stubGlobal('location', { origin: 'https://glazelab.eu', pathname: '/', search: '?q=x', hash: '#/login/secret-token', href });
    vi.stubGlobal('navigator', { onLine: true, ...navigator });
  };

  it('shares the canonical page link and no notice', async () => {
    const { app } = await loaded();
    const share = vi.fn().mockResolvedValue(undefined);
    stubShare({ share });
    expect(await app.share('Blue on glazelab', { name: 'combination', id: 'c1' })).toBeNull();
    expect(share).toHaveBeenCalledWith({ title: 'Blue on glazelab', url: 'https://glazelab.eu/#/combinations/c1' });
    expect(get(app.state).toast).toBe('');
  });

  it('copies the link with a notice when there is no share sheet, also offline', async () => {
    const { app } = await loaded();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubShare({ onLine: false, clipboard: { writeText } });
    expect(await app.share('Temmoku on glazelab', { name: 'glaze', id: 'g1' })).toBeNull();
    expect(writeText).toHaveBeenCalledWith('https://glazelab.eu/#/glazes/g1');
    expect(get(app.state).toast).toBe('notices.linkCopied');
  });

  it('hands the link back for a manual copy when the clipboard refuses', async () => {
    const { app } = await loaded();
    stubShare({ clipboard: { writeText: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')) } });
    expect(await app.share('Temmoku on glazelab', { name: 'glaze', id: 'g1' })).toBe('https://glazelab.eu/#/glazes/g1');
    expect(get(app.state).toast).toBe('');
  });
});

describe('unsaved drafts', () => {
  const message = 'drafts.discardCombination' as const;

  it('keeps Studio and reports a failed save at its form', async () => {
    stubBrowser('#/studio?from=c1');
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['POST /api/combinations'] = () => Response.json({ error: 'Invalid steps' }, { status: 400 });
    const { app } = await loaded();
    expect(await app.saveCombination({ title: 'Variation', steps: [{ glazeId: 'g1', coats: 2 }] })).toBeNull();
    expect(location.hash).toBe('#/studio?from=c1');
    expect(get(app.state).formError?.form).toBe('combination');
  });

  it('sends no combination while offline, so a held save cannot slip out early', async () => {
    stubBrowser('#/studio');
    routes['POST /api/combinations'] = () => {
      throw new Error('no request while offline');
    };
    const { app } = await loaded();
    vi.stubGlobal('navigator', { onLine: false });
    await app.refresh();
    expect(get(app.state).online).toBe(false);
    expect(await app.saveCombination({ title: 'Blue', steps: [] })).toBeNull();
    expect(location.hash).toBe('#/studio');
  });

  it('edits through PUT, reloads and replaces the route with the same detail ID', async () => {
    stubBrowser('#/studio/c1');
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    let submitted: unknown;
    routes['PUT /api/combinations/c1'] = async (request) => {
      submitted = await request.json();
      return new Response(null, { status: 204 });
    };
    const { app } = await loaded();
    const input = { title: 'Edited', steps: [{ type: 'CUSTOM' as const, label: 'Firing' }] };
    expect(await app.saveCombination(input, 'c1')).not.toBeNull();
    expect(submitted).toEqual(input);
    expect(location.hash).toBe('#/combinations/c1');
    expect(get(app.state).toast).toBe('notices.combinationSaved');
  });

  it('sends the source of a variation with a new combination', async () => {
    stubBrowser('#/studio?from=c1');
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    let submitted: unknown;
    routes['POST /api/combinations'] = async (request) => {
      submitted = await request.json();
      return Response.json({ id: 'v1' });
    };
    const { app } = await loaded();
    const input = { title: 'Blue (variation)', steps: [], basedOnId: 'c1' };
    expect(await app.saveCombination(input)).not.toBeNull();
    expect(submitted).toEqual({ ...input, draft: false });
  });

  it('saves a new draft with the draft flag and opens it with the draft notice', async () => {
    stubBrowser('#/studio');
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    let submitted: unknown;
    routes['POST /api/combinations'] = async (request) => {
      submitted = await request.json();
      return Response.json({ id: 'd1' });
    };
    const { app } = await loaded();
    expect(await app.saveCombination({ title: '', steps: [] }, undefined, true)).not.toBeNull();
    expect(submitted).toEqual({ title: '', steps: [], draft: true });
    expect(location.hash).toBe('#/combinations/d1');
    expect(get(app.state).toast).toBe('notices.draftSaved');
  });

  it('answers the saved ID and stays in Studio when asked not to open it (its photos go next)', async () => {
    stubBrowser('#/studio');
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['POST /api/combinations'] = () => Response.json({ id: 'p1' });
    const { app } = await loaded();
    expect(await app.saveCombination({ title: 'With photos', steps: [{ glazeId: 'g1', coats: 1 }] }, undefined, false, { open: false })).toBe('p1');
    expect(location.hash).toBe('#/studio');
    expect(get(app.state).toast).toBe('notices.combinationSaved');
  });

  it('publishes an edited draft after saving it, and keeps a draft a draft on Save draft', async () => {
    stubBrowser('#/studio/d1');
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    const draft = {
      id: 'd1',
      title: 'Half',
      own: true,
      draft: true,
      stepsLocked: false,
      steps: [],
      images: [],
      tags: [],
    };
    routes['GET /api/sync/combinations'] = listing([draft]);
    const calls: string[] = [];
    routes['PUT /api/combinations/d1'] = () => {
      calls.push('put');
      return new Response(null, { status: 204 });
    };
    routes['POST /api/combinations/d1/publish'] = () => {
      calls.push('publish');
      return new Response(null, { status: 204 });
    };
    const { app } = await loaded();
    const input = { title: 'Done', steps: [{ type: 'CUSTOM' as const, label: 'Firing' }] };
    expect(await app.saveCombination(input, 'd1', true)).not.toBeNull();
    expect(calls).toEqual(['put']);
    expect(get(app.state).toast).toBe('notices.draftSaved');
    expect(await app.saveCombination(input, 'd1')).not.toBeNull();
    expect(calls).toEqual(['put', 'put', 'publish']);
    expect(get(app.state).toast).toBe('notices.combinationPublished');
  });

  it('publishes a draft from its page and reports a refusal at the combination form', async () => {
    stubBrowser('#/combinations/d1');
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['POST /api/combinations/d1/publish'] = () => Response.json({ error: 'Give the combination a title' }, { status: 400 });
    const { app } = await loaded();
    expect(await app.publishCombination('d1')).toBe(false);
    expect(get(app.state).formError).toEqual({
      form: 'combination',
      message: 'Give the combination a title',
    });
    let reloaded = false;
    routes['POST /api/combinations/d1/publish'] = () => new Response(null, { status: 204 });
    routes['GET /api/sync/combinations'] = () => {
      reloaded = true;
      return listing([])();
    };
    expect(await app.publishCombination('d1')).toBe(true);
    expect(reloaded).toBe(true);
    expect(get(app.state).toast).toBe('notices.combinationPublished');
  });

  it('refreshes a newly locked edit after a 409 and keeps its form error in Studio', async () => {
    stubBrowser('#/studio/c1');
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['PUT /api/combinations/c1'] = () =>
      Response.json({ error: 'Other people have added photos. Record a variation to change the steps.' }, { status: 409 });
    const { app } = await loaded();
    let reloaded = false;
    routes['GET /api/sync/combinations'] = () => {
      reloaded = true;
      return listing([])();
    };
    expect(await app.saveCombination({ title: 'Edited', steps: [{ type: 'CUSTOM', label: 'Firing' }] }, 'c1')).toBeNull();
    expect(reloaded).toBe(true);
    expect(location.hash).toBe('#/studio/c1');
    expect(get(app.state)).toMatchObject({
      error: '',
      formError: {
        form: 'combination',
        message: 'Other people have added photos. Record a variation to change the steps.',
      },
    });
  });

  it('deletes through DELETE, removes the combination/favourite from memory and snapshot, and replaces the route', async () => {
    stubBrowser('#/combinations/c1');
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['GET /api/sync/combinations'] = listing([
      {
        id: 'c1',
        title: 'Doomed',
        own: true,
        stepsLocked: false,
        steps: [],
        images: [],
        tags: [],
      },
    ]);
    routes['GET /api/favorites'] = () => Response.json({ glazeIds: [], combinationIds: ['c1'] });
    routes['DELETE /api/combinations/c1'] = () => new Response(null, { status: 204 });
    const { app } = await loaded();
    expect(await app.removeCombination('c1')).toBe(true);
    expect(get(app.state)).toMatchObject({
      combinations: [],
      favorites: { combinationIds: [] },
      toast: 'notices.combinationDeleted',
    });
    expect(location.hash).toBe('#/?type=combinations');
    expect((await readSnapshot('u1'))?.combinations).toEqual([]);
    expect((await readSnapshot('u1'))?.favorites.combinationIds).toEqual([]);
  });

  it('a deletion answered after the person went elsewhere leaves them there', async () => {
    stubBrowser('#/combinations/c1');
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    let answer: ((response: Response) => void) | undefined;
    routes['DELETE /api/combinations/c1'] = () => new Promise<Response>((resolve) => (answer = resolve));
    const { app } = await loaded();
    const pending = app.removeCombination('c1');
    await vi.waitFor(() => expect(answer).toBeDefined());
    app.navigate({ name: 'stock' }, { replace: true });
    answer!(new Response(null, { status: 204 }));
    expect(await pending).toBe(true);
    expect(get(app.state).route).toMatchObject({ name: 'stock' });
  });

  it('keeps a refused deletion and its named form error without navigating', async () => {
    stubBrowser('#/combinations/c1');
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['DELETE /api/combinations/c1'] = () =>
      Response.json({ error: 'Other people have added photos. This combination cannot be deleted.' }, { status: 409 });
    const { app } = await loaded();
    let loads = 0;
    const page = routes['GET /api/sync/combinations'];
    routes['GET /api/sync/combinations'] = (request) => (loads++, page(request));
    expect(await app.removeCombination('c1')).toBe(false);
    expect(loads).toBe(1);
    expect(location.hash).toBe('#/combinations/c1');
    expect(get(app.state)).toMatchObject({ error: '', formError: { form: 'combination' } });
  });

  it('does not navigate or show Saved after the saving account changes', async () => {
    stubBrowser('#/studio');
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    let release!: () => void;
    routes['POST /api/combinations'] = async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return Response.json({ id: 'late-combination' });
    };
    const { app } = await loaded();
    const saving = app.saveCombination({
      title: 'Original account',
      steps: [{ glazeId: 'g1', coats: 2 }],
    });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2' });
    await app.refresh();
    release();
    expect(await saving).toBeNull();
    expect(location.hash).toBe('#/studio');
    expect(get(app.state).toast).toBe('');
  });

  describe('createClub', () => {
    /** The club the API lists once it exists. */
    const listed = (...ids: string[]) => {
      routes['GET /api/clubs'] = () => Response.json(ids.map((id) => club({ id, name: `Club ${id}`, role: 'ADMIN' })));
      for (const id of ids) routes[`GET /api/clubs/${id}/members`] = () => Response.json([clubMember({ id: 'u1', role: 'ADMIN' })]);
    };

    it("opens the new club's page (a new history entry, so Back returns to the list) and answers its ID", async () => {
      const { entry, events } = stubBrowser('#/clubs');
      routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
      routes['POST /api/clubs'] = () => {
        listed('k1');
        return Response.json({ id: 'k1' });
      };
      const { app } = await loaded();
      const stop = app.start();
      try {
        expect(await app.createClub('Kiln')).toBe('k1');
        expect(location.hash).toBe('#/clubs/k1');
        expect(entry.replaceState).not.toHaveBeenCalledWith(expect.anything(), '', '#/clubs/k1');
        events.dispatchEvent(new Event('hashchange'));
        expect(get(app.state)).toMatchObject({ route: { name: 'club', id: 'k1' }, toast: 'notices.clubCreated' });
        expect(get(app.state).clubs.map((item) => item.id)).toEqual(['k1']);
      } finally {
        stop();
      }
    });

    it('stays where it is after a refusal and answers null', async () => {
      stubBrowser('#/clubs');
      routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
      routes['POST /api/clubs'] = () => Response.json({ error: 'Too many clubs' }, { status: 400 });
      const { app } = await loaded();
      expect(await app.createClub('Kiln')).toBeNull();
      expect(location.hash).toBe('#/clubs');
      expect(get(app.state)).toMatchObject({ formError: { form: 'club' }, toast: '' });
    });

    it('does not pull the writer back when they went elsewhere meanwhile, but still answers the ID', async () => {
      stubBrowser('#/clubs');
      routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
      let answer!: () => void;
      routes['POST /api/clubs'] = async () => {
        await new Promise<void>((resolve) => (answer = resolve));
        listed('k1');
        return Response.json({ id: 'k1' });
      };
      const { app } = await loaded();
      const creating = app.createClub('Kiln');
      await vi.waitFor(() => expect(answer).toBeTypeOf('function'));
      app.navigate({ name: 'stock' }, { replace: true });
      answer();
      expect(await creating).toBe('k1');
      expect(get(app.state).route).toEqual({ name: 'stock' });
      expect(location.hash).toBe('#/stock');
    });

    it('reports a failure in the banner when the writer went elsewhere meanwhile (the form is gone)', async () => {
      stubBrowser('#/clubs');
      routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
      let answer!: () => void;
      routes['POST /api/clubs'] = async () => {
        await new Promise<void>((resolve) => (answer = resolve));
        return Response.json({ error: 'Too many clubs' }, { status: 400 });
      };
      const { app } = await loaded();
      const creating = app.createClub('Kiln');
      await vi.waitFor(() => expect(answer).toBeTypeOf('function'));
      app.navigate({ name: 'stock' }, { replace: true });
      answer();
      expect(await creating).toBeNull();
      expect(get(app.state)).toMatchObject({ formError: null, error: expect.stringMatching(/\S/) });
      expect(location.hash).toBe('#/stock');
    });

    it('ignores a second create while one is pending (the page may have been left and reopened), then allows the next', async () => {
      stubBrowser('#/clubs');
      routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
      let answer!: () => void;
      let posts = 0;
      routes['POST /api/clubs'] = async () => {
        posts += 1;
        await new Promise<void>((resolve) => (answer = resolve));
        listed('k1');
        return Response.json({ id: 'k1' });
      };
      const { app } = await loaded();
      const first = app.createClub('Kiln');
      await vi.waitFor(() => expect(answer).toBeTypeOf('function'));
      app.navigate({ name: 'stock' }, { replace: true });
      app.navigate({ name: 'clubs' }, { replace: true });
      expect(await app.createClub('Kiln')).toBeNull();
      expect(await app.createClub('Other')).toBeNull();
      expect(posts).toBe(1);
      answer();
      expect(await first).toBe('k1');
      expect(posts).toBe(1);
      routes['POST /api/clubs'] = () => {
        posts += 1;
        return Response.json({ id: 'k2' });
      };
      expect(await app.createClub('Other')).toBe('k2');
      expect(posts).toBe(2);
    });

    it('does not open a page for another account', async () => {
      stubBrowser('#/clubs');
      routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
      let answer!: () => void;
      routes['POST /api/clubs'] = async () => {
        await new Promise<void>((resolve) => (answer = resolve));
        return Response.json({ id: 'k1' });
      };
      const { app } = await loaded();
      const creating = app.createClub('Kiln');
      await vi.waitFor(() => expect(answer).toBeTypeOf('function'));
      routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2' });
      await app.refresh();
      answer();
      expect(await creating).toBeNull();
      expect(location.hash).toBe('#/clubs');
    });
  });

  /** A save whose answer the test holds back; `answer()` lets the API reply. */
  function slowSave(id: string) {
    let answer!: () => void;
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['POST /api/combinations'] = async () => {
      await new Promise<void>((resolve) => {
        answer = resolve;
      });
      return Response.json({ id });
    };
    return { answer: () => answer(), pending: () => typeof answer === 'function' };
  }

  it('keeps the page and names the result when the save lands after the writer left Studio', async () => {
    stubBrowser('#/studio');
    const api = slowSave('late');
    const { app } = await loaded();
    const saving = app.saveCombination({ title: 'Slow', steps: [{ glazeId: 'g1', coats: 2 }] });
    await vi.waitFor(() => expect(api.pending()).toBe(true));
    app.navigate({ name: 'discover' }, { replace: true });
    expect(get(app.state).route).toEqual({ name: 'discover' });
    vi.mocked(history.replaceState).mockClear();
    api.answer();
    expect(await saving).not.toBeNull();
    expect(get(app.state).route).toEqual({ name: 'discover' });
    expect(history.replaceState).not.toHaveBeenCalled();
    expect(location.hash).not.toContain('late');
    expect(get(app.state).toast).toBe('notices.combinationSavedAway');
  });

  it('also keeps a new visit of Studio: the save belongs to the page that started it', async () => {
    stubBrowser('#/studio');
    const api = slowSave('late');
    const { app } = await loaded();
    const saving = app.saveCombination({ title: 'Slow', steps: [{ glazeId: 'g1', coats: 2 }] });
    await vi.waitFor(() => expect(api.pending()).toBe(true));
    app.navigate({ name: 'discover' }, { replace: true });
    app.navigate({ name: 'studio' }, { replace: true });
    api.answer();
    expect(await saving).not.toBeNull();
    expect(get(app.state).route).toEqual({ name: 'studio' });
    expect(get(app.state).toast).toBe('notices.combinationSavedAway');
  });

  it('still opens the combination when the writer stayed on Studio meanwhile', async () => {
    stubBrowser('#/studio');
    const api = slowSave('late');
    const { app } = await loaded();
    const saving = app.saveCombination({ title: 'Slow', steps: [{ glazeId: 'g1', coats: 2 }] });
    await vi.waitFor(() => expect(api.pending()).toBe(true));
    // A filter-like change of the same page keeps the visit.
    app.navigate({ name: 'studio' }, { replace: true });
    api.answer();
    expect(await saving).not.toBeNull();
    expect(get(app.state).route).toEqual({ name: 'combination', id: 'late' });
    expect(get(app.state).toast).toBe('notices.combinationSaved');
  });

  it('reports a save that fails after the writer left Studio in the banner, since no Studio form shows it', async () => {
    stubBrowser('#/studio');
    let answer!: () => void;
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['POST /api/combinations'] = async () => {
      await new Promise<void>((resolve) => (answer = resolve));
      return Response.json({ error: 'Add at least one step' }, { status: 400 });
    };
    const { app } = await loaded();
    const saving = app.saveCombination({ title: 'Slow', steps: [] });
    await vi.waitFor(() => expect(answer).toBeTypeOf('function'));
    app.navigate({ name: 'discover' }, { replace: true });
    answer();
    expect(await saving).toBeNull();
    expect(get(app.state).route).toEqual({ name: 'discover' });
    expect(get(app.state).formError).toBeNull();
    expect(get(app.state).error).toBe('Add at least one step');
  });

  it.each(['save', 'sign-out'] as const)('leaves without a discard prompt after a successful %s', async (action) => {
    const { events } = stubBrowser('#/studio');
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['POST /api/combinations'] = () => Response.json({ id: 'new-combination' });
    routes['POST /api/auth/logout'] = () => {
      routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
      return new Response(null, { status: 200 });
    };
    const { app } = await loaded();
    const stop = app.start();
    try {
      await app.refresh();
      app.registerLeaveGuard({ dirty: () => true, message });
      if (action === 'save') {
        expect(await app.saveCombination({ title: 'Saved', steps: [{ glazeId: 'g1', coats: 2 }] })).not.toBeNull();
      } else await app.logout();
      expect(location.hash).toBe(action === 'save' ? '#/combinations/new-combination' : '#/');
      events.dispatchEvent(new Event('hashchange'));
      expect(get(app.state)).toMatchObject({
        route: action === 'save' ? { name: 'combination', id: 'new-combination' } : { name: 'discover' },
        leaving: null,
      });
      if (action === 'save') {
        expect(history.replaceState).toHaveBeenCalledWith(null, '', '#/combinations/new-combination');
        expect(get(app.state).toast).toBe('notices.combinationSaved');
      }
    } finally {
      stop();
    }
  });
});

describe('reloads after writes', () => {
  it('keeps the shown listings while a write reloads them', async () => {
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['POST /api/stock'] = () => Response.json({});
    const { app } = await loaded();
    let release = () => {};
    const listed = routes['GET /api/glazes'];
    routes['GET /api/glazes'] = async (request) => {
      await new Promise<void>((resolve) => (release = resolve));
      return listed(request);
    };
    const saving = app.saveStock({ glazeId: 'g1', quantityG: 5, ownerType: 'personal' });
    await vi.waitFor(() => expect(flat(get(app.state)).syncing).toBe(true));
    // Refreshing, not loading: the listing stays on screen until the new one arrives.
    expect(flat(get(app.state)).loading).toBe(false);
    expect(get(app.state).glazes.map((item) => item.id)).toEqual(['g1']);
    release();
    expect(await saving).toBe(true);
    expect(flat(get(app.state))).toMatchObject({ loading: false, syncing: false, toast: 'notices.stockUpdated' });
  });

  it('patches tag and barcode edits into the listing without reloading', async () => {
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['PATCH /api/glazes/g1/tags'] = () => Response.json({ tags: ['glossy'] });
    routes['PATCH /api/glazes/g1/barcodes'] = () => Response.json({ barcodes: ['96385074'] });
    const { app } = await loaded();
    const listed = routes['GET /api/glazes'];
    let reloads = 0;
    routes['GET /api/glazes'] = (request) => {
      reloads++;
      return listed(request);
    };
    expect(await app.editTags({ type: 'glaze', id: 'g1' }, { add: ['glossy'] })).toBe(true);
    expect(await app.editBarcodes('g1', { add: ['96385074'] })).toBe(true);
    expect(get(app.state).glazes[0]).toMatchObject({ tags: ['glossy'], barcodes: ['96385074'] });
    expect(reloads).toBe(0);
  });
});

describe('the invite link after club loads', () => {
  const members = [clubMember({ id: 'u1', role: 'ADMIN' }), clubMember({ id: 'u2', displayName: 'Bo', role: 'ADMIN' })];
  /** What the panel shows of the remembered link against the club as the state has it now. */
  const kind = (app: ReturnType<typeof createAppController>) => inviteKind(app.inviteLink('c1'), get(app.state).clubs[0]);
  let invites: { hasInviteLink: boolean; invitesEnabled: boolean; inviteVersion: string | null };
  let generations = 0;
  beforeEach(() => vi.stubGlobal('location', { hash: '#/clubs', origin: 'https://glazelab.eu', pathname: '/' }));

  /** Another admin replaces the link: the server's club has a new version, this session's token is not it. */
  const replacedElsewhere = () => (invites = { hasInviteLink: true, invitesEnabled: true, inviteVersion: `elsewhere${++generations}` });

  async function generated() {
    generations = 0;
    invites = { hasInviteLink: false, invitesEnabled: false, inviteVersion: null };
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['GET /api/clubs'] = () => Response.json([club({ role: 'ADMIN', ...invites })]);
    routes['GET /api/clubs/c1/members'] = () => Response.json(members);
    routes['POST /api/clubs/c1/invite'] = () => {
      // Generating turns invite links on and names the new link (backend `ClubService.regenerate`).
      const version = `own${++generations}`;
      invites = { hasInviteLink: true, invitesEnabled: true, inviteVersion: version };
      return Response.json({ token: 'tok', version });
    };
    routes['PUT /api/clubs/c1'] = async (request) => {
      invites = { ...invites, invitesEnabled: (await request.json()).invitesEnabled };
      return Response.json({});
    };
    routes['PUT /api/clubs/c1/members/u2'] = () => Response.json({});
    routes['DELETE /api/clubs/c1/members/u2'] = () => new Response(null, { status: 204 });
    const { app } = await loaded();
    expect(await app.regenerateInvite('c1')).toBe('https://glazelab.eu/#/invite/tok');
    expect(kind(app)).toBe('shown');
    return app;
  }
  const settings = (invitesEnabled: boolean) => ({ name: 'Kiln', houseRules: '', invitesEnabled });

  it.each([
    ['updateClub', (app: ReturnType<typeof createAppController>) => app.updateClub('c1', settings(true))],
    ['changeClubRole', (app: ReturnType<typeof createAppController>) => app.changeClubRole('c1', 'u2', 'MEMBER')],
    ['removeClubMember', (app: ReturnType<typeof createAppController>) => app.removeClubMember('c1', 'u2')],
    ['refresh', (app: ReturnType<typeof createAppController>) => app.refresh().then(() => true)],
  ])('%s keeps the link shown, whichever load follows', async (_, run) => {
    const app = await generated();
    // The panel re-renders on every state change, so no intermediate state may call the link replaced.
    const seen: string[] = [];
    const stop = app.state.subscribe(() => seen.push(kind(app)));
    expect(await run(app)).toBe(true);
    stop();
    expect(kind(app)).toBe('shown');
    expect(seen).not.toContain('replaced');
  });

  it('replacing the link shows the new one without calling it replaced during the reload', async () => {
    const app = await generated();
    const seen: string[] = [];
    const stop = app.state.subscribe(() => seen.push(kind(app)));
    expect(await app.regenerateInvite('c1')).toBe('https://glazelab.eu/#/invite/tok');
    stop();
    expect(kind(app)).toBe('shown');
    expect(seen).not.toContain('replaced');
  });

  it('knows a link another admin replaced as soon as any load reports it, also after an own save', async () => {
    const app = await generated();
    replacedElsewhere();
    // The first load after it is an own write: the link must not stay shown.
    expect(await app.updateClub('c1', settings(true))).toBe(true);
    expect(kind(app)).toBe('replaced');
    await app.refresh();
    expect(kind(app)).toBe('replaced');
  });

  it('a load that read the club before the generation cannot lose the link', async () => {
    const app = await generated();
    const after = { ...invites };
    invites = { hasInviteLink: false, invitesEnabled: false, inviteVersion: null };
    await app.refresh();
    expect(kind(app)).toBe('none');
    invites = after;
    await app.refresh();
    expect(kind(app)).toBe('shown');
  });

  it('hides the link while the admin turned invites off and shows it again when they turn them on', async () => {
    const app = await generated();
    expect(await app.updateClub('c1', settings(false))).toBe(true);
    expect(kind(app)).toBe('off');
    expect(await app.updateClub('c1', settings(true))).toBe(true);
    expect(kind(app)).toBe('shown');
  });
});

describe('tag edits', () => {
  it('keeps the edited tags in the listing and the offline snapshot', async () => {
    let sent: unknown;
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['PATCH /api/glazes/g1/tags'] = async (request) => {
      sent = await request.json();
      return Response.json({ tags: ['cone-6', 'satin-matte'] });
    };
    const { app } = await loaded();
    expect(await app.editTags({ type: 'glaze', id: 'g1' }, { add: ['Satin Matte'] })).toBe(true);
    expect(sent).toEqual({ add: ['Satin Matte'] });
    expect(get(app.state).glazes[0].tags).toEqual(['cone-6', 'satin-matte']);
    expect((await readSnapshot('u1'))?.glazes[0].tags).toEqual(['cone-6', 'satin-matte']);
  });

  it('keeps the tags when the server rejects the edit, and never edits offline', async () => {
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['PATCH /api/glazes/g1/tags'] = () => Response.json({ error: 'An item can have at most 20 tags' }, { status: 400 });
    const { app } = await loaded();
    expect(await app.editTags({ type: 'glaze', id: 'g1' }, { add: ['one-more'] })).toBe(false);
    expect(get(app.state).error).toBe('An item can have at most 20 tags');
    expect(get(app.state).glazes[0].tags).toEqual([]);
    routes['PATCH /api/glazes/g1/tags'] = () => {
      throw new Error('no request while offline');
    };
    vi.stubGlobal('navigator', { onLine: false });
    await app.refresh();
    expect(get(app.state).online).toBe(false);
    expect(await app.editTags({ type: 'glaze', id: 'g1' }, { remove: ['cone-6'] })).toBe(false);
  });
});

describe('barcodes', () => {
  const added = { ...glaze, id: 'g2', name: 'Red', code: '1', barcodes: ['96385074'] };

  it('asks the API online, reloading the listings for a glaze added elsewhere', async () => {
    const { app } = await loaded();
    const asked: string[] = [];
    routes['GET /api/barcodes/96385074'] = (request) => {
      asked.push(new URL(request.url).pathname);
      return Response.json(added);
    };
    routes['GET /api/glazes'] = () => Response.json([glaze, added]);
    expect((await app.findBarcode('96385074'))?.id).toBe('g2');
    expect(asked).toEqual(['/api/barcodes/96385074']);
    expect(get(app.state).glazes.map((item) => item.id)).toEqual(['g1', 'g2']);
  });

  it('reports an unknown barcode as null, even when a stale listing still has it', async () => {
    const { app } = await loaded();
    routes['GET /api/barcodes/4006381333931'] = () => Response.json({ error: 'Unknown barcode' }, { status: 404 });
    expect(await app.findBarcode('4006381333931')).toBeNull();
    expect(get(app.state).error).toBe('');
  });

  it('uses the loaded listing offline or when the API cannot answer', async () => {
    const { app } = await loaded();
    routes['GET /api/barcodes/4006381333931'] = nginx(502);
    expect((await app.findBarcode('4006381333931'))?.id).toBe('g1');
    routes['GET /api/barcodes/4006381333931'] = () => {
      throw new Error('no request while offline');
    };
    vi.stubGlobal('navigator', { onLine: false });
    await app.refresh();
    expect(get(app.state).online).toBe(false);
    expect((await app.findBarcode('4006381333931'))?.id).toBe('g1');
    expect(await app.findBarcode('96385074')).toBeNull();
  });

  it('keeps edited barcodes in the listing and snapshot, and never edits offline', async () => {
    let sent: unknown;
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['PATCH /api/glazes/g1/barcodes'] = async (request) => {
      sent = await request.json();
      return Response.json({ barcodes: ['0036000291452', '4006381333931'] });
    };
    const { app } = await loaded();
    expect(await app.editBarcodes('g1', { add: ['0036000291452'] })).toBe(true);
    expect(sent).toEqual({ add: ['0036000291452'] });
    expect(get(app.state).glazes[0].barcodes).toEqual(['0036000291452', '4006381333931']);
    expect((await readSnapshot('u1'))?.glazes[0].barcodes).toEqual(['0036000291452', '4006381333931']);
    routes['PATCH /api/glazes/g1/barcodes'] = () => Response.json({ error: 'This barcode already belongs to another glaze.' }, { status: 409 });
    expect(await app.editBarcodes('g1', { add: ['96385074'] })).toBe(false);
    expect(get(app.state).error).toBe('This barcode already belongs to another glaze.');
    expect(get(app.state).glazes[0].barcodes).toEqual(['0036000291452', '4006381333931']);
    routes['PATCH /api/glazes/g1/barcodes'] = () => {
      throw new Error('no request while offline');
    };
    vi.stubGlobal('navigator', { onLine: false });
    await app.refresh();
    expect(await app.editBarcodes('g1', { remove: ['4006381333931'] })).toBe(false);
  });
});

describe('glaze removal', () => {
  const admin = { ...user, siteAdmin: true };
  const other = { ...glaze, id: 'g2', name: 'Red', code: '1' };
  const stockRow = stockItem({ quantityG: 500 });

  function signedInAdmin() {
    vi.stubGlobal('window', Object.assign(new EventTarget(), { scrollTo: vi.fn() }));
    vi.stubGlobal('location', { hash: '#/glazes/g1' });
    vi.stubGlobal('history', {
      replaceState: vi.fn((_state, _unused, href) => {
        location.hash = href;
      }),
    });
    vi.stubGlobal('navigator', { onLine: true });
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['GET /api/auth/me'] = () => Response.json(admin);
    routes['GET /api/glazes'] = () => Response.json([glaze, other]);
    routes['GET /api/stock'] = () => Response.json([stockRow]);
    routes['GET /api/favorites'] = () => Response.json({ glazeIds: ['g1', 'g2'], combinationIds: [] });
  }

  it('drops the glaze from the listings and the snapshot, then leaves its page', async () => {
    signedInAdmin();
    let csrf: string | null = null;
    routes['DELETE /api/glazes/g1'] = (request) => {
      csrf = request.headers.get('X-XSRF-TOKEN');
      return new Response(null, { status: 204 });
    };
    const { app } = await loaded();
    expect(await app.removeGlaze('g1')).toBe(true);
    expect(csrf).toBe('csrf');
    const state = get(app.state);
    expect(state.glazes.map((g) => g.id)).toEqual(['g2']);
    expect(state.stock).toEqual([]);
    expect(state.favorites.glazeIds).toEqual(['g2']);
    expect(state.route).toEqual({ name: 'discover', type: 'glazes' });
    expect(history.replaceState).toHaveBeenCalled();
    expect(state.toast).toBe('notices.glazeRemoved');
    const snapshot = await readSnapshot('u1');
    expect(snapshot?.glazes.map((g) => g.id)).toEqual(['g2']);
    expect(snapshot?.stock).toEqual([]);
    expect(snapshot?.favorites.glazeIds).toEqual(['g2']);
  });

  it('leaves a person who went elsewhere meanwhile where they are', async () => {
    signedInAdmin();
    let answer: ((response: Response) => void) | undefined;
    routes['DELETE /api/glazes/g1'] = () => new Promise<Response>((resolve) => (answer = resolve));
    const { app } = await loaded();
    const pending = app.removeGlaze('g1');
    await vi.waitFor(() => expect(answer).toBeDefined());
    app.navigate({ name: 'stock' }, { replace: true });
    await vi.waitFor(() => expect(get(app.state).route).toMatchObject({ name: 'stock' }));
    answer!(new Response(null, { status: 204 }));
    expect(await pending).toBe(true);
    expect(get(app.state).route).toMatchObject({ name: 'stock' });
    expect(get(app.state).glazes.map((g) => g.id)).toEqual(['g2']);
  });

  it('keeps the glaze and reloads when combinations use it', async () => {
    signedInAdmin();
    routes['DELETE /api/glazes/g1'] = () =>
      Response.json(
        {
          error: 'This glaze is used in combinations. Remove it from them first.',
          combinations: [{ id: 'c1', title: 'Layered' }],
        },
        { status: 409 },
      );
    const { app } = await loaded();
    let loads = 0;
    const listing = routes['GET /api/glazes'];
    routes['GET /api/glazes'] = (request) => {
      loads++;
      return listing(request);
    };
    expect(await app.removeGlaze('g1')).toBe(false);
    const state = get(app.state);
    expect(loads).toBe(1);
    expect(state.error).toBe('');
    expect(state.formError).toEqual({ form: 'glaze-remove', message: 'This glaze is used in combinations. Remove it from them first.' });
    expect(state.glazes.map((g) => g.id)).toEqual(['g1', 'g2']);
    expect(state.route).not.toEqual({ name: 'discover', type: 'glazes' });
  });

  it('never sends the request for non-admins or offline', async () => {
    routes['DELETE /api/glazes/g1'] = () => {
      throw new Error('no request');
    };
    const { app } = await loaded();
    expect(await app.removeGlaze('g1')).toBe(false);
    signedInAdmin();
    vi.stubGlobal('navigator', { onLine: false });
    routes['GET /api/auth/me'] = unreachable;
    await app.refresh();
    expect(get(app.state).online).toBe(false);
    expect(await app.removeGlaze('g1')).toBe(false);
    expect(get(app.state).glazes.map((g) => g.id)).toContain('g1');
  });
});

describe('glaze corrections', () => {
  const corrected = { ...glaze, name: 'Navy', lastEditedAt: '2026-10-30T09:00:00Z', lastEditedBy: 'Ana' };

  function withCsrf() {
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
  }

  it('sends only the change, puts the answered glaze and its new name in the listings and snapshot', async () => {
    withCsrf();
    let sent: unknown;
    routes['GET /api/sync/combinations'] = listing([combination({ steps: [glazeStep({ glazeId: 'g1', name: 'Blue' })] })]);
    routes['GET /api/stock'] = () => Response.json([stockItem({ glazeId: 'g1', name: 'Blue' })]);
    routes['PATCH /api/glazes/g1'] = async (request) => {
      sent = await request.json();
      return Response.json(corrected);
    };
    const { app } = await loaded();
    expect(await app.correctGlaze('g1', { name: 'Navy' })).toBe(true);
    expect(sent).toEqual({ name: 'Navy' });
    const state = get(app.state);
    expect(state.glazes[0]).toEqual(corrected);
    expect(state.combinations[0].steps[0].name).toBe('Navy');
    expect(state.stock[0].name).toBe('Navy');
    expect(state.toast).toBe('notices.glazeCorrected');
    expect((await readSnapshot('u1'))?.glazes[0].lastEditedBy).toBe('Ana');
  });

  it('shows a locked or taken code at the form and reloads the listings', async () => {
    withCsrf();
    for (const [status, error] of [
      [403, 'Combinations use this glaze, so only a site admin can change its code.'],
      [409, 'This manufacturer and glaze code already exist in the library.'],
    ] as const) {
      routes['PATCH /api/glazes/g1'] = () => Response.json({ error }, { status });
      const { app } = await loaded();
      let loads = 0;
      routes['GET /api/glazes'] = () => {
        loads++;
        return Response.json([glaze]);
      };
      expect(await app.correctGlaze('g1', { code: 'PC-21' })).toBe(false);
      const state = get(app.state);
      expect(loads).toBe(1);
      expect(state.formError).toEqual({ form: 'glaze-edit', message: error });
      expect(state.error).toBe('');
      expect(state.glazes[0].code).toBe('PC-20');
    }
  });

  it('counts a glaze removed meanwhile as done: the listings reload and the notice says so', async () => {
    withCsrf();
    routes['PATCH /api/glazes/g1'] = () => Response.json({ error: 'Unknown glaze' }, { status: 404 });
    const { app } = await loaded();
    routes['GET /api/glazes'] = () => Response.json([]);
    expect(await app.correctGlaze('g1', { name: 'Navy' })).toBe(true);
    const state = get(app.state);
    expect(state.glazes).toEqual([]);
    expect(state.toast).toBe('notices.glazeGone');
    expect(state.formError).toBeNull();
  });

  it('never sends offline', async () => {
    routes['PATCH /api/glazes/g1'] = () => {
      throw new Error('no request while offline');
    };
    const { app } = await loaded();
    vi.stubGlobal('navigator', { onLine: false });
    routes['GET /api/auth/me'] = unreachable;
    await app.refresh();
    expect(await app.correctGlaze('g1', { name: 'Navy' })).toBe(false);
    expect(get(app.state).glazes[0].name).toBe('Blue');
  });

  it('loads the history online, reports a failure at its dialog and asks nothing offline', async () => {
    const history = { edits: [{ editedAt: '2026-10-30T09:00:00Z', field: 'NAME', editor: null, oldValue: 'Bleu', newValue: 'Blue' }], more: false };
    routes['GET /api/glazes/g1/history'] = () => Response.json(history);
    const { app } = await loaded();
    expect(await app.glazeHistory('g1')).toEqual(history);
    routes['GET /api/glazes/g1/history'] = () => Response.json({ error: 'Unknown glaze' }, { status: 404 });
    expect(await app.glazeHistory('g1')).toBeNull();
    expect(get(app.state).formError).toEqual({ form: 'glaze-history', message: 'Unknown glaze' });
    routes['GET /api/glazes/g1/history'] = () => {
      throw new Error('no request while offline');
    };
    vi.stubGlobal('navigator', { onLine: false });
    routes['GET /api/auth/me'] = unreachable;
    await app.refresh();
    expect(await app.glazeHistory('g1')).toBeNull();
  });
});

describe('combination titles', () => {
  const mine = combination({ id: 'c1', title: 'Celadon ovr shino', own: true });
  const other = combination({ id: 'c2', title: 'Tenmoku' });

  function withCsrf() {
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
  }

  it('sends the title and patches the answered one into the listing and snapshot without a reload', async () => {
    withCsrf();
    let sent: unknown;
    routes['GET /api/sync/combinations'] = listing([mine, other]);
    routes['PATCH /api/combinations/c1/title'] = async (request) => {
      sent = await request.json();
      return Response.json({ title: 'Celadon over shino' });
    };
    const { app } = await loaded();
    const before = get(app.state).combinations;
    routes['GET /api/glazes'] = () => {
      throw new Error('no reload after a rename');
    };
    expect(await app.retitleCombination('c1', ' Celadon over shino ')).toBe(true);
    expect(sent).toEqual({ title: ' Celadon over shino ' });
    const state = get(app.state);
    expect(state.combinations.map((combo) => combo.title)).toEqual(['Celadon over shino', 'Tenmoku']);
    expect(state.combinations[1]).toBe(before[1]);
    expect(state.toast).toBe('notices.combinationRenamed');
    expect((await readSnapshot('u1'))?.combinations.find((combo) => combo.id === 'c1')?.title).toBe('Celadon over shino');
  });

  it('shows a refusal at its form and reloads the listings', async () => {
    withCsrf();
    routes['GET /api/sync/combinations'] = listing([other]);
    routes['PATCH /api/combinations/c2/title'] = () => Response.json({ error: 'Only the author can change this combination' }, { status: 403 });
    const { app } = await loaded();
    let loads = 0;
    routes['GET /api/glazes'] = () => {
      loads++;
      return Response.json([glaze]);
    };
    expect(await app.retitleCombination('c2', 'Mine now')).toBe(false);
    const state = get(app.state);
    expect(loads).toBe(1);
    expect(state.formError).toEqual({ form: 'combination-title', message: 'Only the author can change this combination' });
    expect(state.error).toBe('');
    expect(state.combinations[0].title).toBe('Tenmoku');
  });

  it('counts a combination removed meanwhile as done: the listings reload and the notice says so', async () => {
    withCsrf();
    routes['GET /api/sync/combinations'] = listing([mine]);
    routes['PATCH /api/combinations/c1/title'] = () => Response.json({ error: 'Combination not found' }, { status: 404 });
    const { app } = await loaded();
    routes['GET /api/sync/combinations'] = listing([]);
    expect(await app.retitleCombination('c1', 'Renamed')).toBe(true);
    const state = get(app.state);
    expect(state.combinations).toEqual([]);
    expect(state.toast).toBe('notices.combinationGone');
    expect(state.formError).toBeNull();
  });

  it('never sends offline', async () => {
    routes['GET /api/sync/combinations'] = listing([mine]);
    routes['PATCH /api/combinations/c1/title'] = () => {
      throw new Error('no request while offline');
    };
    const { app } = await loaded();
    vi.stubGlobal('navigator', { onLine: false });
    routes['GET /api/auth/me'] = unreachable;
    await app.refresh();
    expect(await app.retitleCombination('c1', 'Renamed')).toBe(false);
    expect(get(app.state).combinations[0].title).toBe('Celadon ovr shino');
  });
});

describe('stock entries', () => {
  const rows = [
    {
      id: 's1',
      glazeId: 'g1',
      userId: 'u1',
      clubId: null,
      quantityG: 500,
      jarSizeG: 500,
      manufacturer: 'Amaco',
      name: 'Blue',
      clubName: null,
    },
    {
      id: 's2',
      glazeId: 'g1',
      userId: null,
      clubId: 'k1',
      quantityG: 0,
      jarSizeG: null,
      manufacturer: 'Amaco',
      name: 'Blue',
      clubName: 'Kiln',
    },
  ];

  function signedIn() {
    vi.stubGlobal('navigator', { onLine: true });
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['GET /api/auth/me'] = () => Response.json(user);
    routes['GET /api/stock'] = () => Response.json(rows);
  }

  it('sends the jar size with a save and patches the listed entry without reloading', async () => {
    signedIn();
    let body: unknown = null;
    routes['POST /api/stock'] = async (request) => {
      body = await request.json();
      return Response.json({ id: 's2' });
    };
    const { app } = await loaded();
    let loads = 0;
    const listing = routes['GET /api/stock'];
    routes['GET /api/stock'] = (request) => {
      loads++;
      return listing(request);
    };
    const input = {
      glazeId: 'g1',
      quantityG: 1000,
      jarSizeG: 250,
      ownerType: 'club',
      clubId: 'k1',
    } as const;
    expect(await app.saveStock(input, true)).toBe(true);
    expect(body).toEqual(input);
    expect(loads).toBe(0);
    expect(get(app.state).stock.map((item) => [item.quantityG, item.jarSizeG])).toEqual([
      [500, 500],
      [1000, 250],
    ]);
    expect((await readSnapshot('u1'))?.stock.map((item) => item.quantityG)).toEqual([500, 1000]);
  });

  it("sends an addition to its own endpoint and takes the server's total, never this device's", async () => {
    signedIn();
    let body: unknown = null;
    let saves = 0;
    routes['POST /api/stock'] = () => (saves++, Response.json({ id: 's1' }));
    // Another device added a jar meanwhile: the server holds 1000 g where this device saw 500 g.
    routes['POST /api/stock/add'] = async (request) => {
      body = await request.json();
      return Response.json({ ...rows[0], quantityG: 1500, canRemove: true, keepPrivate: false });
    };
    const { app } = await loaded();
    let loads = 0;
    const listing = routes['GET /api/stock'];
    routes['GET /api/stock'] = (request) => {
      loads++;
      return listing(request);
    };
    const input = { glazeId: 'g1', addG: 500, ownerType: 'personal', clubId: null } as const;
    expect(await app.saveStock(input, true)).toBe(true);
    expect(body).toEqual({ ...input, requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(saves).toBe(0);
    expect(loads).toBe(0);
    expect(get(app.state).stock.map((item) => [item.id, item.quantityG])).toEqual([
      ['s1', 1500],
      ['s2', 0],
    ]);
    expect((await readSnapshot('u1'))?.stock.map((item) => item.quantityG)).toEqual([1500, 0]);
  });

  it('repeats the request ID of a failed addition when the same one is sent again, and only then (BE-13)', async () => {
    signedIn();
    const ids: string[] = [];
    let lost = true;
    routes['POST /api/stock/add'] = async (request) => {
      ids.push(((await request.json()) as { requestId: string }).requestId);
      // The first answer is lost on the way back: the server added the jar, the device sees a network error.
      if (lost) return ((lost = false), Promise.reject(new TypeError('Failed to fetch')));
      return Response.json({ ...rows[0], quantityG: 1000, canRemove: true, keepPrivate: false });
    };
    const { app } = await loaded();
    const input = { glazeId: 'g1', addG: 500, jarSizeG: 500, ownerType: 'personal', clubId: null } as const;
    expect(await app.saveStock(input, true)).toBe(false);
    expect(await app.saveStock(input, true)).toBe(true);
    expect(ids[1]).toBe(ids[0]);
    // After the success a new tap is a new addition; so is another addition after a failure.
    expect(await app.saveStock(input, true)).toBe(true);
    expect(ids[2]).not.toBe(ids[1]);
    lost = true;
    expect(await app.saveStock(input, true)).toBe(false);
    expect(await app.saveStock({ ...input, addG: 250 }, true)).toBe(true);
    expect(ids[4]).not.toBe(ids[3]);
    expect(new Set(ids).size).toBe(4);
  });

  it('reloads after an addition that created an entry not listed yet', async () => {
    signedIn();
    routes['POST /api/stock/add'] = () => Response.json({ ...rows[0], id: 'new', glazeId: 'g2', quantityG: 250 });
    const { app } = await loaded();
    let loads = 0;
    const listing = routes['GET /api/stock'];
    routes['GET /api/stock'] = (request) => {
      loads++;
      return listing(request);
    };
    expect(await app.saveStock({ glazeId: 'g2', addG: 250, jarSizeG: 250, ownerType: 'personal' }, false, 'notices.shelfAdded')).toBe(true);
    expect(loads).toBe(1);
  });

  it('keeps the entry jar size when a save leaves it out (used up)', async () => {
    signedIn();
    routes['POST /api/stock'] = () => Response.json({ id: 's1' });
    const { app } = await loaded();
    expect(await app.saveStock({ glazeId: 'g1', quantityG: 0, ownerType: 'personal', clubId: null }, true)).toBe(true);
    expect(get(app.state).stock[0]).toMatchObject({ quantityG: 0, jarSizeG: 500 });
  });

  it('reloads after the first save of an entry that is not listed yet', async () => {
    signedIn();
    routes['POST /api/stock'] = () => Response.json({ id: 'new' });
    const { app } = await loaded();
    let loads = 0;
    const listing = routes['GET /api/stock'];
    routes['GET /api/stock'] = (request) => {
      loads++;
      return listing(request);
    };
    expect(await app.saveStock({ glazeId: 'g1', quantityG: 5, ownerType: 'personal' })).toBe(true);
    expect(loads).toBe(1);
  });

  it('shows a failed row action in the banner and a failed form save at the form', async () => {
    signedIn();
    routes['POST /api/stock'] = () => Response.json({ error: 'Nope' }, { status: 400 });
    const { app } = await loaded();
    const input = { glazeId: 'g1', quantityG: 5, ownerType: 'personal' } as const;
    expect(await app.saveStock(input, true)).toBe(false);
    expect(get(app.state).error).not.toBe('');
    expect(get(app.state).formError).toBeNull();
    expect(await app.saveStock(input)).toBe(false);
    expect(get(app.state).formError).toMatchObject({ form: 'stock' });
  });

  it('drops a removed entry from the listing and the snapshot without reloading', async () => {
    signedIn();
    let csrf: string | null = null;
    routes['DELETE /api/stock/s1'] = (request) => {
      csrf = request.headers.get('X-XSRF-TOKEN');
      return new Response(null, { status: 204 });
    };
    const { app } = await loaded();
    let loads = 0;
    const listing = routes['GET /api/stock'];
    routes['GET /api/stock'] = (request) => {
      loads++;
      return listing(request);
    };
    expect(await app.removeStock('s1')).toBe(true);
    expect(csrf).toBe('csrf');
    expect(loads).toBe(0);
    expect(get(app.state)).toMatchObject({ toast: 'notices.stockRemoved' });
    expect(get(app.state).stock.map((item) => item.id)).toEqual(['s2']);
    expect((await readSnapshot('u1'))?.stock.map((item) => item.id)).toEqual(['s2']);
  });

  it('reloads and explains when the entry is already gone', async () => {
    signedIn();
    routes['DELETE /api/stock/s1'] = () => Response.json({ error: 'Unknown stock entry' }, { status: 404 });
    const { app } = await loaded();
    let loads = 0;
    const listing = routes['GET /api/stock'];
    routes['GET /api/stock'] = (request) => {
      loads++;
      return listing(request);
    };
    expect(await app.removeStock('s1')).toBe(false);
    expect(loads).toBe(1);
    expect(get(app.state).error).toBe('Unknown stock entry');
  });

  it('reloads a club entry the account may no longer remove, so its Remove goes', async () => {
    signedIn();
    const message = 'Only a club admin or the member who added it can remove this entry';
    routes['DELETE /api/stock/s1'] = () => Response.json({ error: message }, { status: 403 });
    const { app } = await loaded();
    const listing = routes['GET /api/stock'];
    let loads = 0;
    routes['GET /api/stock'] = async (request) => {
      loads++;
      const entries = (await (await listing(request)).json()) as StockItem[];
      return Response.json(entries.map((entry) => (entry.id === 's1' ? { ...entry, canRemove: false } : entry)));
    };
    expect(await app.removeStock('s1')).toBe(false);
    expect(loads).toBe(1);
    expect(get(app.state).stock.find((item) => item.id === 's1')?.canRemove).toBe(false);
    expect(get(app.state).error).toBe(message);
  });

  it('sends nothing for guests or offline', async () => {
    routes['DELETE /api/stock/s1'] = () => {
      throw new Error('no request');
    };
    const { app } = await loaded();
    expect(await app.removeStock('s1')).toBe(false);
    signedIn();
    vi.stubGlobal('navigator', { onLine: false });
    routes['GET /api/auth/me'] = unreachable;
    await app.refresh();
    expect(await app.removeStock('s1')).toBe(false);
  });
});

describe('picture writes', () => {
  const picture = (id: string, visibility: ImageInfo['visibility'], clubId: string | null = null) => imageInfo({ id, visibility, clubId });
  const combo = combination({
    title: 'Layered',
    createdAt: '2026-10-27T10:00:00Z',
    author: 'Ana',
    images: [picture('i2', 'PRIVATE')],
  });
  let removed: string[];

  function withPictures() {
    vi.stubGlobal('navigator', { onLine: true });
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['GET /api/glazes'] = () => Response.json([{ ...glaze, images: [picture('i1', 'PUBLIC')] }]);
    routes['GET /api/sync/combinations'] = listing([combo]);
    removed = [];
    const saved = ['/api/images/i1', '/api/images/i2', '/api/images/gone'];
    vi.stubGlobal('caches', {
      delete: async () => true,
      has: async (name: string) => name === 'glazelab-images-u1',
      open: async () => ({
        keys: async () => saved.map((path) => new Request(`http://localhost${path}`)),
        delete: async (request: Request) => {
          removed.push(new URL(request.url).pathname);
          return true;
        },
      }),
    });
  }

  it('prunes saved pictures that the fresh listings no longer show', async () => {
    withPictures();
    await loaded();
    expect(removed).toEqual(['/api/images/gone']);
  });

  it('deletes another uploader’s visible photo from listings, snapshot and cache once', async () => {
    withPictures();
    let finish!: () => void;
    const wait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let calls = 0;
    routes['DELETE /api/images/i1'] = async () => {
      calls++;
      await wait;
      return new Response(null, { status: 204 });
    };
    const { app } = await loaded();
    removed = [];
    const image = { ...get(app.state).glazes[0].images[0], own: false };
    app.openImageRemoval(image);
    expect(get(app.state).removingImage).toEqual(image);
    const pending = app.deleteImage(image);
    expect(await app.deleteImage(image)).toBe(false);
    finish();
    expect(await pending).toBe(true);
    expect(calls).toBe(1);
    expect(get(app.state).glazes[0].images).toEqual([]);
    expect(get(app.state).combinations[0].images).toHaveLength(1);
    expect(get(app.state).removingImage).toBeNull();
    expect(get(app.state).toast).toBe('notices.photoDeleted');
    expect(removed).toEqual(['/api/images/i1']);
    expect((await readSnapshot('u1'))?.glazes[0].images).toEqual([]);
  });

  it('opens the removal dialog only for a photo the viewer may delete', async () => {
    withPictures();
    const { app } = await loaded();
    const image = get(app.state).glazes[0].images[0];
    app.openImageRemoval({ ...image, canDelete: false });
    expect(get(app.state).removingImage).toBeNull();
    app.openImageRemoval({ ...image, canDelete: true });
    expect(get(app.state).removingImage).toEqual({ ...image, canDelete: true });
  });

  it('deletes a reported photo by ID and URL alone and drops it wherever it is listed', async () => {
    withPictures();
    routes['DELETE /api/images/i1'] = () => new Response(null, { status: 204 });
    const { app } = await loaded();
    removed = [];
    expect(await app.deleteImage({ id: 'i1', url: '/api/images/i1' })).toBe(true);
    expect(get(app.state).glazes[0].images).toEqual([]);
    expect(removed).toEqual(['/api/images/i1']);
    expect(get(app.state).toast).toBe('notices.photoDeleted');
  });

  it('does not save another account’s data if the account changes during image-cache cleanup', async () => {
    withPictures();
    routes['DELETE /api/images/i1'] = () => new Response(null, { status: 204 });
    const { app } = await loaded();
    const image = get(app.state).glazes[0].images[0];
    let finish!: () => void;
    let cleaning!: () => void;
    const started = new Promise<void>((resolve) => {
      cleaning = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    vi.stubGlobal('caches', {
      has: async (name: string) => name === 'glazelab-images-u1',
      delete: async () => true,
      open: async () => ({
        keys: async () => [new Request('http://localhost/api/images/i1')],
        delete: async () => {
          cleaning();
          await wait;
          return true;
        },
      }),
    });
    const pending = app.deleteImage(image);
    await started;
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2' });
    routes['GET /api/glazes'] = () => Response.json([{ ...glaze, id: 'g2' }]);
    routes['GET /api/sync/combinations'] = listing([]);
    await app.refresh();
    finish();
    await pending;
    expect(await readSnapshot('u1')).toBeNull();
    expect(get(app.state)).toMatchObject({ user: { id: 'u2' }, toast: '', error: '' });
    expect((await readSnapshot('u2'))?.glazes.map((g) => g.id)).toEqual(['g2']);
  });

  it('drops a late failure of the previous account after sign-out', async () => {
    withPictures();
    let answer!: () => void;
    const requested = new Promise<void>((resolve) => {
      routes['DELETE /api/images/i1'] = () =>
        new Promise<Response>((done) => {
          answer = () => done(Response.json({ error: 'Request failed.' }, { status: 500 }));
          resolve();
        });
    });
    const { app } = await loaded();
    const pending = app.deleteImage(get(app.state).glazes[0].images[0]);
    await requested;
    routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
    await app.refresh();
    answer();
    expect(await pending).toBe(false);
    expect(get(app.state)).toMatchObject({ user: null, error: '', toast: '' });
  });

  it('keeps the photo after deletion fails and refuses offline or signed-out deletion', async () => {
    withPictures();
    routes['DELETE /api/images/i1'] = () => Response.json({ error: 'Request failed.' }, { status: 500 });
    const { app } = await loaded();
    const image = get(app.state).glazes[0].images[0];
    expect(await app.deleteImage(image)).toBe(false);
    expect(get(app.state).glazes[0].images).toEqual([image]);
    // The confirm dialog shows its own failure; the app-wide error stays for loads.
    expect(get(app.state)).toMatchObject({ error: '', formError: { form: 'image-remove', message: 'Request failed.' } });
    vi.stubGlobal('navigator', { onLine: false });
    await app.refresh();
    expect(await app.deleteImage(image)).toBe(false);
    routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
    vi.stubGlobal('navigator', { onLine: true });
    await app.refresh();
    expect(await app.deleteImage(image)).toBe(false);
  });

  it('closes a stale-photo dialog on 404, clears cached copies and shows one notice', async () => {
    withPictures();
    routes['DELETE /api/images/i1'] = () => Response.json({ error: 'Image not found' }, { status: 404 });
    const { app } = await loaded();
    const image = get(app.state).glazes[0].images[0];
    app.openImageRemoval(image);
    routes['GET /api/glazes'] = () => Response.json([{ ...glaze, images: [] }]);
    removed = [];
    expect(await app.deleteImage(image)).toBe(true);
    expect(get(app.state)).toMatchObject({
      removingImage: null,
      error: '',
      toast: 'notices.photoAlreadyDeleted',
    });
    expect(get(app.state).glazes[0].images).toEqual([]);
    expect((await readSnapshot('u1'))?.glazes[0].images).toEqual([]);
    expect(removed).toContain('/api/images/i1');
  });

  it('ignores a stale-photo 404 arriving after an account switch', async () => {
    withPictures();
    let answer!: (response: Response) => void;
    routes['DELETE /api/images/i1'] = () =>
      new Promise<Response>((resolve) => {
        answer = resolve;
      });
    const { app } = await loaded();
    const pending = app.deleteImage(get(app.state).glazes[0].images[0]);
    await vi.waitFor(() => expect(answer).toBeDefined());
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2' });
    await app.refresh();
    const newer = get(app.state).glazes[0].images[0];
    app.openImageRemoval(newer);
    answer(Response.json({ error: 'Image not found' }, { status: 404 }));
    expect(await pending).toBe(false);
    expect(get(app.state)).toMatchObject({ removingImage: newer, error: '', toast: '' });
  });

  it('patches changed photo details into its listing and snapshot without dropping cached bytes', async () => {
    withPictures();
    let sent: unknown;
    routes['PATCH /api/images/i1'] = async (request) => {
      sent = await request.json();
      return Response.json({ ...picture('i1', 'PUBLIC'), kind: 'PACKAGING', caption: 'Front label', firedOn: '2026-10-14' });
    };
    const { app } = await loaded();
    removed = [];
    const photo = get(app.state).glazes[0].images[0];
    expect(await app.changeImageDetails(photo, { kind: 'PACKAGING', caption: 'Front label', firedOn: '2026-10-14' })).toBe(true);
    expect(sent).toEqual({ kind: 'PACKAGING', caption: 'Front label', firedOn: '2026-10-14' });
    expect(get(app.state).glazes[0].images[0]).toMatchObject({
      id: photo.id,
      url: photo.url,
      kind: 'PACKAGING',
      caption: 'Front label',
      firedOn: '2026-10-14',
    });
    const saved = (await readSnapshot('u1'))?.glazes[0].images[0];
    expect(saved).toMatchObject({ kind: 'PACKAGING', caption: 'Front label', firedOn: '2026-10-14' });
    expect(removed).toEqual([]);
    expect(get(app.state).toast).toBe('notices.photoDetailsChanged');
  });

  it('sends explicit nulls to clear a caption and a date', async () => {
    withPictures();
    let sent = '';
    routes['PATCH /api/images/i1'] = async (request) => {
      sent = await request.text();
      return Response.json(picture('i1', 'PUBLIC'));
    };
    const { app } = await loaded();
    expect(await app.changeImageDetails(get(app.state).glazes[0].images[0], { caption: null, firedOn: null })).toBe(true);
    expect(JSON.parse(sent)).toEqual({ caption: null, firedOn: null });
  });

  it('keeps a details failure at its form and ignores a response from the previous account', async () => {
    withPictures();
    routes['PATCH /api/images/i1'] = () => Response.json({ error: 'A caption can have at most 200 characters' }, { status: 400 });
    const { app } = await loaded();
    const photo = get(app.state).glazes[0].images[0];
    expect(await app.changeImageDetails(photo, { caption: 'x' })).toBe(false);
    expect(get(app.state)).toMatchObject({
      error: '',
      formError: { form: 'image-details', message: 'A caption can have at most 200 characters' },
    });
    expect(get(app.state).glazes[0].images[0].caption).toBeNull();
    let answer!: (response: Response) => void;
    routes['PATCH /api/images/i1'] = () =>
      new Promise<Response>((resolve) => {
        answer = resolve;
      });
    const pending = app.changeImageDetails(photo, { kind: 'PACKAGING' });
    await vi.waitFor(() => expect(answer).toBeDefined());
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2' });
    await app.refresh();
    answer(Response.json({ ...photo, kind: 'PACKAGING' }));
    expect(await pending).toBe(false);
    expect(get(app.state).glazes[0].images[0].kind).toBe('TEST_TILE');
    expect(await app.changeImageDetails({ ...photo, own: false }, { kind: 'PACKAGING' })).toBe(false);
  });

  it('changes a photo type for whoever may delete it: the listing, its snapshot and the notice follow at once', async () => {
    withPictures();
    let sent: unknown;
    routes['PUT /api/images/i2/kind'] = async (request) => {
      sent = await request.json();
      return Response.json({ ...picture('i2', 'PRIVATE'), kind: 'IN_PROGRESS', own: false });
    };
    const { app } = await loaded();
    removed = [];
    const photo = { ...get(app.state).combinations[0].images[0], own: false, canDelete: true };
    expect(await app.changeImageKind(photo, 'IN_PROGRESS')).toBe(true);
    expect(sent).toEqual({ kind: 'IN_PROGRESS' });
    expect(get(app.state).combinations[0].images[0]).toMatchObject({ id: 'i2', url: photo.url, kind: 'IN_PROGRESS' });
    expect((await readSnapshot('u1'))?.combinations[0].images[0]).toMatchObject({ kind: 'IN_PROGRESS' });
    expect(removed).toEqual([]);
    expect(get(app.state).toast).toBe('notices.photoKindChanged');
  });

  it('sets a photo focus for whoever may delete it: the listing, its snapshot and the notice follow; null resets it', async () => {
    withPictures();
    const sent: unknown[] = [];
    routes['PUT /api/images/i2/focus'] = async (request) => {
      const body = (await request.json()) as { focusX: number | null; focusY: number | null };
      sent.push(body);
      return Response.json({ ...picture('i2', 'PRIVATE'), ...body, own: false });
    };
    const { app } = await loaded();
    removed = [];
    const photo = { ...get(app.state).combinations[0].images[0], own: false, canDelete: true };
    expect(await app.changeImageFocus(photo, { x: 20, y: 75 })).toBe(true);
    expect(get(app.state).combinations[0].images[0]).toMatchObject({ id: 'i2', url: photo.url, focusX: 20, focusY: 75 });
    expect((await readSnapshot('u1'))?.combinations[0].images[0]).toMatchObject({ focusX: 20, focusY: 75 });
    expect(removed).toEqual([]);
    expect(get(app.state).toast).toBe('notices.photoFocusChanged');
    expect(await app.changeImageFocus(photo, null)).toBe(true);
    expect(sent).toEqual([
      { focusX: 20, focusY: 75 },
      { focusX: null, focusY: null },
    ]);
    expect(get(app.state).combinations[0].images[0]).toMatchObject({ focusX: null, focusY: null });
  });

  it('keeps a focus failure at its form, asks nothing without the right and nothing offline', async () => {
    withPictures();
    const asked = vi.fn();
    routes['PUT /api/images/i1/focus'] = () => (asked(), Response.json({ error: 'A focus point needs both coordinates, each from 0 to 100' }, { status: 400 }));
    const { app } = await loaded();
    const photo = get(app.state).glazes[0].images[0];
    expect(await app.changeImageFocus(photo, { x: 1, y: 2 })).toBe(false);
    expect(get(app.state)).toMatchObject({
      error: '',
      formError: { form: 'image-focus', message: 'A focus point needs both coordinates, each from 0 to 100' },
    });
    expect(asked).toHaveBeenCalledTimes(1);
    expect(await app.changeImageFocus({ ...photo, canDelete: false }, { x: 1, y: 2 })).toBe(false);
    vi.stubGlobal('navigator', { onLine: false });
    await app.refresh();
    expect(await app.changeImageFocus(photo, { x: 1, y: 2 })).toBe(false);
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it('keeps a type failure at its form, asks nothing without the right and nothing offline', async () => {
    withPictures();
    const asked = vi.fn();
    routes['PUT /api/images/i1/kind'] = () => (asked(), Response.json({ error: 'Work-in-progress photos can only belong to combinations' }, { status: 400 }));
    const { app } = await loaded();
    const photo = get(app.state).glazes[0].images[0];
    expect(await app.changeImageKind(photo, 'IN_PROGRESS')).toBe(false);
    expect(get(app.state)).toMatchObject({
      error: '',
      formError: { form: 'image-kind', message: 'Work-in-progress photos can only belong to combinations' },
    });
    expect(get(app.state).glazes[0].images[0].kind).toBe('TEST_TILE');
    expect(asked).toHaveBeenCalledTimes(1);
    expect(await app.changeImageKind({ ...photo, canDelete: false }, 'FINISHED')).toBe(false);
    vi.stubGlobal('navigator', { onLine: false });
    await app.refresh();
    expect(await app.changeImageKind(photo, 'FINISHED')).toBe(false);
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it('writes nothing offline', async () => {
    withPictures();
    const patched = vi.fn();
    routes['PATCH /api/images/i1'] = () => (patched(), Response.json(picture('i1', 'PUBLIC')));
    const { app } = await loaded();
    const photo = get(app.state).glazes[0].images[0];
    vi.stubGlobal('navigator', { onLine: false });
    await app.refresh();
    expect(get(app.state).online).toBe(false);
    expect(await app.changeImageDetails(photo, { caption: 'x' })).toBe(false);
    expect(patched).not.toHaveBeenCalled();
  });

  it('says so and reloads once when the photo whose details change is already gone', async () => {
    withPictures();
    routes['PATCH /api/images/i1'] = () => Response.json({ error: 'Image not found' }, { status: 404 });
    const { app } = await loaded();
    const photo = { ...get(app.state).glazes[0].images[0], own: true };
    let loads = 0;
    routes['GET /api/glazes'] = () => {
      loads++;
      return Response.json([{ ...glaze, images: [] }]);
    };
    // The dialog belongs to the vanished photo and closes with it: a form error would never show.
    expect(await app.changeImageDetails(photo, { caption: 'x' })).toBe(true);
    expect(loads).toBe(1);
    expect(get(app.state).glazes[0].images).toEqual([]);
    expect(get(app.state)).toMatchObject({
      error: '',
      formError: null,
      toast: 'notices.photoAlreadyDeleted',
    });
  });

  it('sends the caption and firing date of an upload as trimmed query fields and leaves blank ones out', async () => {
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    const urls: string[] = [];
    routes['POST /api/glazes/g1/images'] = (request) => {
      urls.push(request.url);
      return Response.json({ ...image, id: `i${urls.length + 1}`, caption: 'Top shelf', firedOn: '2026-10-14' });
    };
    const { app } = await loaded();
    const file = new File(['photo'], 'photo.png', { type: 'image/png' });
    const input = { target: { type: 'glaze' as const, id: 'g1' }, file, visibility: 'PUBLIC' as const, kind: 'TEST_TILE' as const, clubId: '' };
    expect(await app.uploadImage({ ...input, caption: '  Top shelf ', firedOn: '2026-10-14' })).toEqual({ ok: true });
    expect(await app.uploadImage({ ...input, caption: '   ', firedOn: '' })).toEqual({ ok: true });
    const first = new URL(urls[0]).searchParams;
    expect([first.get('caption'), first.get('firedOn')]).toEqual(['Top shelf', '2026-10-14']);
    const second = new URL(urls[1]).searchParams;
    expect([second.has('caption'), second.has('firedOn')]).toEqual([false, false]);
  });

  it('reports another person’s photo with an optional reason and thanks the reporter', async () => {
    withPictures();
    const sent: unknown[] = [];
    routes['POST /api/images/i1/reports'] = async (request) => {
      sent.push(await request.json());
      return new Response(null, { status: 204 });
    };
    const { app } = await loaded();
    const photo = get(app.state).glazes[0].images[0];
    expect(await app.reportImage(photo, 'Not a glaze')).toBe(true);
    expect(get(app.state)).toMatchObject({ toast: 'notices.photoReported', error: '' });
    expect(get(app.state).formError).toBeNull();
    // A repeated report is a success too, and a blank reason goes as null.
    expect(await app.reportImage(photo, null)).toBe(true);
    expect(sent).toEqual([{ reason: 'Not a glaze' }, { reason: null }]);
    expect(get(app.state).glazes[0].images).toEqual([photo]);
  });

  it('shows the refusal of an own-photo report at the report form', async () => {
    withPictures();
    routes['POST /api/images/i1/reports'] = () => Response.json({ error: 'You cannot report your own photo; delete it instead' }, { status: 400 });
    const { app } = await loaded();
    expect(await app.reportImage(get(app.state).glazes[0].images[0], null)).toBe(false);
    expect(get(app.state)).toMatchObject({
      error: '',
      toast: '',
      formError: {
        form: 'image-report',
        message: 'You cannot report your own photo; delete it instead',
      },
    });
  });

  it('says so and reloads once when the reported photo is already gone, sending one report at a time', async () => {
    withPictures();
    let answer!: (response: Response) => void;
    routes['POST /api/images/i1/reports'] = () =>
      new Promise<Response>((resolve) => {
        answer = resolve;
      });
    const { app } = await loaded();
    const photo = get(app.state).glazes[0].images[0];
    const pending = app.reportImage(photo, null);
    await vi.waitFor(() => expect(answer).toBeDefined());
    expect(await app.reportImage(photo, null)).toBe(false);
    let loads = 0;
    routes['GET /api/glazes'] = () => {
      loads++;
      return Response.json([{ ...glaze, images: [] }]);
    };
    answer(Response.json({ error: 'Image not found' }, { status: 404 }));
    expect(await pending).toBe(true);
    expect(loads).toBe(1);
    expect(get(app.state).glazes[0].images).toEqual([]);
    expect(get(app.state)).toMatchObject({
      error: '',
      formError: null,
      toast: 'notices.photoAlreadyDeleted',
    });
  });

  it('keeps other report failures at the report form', async () => {
    withPictures();
    const { app } = await loaded();
    const photo = get(app.state).glazes[0].images[0];
    routes['POST /api/images/i1/reports'] = () => Response.json({ error: 'Something broke' }, { status: 500 });
    let loads = 0;
    const listing = routes['GET /api/glazes'];
    routes['GET /api/glazes'] = (request) => {
      loads++;
      return listing(request);
    };
    expect(await app.reportImage(photo, null)).toBe(false);
    expect(loads).toBe(0);
    expect(get(app.state)).toMatchObject({
      error: '',
      toast: '',
      formError: { form: 'image-report' },
    });
    expect(get(app.state).glazes[0].images).toEqual([photo]);
  });

  it('keeps the session when a report is refused for outdated terms', async () => {
    withPictures();
    routes['POST /api/images/i1/reports'] = () => Response.json({ error: 'Terms not accepted' }, { status: 428 });
    const { app } = await loaded();
    expect(await app.reportImage(get(app.state).glazes[0].images[0], null)).toBe(false);
    expect(get(app.state)).toMatchObject({
      user,
      termsRequired: true,
      toast: '',
      formError: { form: 'image-report' },
    });
  });

  it('ignores a gone-photo report answered after an account switch', async () => {
    withPictures();
    let answer!: (response: Response) => void;
    routes['POST /api/images/i1/reports'] = () =>
      new Promise<Response>((resolve) => {
        answer = resolve;
      });
    const { app } = await loaded();
    const pending = app.reportImage(get(app.state).glazes[0].images[0], null);
    await vi.waitFor(() => expect(answer).toBeDefined());
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2' });
    await app.refresh();
    answer(Response.json({ error: 'Image not found' }, { status: 404 }));
    expect(await pending).toBe(false);
    expect(get(app.state)).toMatchObject({ toast: '', error: '', formError: null });
  });

  it.each([
    ['report', 'POST /api/images/i1/reports'],
    ['visibility', 'PUT /api/images/i1/visibility'],
    ['delete', 'DELETE /api/images/i1'],
  ] as const)('answers false without a notice when the gone-photo reload finds another account (%s)', async (action, key) => {
    withPictures();
    const { app } = await loaded();
    const photo = { ...get(app.state).glazes[0].images[0], own: true };
    routes[key] = () => {
      // Signed in elsewhere meanwhile: the reload after the 404 brings another account.
      routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2' });
      return Response.json({ error: 'Image not found' }, { status: 404 });
    };
    const run = {
      report: () => app.reportImage(photo, null),
      visibility: () => app.changeImageVisibility(photo, { visibility: 'PRIVATE' }),
      delete: () => app.deleteImage(photo),
    }[action];
    expect(await run()).toBe(false);
    expect(get(app.state)).toMatchObject({ user: { id: 'u2' }, toast: '', error: '' });
  });

  it('sends no report for guests or offline', async () => {
    withPictures();
    routes['POST /api/images/i1/reports'] = () => {
      throw new Error('no request');
    };
    const { app } = await loaded();
    const photo = get(app.state).glazes[0].images[0];
    vi.stubGlobal('navigator', { onLine: false });
    await app.refresh();
    expect(await app.reportImage(photo, null)).toBe(false);
    routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
    vi.stubGlobal('navigator', { onLine: true });
    await app.refresh();
    expect(await app.reportImage(photo, null)).toBe(false);
    expect(get(app.state)).toMatchObject({ error: '', toast: '', formError: null });
  });

  it('takes a picture moved to a new ID into the listing, the snapshot and the cache', async () => {
    withPictures();
    let sent: unknown;
    routes['PUT /api/images/i1/visibility'] = async (request) => {
      sent = await request.json();
      return Response.json(picture('i9', 'CLUB', 'k1'));
    };
    const { app } = await loaded();
    removed = [];
    const image = get(app.state).glazes[0].images[0];
    expect(await app.changeImageVisibility(image, { visibility: 'CLUB', clubId: 'k1' })).toBe(true);
    expect(sent).toEqual({ visibility: 'CLUB', clubId: 'k1' });
    const state = get(app.state);
    expect(state.glazes[0].images).toEqual([picture('i9', 'CLUB', 'k1')]);
    expect(state.combinations[0].images).toEqual([picture('i2', 'PRIVATE')]);
    expect(state.toast).toBe('notices.photoVisibilityChanged');
    expect(removed).toEqual(['/api/images/i1']);
    expect((await readSnapshot('u1'))?.glazes[0].images.map((i) => i.id)).toEqual(['i9']);
  });

  it('reuses downloaded pictures until a move, a load without them or sign-out', async () => {
    withPictures();
    vi.stubGlobal('location', { hash: '#/' });
    const downloads: string[] = [];
    for (const id of ['i1', 'i2', 'i9'])
      routes[`GET /api/images/${id}`] = () => {
        downloads.push(id);
        return new Response(new Blob(['jpeg'], { type: 'image/jpeg' }));
      };
    const show = async (id: string) => {
      const url = await imageUrl(`/api/images/${id}`, 'u1');
      expect(url).toMatch(/^blob:/);
      URL.revokeObjectURL(url!);
    };
    const { app } = await loaded();
    await Promise.all([show('i1'), show('i1'), show('i2')]);
    await show('i1');
    expect(downloads).toEqual(['i1', 'i2']);

    // Leaving PUBLIC moves i1 to i9: the old URL is not reused.
    routes['PUT /api/images/i1/visibility'] = () => Response.json(picture('i9', 'CLUB', 'k1'));
    const image = get(app.state).glazes[0].images[0];
    expect(await app.changeImageVisibility(image, { visibility: 'CLUB', clubId: 'k1' })).toBe(true);
    await show('i1');
    await show('i9');
    expect(downloads).toEqual(['i1', 'i2', 'i1', 'i9']);

    // No longer shared: the next load drops i2, so it is asked for again (and answered 404).
    routes['GET /api/glazes'] = () => Response.json([{ ...glaze, images: [picture('i9', 'CLUB', 'k1')] }]);
    routes['GET /api/sync/combinations'] = listing([]);
    routes['GET /api/images/i2'] = () => {
      downloads.push('i2');
      return Response.json({ error: 'Image not found' }, { status: 404 });
    };
    await app.refresh();
    expect(await imageUrl('/api/images/i2', 'u1')).toBeNull();
    await show('i9');
    expect(downloads).toEqual(['i1', 'i2', 'i1', 'i9', 'i2']);

    routes['POST /api/auth/logout'] = () => {
      routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
      return new Response(null, { status: 200 });
    };
    await app.logout();
    expect(get(app.state).user).toBeNull();
    await show('i9');
    expect(downloads).toEqual(['i1', 'i2', 'i1', 'i9', 'i2', 'i9']);
  });

  it('keeps the picture on failure, says so after a 404, and never asks for others or offline', async () => {
    withPictures();
    routes['PUT /api/images/i2/visibility'] = () => Response.json({ error: 'Image not found' }, { status: 404 });
    const { app } = await loaded();
    let loads = 0;
    const page = routes['GET /api/sync/combinations'];
    routes['GET /api/sync/combinations'] = (request) => {
      loads++;
      return page(request);
    };
    const image = get(app.state).combinations[0].images[0];
    // Already gone: the listings reload once and the notice says so; no form error lingers.
    expect(await app.changeImageVisibility(image, { visibility: 'PUBLIC' })).toBe(true);
    expect(loads).toBe(1);
    expect(get(app.state)).toMatchObject({
      error: '',
      formError: null,
      toast: 'notices.photoAlreadyDeleted',
    });

    // Any other failure stays at the form and does not reload.
    routes['PUT /api/images/i2/visibility'] = () => Response.json({ error: 'Something broke' }, { status: 500 });
    expect(await app.changeImageVisibility(image, { visibility: 'PUBLIC' })).toBe(false);
    expect(loads).toBe(1);
    expect(get(app.state)).toMatchObject({
      error: '',
      formError: { form: 'image-visibility', message: 'Something broke' },
    });
    expect(get(app.state).combinations[0].images).toEqual([image]);

    routes['PUT /api/images/i2/visibility'] = () => {
      throw new Error('no request');
    };
    expect(await app.changeImageVisibility({ ...image, own: false }, { visibility: 'PUBLIC' })).toBe(false);
    vi.stubGlobal('navigator', { onLine: false });
    await app.refresh();
    expect(get(app.state).online).toBe(false);
    let sent = false;
    routes['PUT /api/images/i2/visibility'] = () => ((sent = true), Response.json(image));
    app.dismissError();
    expect(await app.changeImageVisibility(image, { visibility: 'PUBLIC' })).toBe(false);
    expect(sent).toBe(false);
    expect(get(app.state).error).toBe('');
  });
});

describe('late mutation results', () => {
  function delayed(key: string, response: () => Response | Promise<Response>) {
    let answer!: () => void;
    const requested = new Promise<void>((resolve) => {
      routes[key] = () =>
        new Promise<Response>((done) => {
          answer = () => done(response());
          resolve();
        });
    });
    return { requested, answer: () => answer() };
  }
  const glazeInput = { manufacturerId: 'm1', name: 'Green', code: 'PC-21' } as never;

  function studioBrowser() {
    vi.stubGlobal('window', { scrollTo: vi.fn() });
    vi.stubGlobal('location', { hash: '#/studio' });
    vi.stubGlobal('history', { replaceState: vi.fn() });
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
  }

  it.each(['upload', 'combination'] as const)('keeps the new account’s dialog and route after a late %s succeeds', async (kind) => {
    studioBrowser();
    const request = delayed(kind === 'upload' ? 'POST /api/glazes/g1/images' : 'POST /api/combinations', () => Response.json({ id: 'saved' }));
    const { app } = await loaded();
    const pending =
      kind === 'upload'
        ? app.uploadImage({
            target: { type: 'glaze', id: 'g1' },
            file: new File(['photo'], 'photo.png', { type: 'image/png' }),
            visibility: 'PUBLIC',
            kind: 'TEST_TILE',
            clubId: '',
          })
        : app.saveCombination({ title: 'Earlier test', steps: [{ glazeId: 'g1', coats: 1 }] });
    await request.requested;
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2' });
    await app.refresh();
    app.navigate({ name: 'studio' }, { replace: true });
    const target = { type: 'glaze' as const, id: 'g2', title: 'New account photo' };
    app.openUpload(target);
    const fetch = vi.spyOn(globalThis, 'fetch');
    request.answer();
    expect(await pending).toEqual(kind === 'upload' ? { ok: false, message: 'upload.notSent', stop: true } : null);
    expect(fetch).not.toHaveBeenCalled();
    expect(get(app.state)).toMatchObject({
      user: { id: 'u2' },
      route: { name: 'studio' },
      uploadFor: target,
      error: '',
      toast: '',
    });
  });

  it('keeps the studio route when the account changes during a saved combination’s reload', async () => {
    studioBrowser();
    const { app } = await loaded();
    app.navigate({ name: 'studio' }, { replace: true });
    routes['POST /api/combinations'] = () => Response.json({ id: 'saved' });
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2' });
    expect(await app.saveCombination({ title: 'Earlier test', steps: [{ glazeId: 'g1', coats: 1 }] })).toBeNull();
    expect(get(app.state)).toMatchObject({
      user: { id: 'u2' },
      route: { name: 'studio' },
      toast: '',
    });
  });

  it.each([
    ['an account change', () => Response.json({ ...user, id: 'u2' })],
    ['a sign-out', () => new Response(null, { status: 401 })],
  ])('drops the completion notice after %s', async (_case, me) => {
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    const request = delayed('POST /api/glazes', () => created(new Request('http://x')));
    const { app } = await loaded();
    const pending = app.addGlaze(glazeInput);
    await request.requested;
    routes['GET /api/auth/me'] = me;
    await app.refresh();
    request.answer();
    await pending;
    expect(get(app.state).toast).toBe('');
  });

  it('drops a late error but still notes lost connectivity', async () => {
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    const request = delayed('POST /api/stock', () => Promise.reject(new TypeError('fetch failed')));
    const { app } = await loaded();
    const pending = app.saveStock({ glazeId: 'g1', quantity: 1 } as never);
    await request.requested;
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2' });
    await app.refresh();
    request.answer();
    expect(await pending).toBe(false);
    expect(get(app.state)).toMatchObject({ user: { id: 'u2' }, error: '', online: false });
  });

  it('keeps form errors at their form until the next submit, page change or account change', async () => {
    vi.stubGlobal('window', Object.assign(new EventTarget(), { scrollTo: vi.fn() }));
    vi.stubGlobal('location', { hash: '#/stock' });
    vi.stubGlobal('history', { replaceState: vi.fn() });
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['POST /api/stock'] = () => Response.json({ error: 'Choose a club' }, { status: 400 });
    const { app } = await loaded();
    expect(await app.saveStock({ glazeId: 'g1', quantityG: 5, ownerType: 'club' })).toBe(false);
    expect(get(app.state)).toMatchObject({
      error: '',
      formError: { form: 'stock', message: 'Choose a club' },
    });
    // Another form's submit clears it; a failure of a write without a form still uses the banner.
    routes['POST /api/clubs'] = () => Response.json({ id: 'c1' });
    expect(await app.createClub('Kiln')).toBe('c1');
    expect(get(app.state).formError).toBeNull();
    expect(await app.saveStock({ glazeId: 'g1', quantityG: 5, ownerType: 'club' })).toBe(false);
    app.navigate({ name: 'stock', barcode: '96385074' }, { replace: true });
    expect(get(app.state).formError).toBeNull();
    expect(await app.saveStock({ glazeId: 'g1', quantityG: 5, ownerType: 'club' })).toBe(false);
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2' });
    await app.refresh();
    expect(get(app.state).formError).toBeNull();
  });

  it('patches a new glaze and its shelf entry into the listings without reloading them', async () => {
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    const { app } = await loaded();
    const fresh = { ...glaze, id: 'g9', name: 'Aqua', code: 'PC-9' };
    const entry = { ...stockEntry, id: 's9', glazeId: 'g9', name: 'Aqua', quantityG: 450 };
    routes['POST /api/glazes'] = () => Response.json({ id: 'g9', glaze: fresh, stock: [entry] });
    const reloads = vi.fn();
    for (const path of ['glazes', 'combinations', 'stock', 'clubs', 'favorites'])
      routes[`GET /api/${path}`] = (request) => (reloads(path), healthy[`GET /api/${path}`](request));
    const before = get(app.state).glazes[0];
    const added = await app.addGlaze({
      manufacturerId: 'm1',
      name: 'Aqua',
      code: 'PC-9',
      stock: { quantityG: 450 },
    });
    expect(added?.id).toBe('g9');
    expect(reloads).not.toHaveBeenCalled();
    const state = get(app.state);
    // Sorted like the API (manufacturer, then name): Aqua before Blue; the old object is untouched.
    expect(state.glazes.map((item) => item.id)).toEqual(['g9', 'g1']);
    expect(state.glazes[1]).toBe(before);
    expect(state.stock).toEqual([entry]);
    expect(state.toast).toBe('notices.glazeAddedToShelf');
    // The offline snapshot follows.
    expect((await readSnapshot('u1'))?.stock).toEqual([entry]);
  });

  describe('upload dialog', () => {
    const upload = (id = 'g1') => ({
      target: { type: 'glaze' as const, id },
      file: new File(['photo'], 'photo.png', { type: 'image/png' }),
      visibility: 'PUBLIC' as const,
      kind: 'TEST_TILE' as const,
      clubId: '',
    });
    const glazeTarget = { type: 'glaze' as const, id: 'g1', title: 'Amaco PC-20 Blue' };

    it('patches each uploaded picture into its item without reloading and keeps the dialog open', async () => {
      routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
      const { app } = await loaded();
      const pictures = [
        { ...image, id: 'i2', url: '/api/images/i2', cardUrl: '/api/images/i2/card' },
        { ...image, id: 'i3', url: '/api/images/i3', cardUrl: '/api/images/i3/card' },
      ];
      let sent = 0;
      routes['POST /api/glazes/g1/images'] = () => Response.json(pictures[sent++]);
      const reloads = vi.fn();
      for (const path of ['glazes', 'combinations', 'stock', 'clubs', 'favorites']) {
        const handler = routes[`GET /api/${path}`];
        routes[`GET /api/${path}`] = (request) => (reloads(), handler(request));
      }
      app.openUpload(glazeTarget);
      const before = get(app.state).glazes[0];
      expect(await app.uploadImage(upload())).toEqual({ ok: true });
      expect(await app.uploadImage(upload())).toEqual({ ok: true });
      expect(reloads).not.toHaveBeenCalled();
      const state = get(app.state);
      expect(state.uploadFor).toEqual(glazeTarget);
      expect(state.toast).toBe('');
      expect(state.glazes[0].images).toEqual([pictures[1], pictures[0]]);
      expect(state.glazes[0]).not.toBe(before);
      expect((await readSnapshot('u1'))?.glazes[0].images).toEqual([pictures[1], pictures[0]]);
    });

    it('answers a failed file with its message at the file, not in the banner or form, and goes on with the next', async () => {
      routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
      const { app } = await loaded();
      const answers = [() => Response.json({ error: 'Unsupported image' }, { status: 400 }), () => Response.json({ ...image, id: 'i2' })];
      routes['POST /api/glazes/g1/images'] = () => answers.shift()!();
      expect(await app.uploadImage(upload())).toEqual({ ok: false, message: 'Unsupported image', stop: false });
      expect(get(app.state)).toMatchObject({ error: '', formError: null });
      expect(await app.uploadImage(upload())).toEqual({ ok: true });
      expect(get(app.state).glazes[0].images).toEqual([{ ...image, id: 'i2' }]);
    });

    it('answers the HEIC message when the API cannot decode a HEIC-looking file, and its own message for any other', async () => {
      routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
      const { app } = await loaded();
      routes['POST /api/glazes/g1/images'] = () => Response.json({ error: 'Unsupported image' }, { status: 400 });
      const heic = new File(['x'], 'IMG_0001.HEIC', { type: '' });
      expect(await app.uploadImage({ ...upload(), file: heic })).toEqual({ ok: false, message: 'upload.reason.heic', stop: false });
      expect(await app.uploadImage(upload())).toEqual({ ok: false, message: 'Unsupported image', stop: false });
    });

    it('asks for the terms on a 428 and tells the queue to stop', async () => {
      routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
      routes['POST /api/glazes/g1/images'] = () => Response.json({ error: 'Terms not accepted' }, { status: 428 });
      const { app } = await loaded();
      expect(await app.uploadImage(upload())).toMatchObject({ ok: false, stop: true });
      expect(get(app.state)).toMatchObject({ termsRequired: true, user: { id: 'u1' }, error: '', formError: null });
    });

    it.each([
      ['unreachable', unreachable],
      ['rate limited', tooMany],
      ['signed out (401)', () => Response.json({ error: 'Sign in required' }, { status: 401 })],
    ])('tells the queue to stop when the server is %s', async (_name, handler) => {
      routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
      routes['POST /api/glazes/g1/images'] = handler;
      const { app } = await loaded();
      expect(await app.uploadImage(upload())).toMatchObject({ ok: false, stop: true });
      expect(get(app.state).error).toBe('');
    });

    it('refuses quietly while offline and sends nothing', async () => {
      const { app } = await loaded();
      vi.stubGlobal('navigator', { onLine: false });
      await app.refresh();
      const fetch = vi.spyOn(globalThis, 'fetch');
      expect(await app.uploadImage(upload())).toEqual({ ok: false, message: 'upload.notSent', stop: true });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('closes with one notice naming the photos that went in, and none when nothing did', async () => {
      const { app } = await loaded();
      app.openUpload(glazeTarget);
      app.closeUpload(0);
      expect(get(app.state)).toMatchObject({ uploadFor: null, toast: '' });
      app.openUpload(glazeTarget);
      app.closeUpload(3);
      expect(get(app.state)).toMatchObject({ uploadFor: null, toast: 'notices.photosAdded', toastValues: { count: 3 } });
    });

    it("asks the opener's own focus return after the dialog closed, and nothing once another dialog opened without one", async () => {
      const { app } = await loaded();
      const returned = vi.fn(() => true);
      expect(app.returnUploadFocus()).toBe(false);
      app.openUpload(glazeTarget, returned);
      app.closeUpload(1);
      expect(app.returnUploadFocus()).toBe(true);
      expect(returned).toHaveBeenCalledTimes(1);
      app.openUpload(glazeTarget);
      app.closeUpload(0);
      expect(app.returnUploadFocus()).toBe(false);
      expect(returned).toHaveBeenCalledTimes(1);
    });

    it('remembers the last visibility for the session and forgets it on sign-out and an account change', async () => {
      stubBrowser('#/');
      routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
      const { app } = await loaded();
      expect(get(app.state).uploadVisibility).toBe('PUBLIC');
      app.rememberUploadVisibility('PRIVATE');
      app.openUpload(glazeTarget);
      app.closeUpload();
      expect(get(app.state).uploadVisibility).toBe('PRIVATE');
      routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2' });
      await app.refresh();
      expect(get(app.state)).toMatchObject({ user: { id: 'u2' }, uploadVisibility: 'PUBLIC' });
      app.rememberUploadVisibility('CLUB');
      routes['POST /api/auth/logout'] = () => {
        routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
        return new Response(null, { status: 200 });
      };
      await app.logout();
      expect(get(app.state)).toMatchObject({ user: null, uploadVisibility: 'PUBLIC' });
    });
  });

  it('clears the form error when a dialog opens or closes', async () => {
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['POST /api/glazes'] = () => Response.json({ error: 'Request failed.' }, { status: 400 });
    const { app } = await loaded();
    expect(await app.addGlaze(glazeInput)).toBeNull();
    expect(get(app.state).formError).not.toBeNull();
    app.clearFormError();
    expect(get(app.state).formError).toBeNull();
  });

  it('still shows the notice and error of the same account', async () => {
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['POST /api/glazes'] = created;
    const { app } = await loaded();
    expect((await app.addGlaze(glazeInput))?.id).toBe('g1');
    expect(get(app.state).toast).toBe('notices.glazeAdded');
    routes['POST /api/glazes'] = () => Response.json({ error: 'Request failed.' }, { status: 400 });
    expect(await app.addGlaze(glazeInput)).toBeNull();
    // A failed form submit shows at the form, not in the banner.
    expect(get(app.state)).toMatchObject({
      error: '',
      formError: { form: 'glaze', message: 'Request failed.' },
    });
  });
});

describe('meaningful saves for installation', () => {
  it('reports a successful form save, but never loading or a failed save', async () => {
    const onSaved = vi.fn();
    const app = createAppController({ onSaved });
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['POST /api/stock'] = () => Response.json({});
    await app.refresh();
    expect(onSaved).not.toHaveBeenCalled();
    expect(await app.saveStock({ glazeId: 'g1', quantityG: 5, ownerType: 'personal' })).toBe(true);
    expect(onSaved).toHaveBeenCalledTimes(1);
    routes['POST /api/stock'] = tooMany;
    expect(await app.saveStock({ glazeId: 'g1', quantityG: 5, ownerType: 'personal' })).toBe(false);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('reports starring, but never unstarring or a refused favourite', async () => {
    const onSaved = vi.fn();
    const app = createAppController({ onSaved });
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    routes['PUT /api/favorites/glazes/g1'] = () => new Response(null, { status: 204 });
    routes['DELETE /api/favorites/glazes/g1'] = () => new Response(null, { status: 204 });
    await app.refresh();
    expect(await app.setFavorite('glazes', 'g1', false)).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();
    expect(await app.setFavorite('glazes', 'g1', true)).toBe(true);
    expect(onSaved).toHaveBeenCalledTimes(1);
    routes['PUT /api/favorites/glazes/g1'] = tooMany;
    expect(await app.setFavorite('glazes', 'g1', true)).toBe(false);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('does not invite the next account after a previous account saves', async () => {
    const onSaved = vi.fn();
    const app = createAppController({ onSaved });
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
    let finish!: () => void;
    routes['POST /api/stock'] = () =>
      new Promise<Response>((resolve) => {
        finish = () => resolve(Response.json({}));
      });
    await app.refresh();
    const pending = app.saveStock({ glazeId: 'g1', quantityG: 5, ownerType: 'personal' });
    await vi.waitFor(() => expect(finish).toBeDefined());
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2' });
    await app.refresh();
    finish();
    await pending;
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe('write lifecycle', () => {
  function signedIn() {
    vi.stubGlobal('navigator', { onLine: true });
    routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
  }
  /** Counts the requests a route answers and passes them on. */
  function counted(key: string) {
    const count = { loads: 0 };
    const answer = routes[key];
    routes[key] = (request) => (count.loads++, answer(request));
    return count;
  }
  /** A route that answers only when `answer()` is called. */
  function held(key: string, response: () => Response) {
    let answer = () => {};
    const requested = new Promise<void>((resolve) => {
      routes[key] = () =>
        new Promise<Response>((done) => {
          answer = () => done(response());
          resolve();
        });
    });
    return { requested, answer: () => answer() };
  }
  const switchAccount = async (app: ReturnType<typeof createAppController>) => {
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2' });
    await app.refresh();
  };

  describe('reloadOn', () => {
    it('reloads the listings only after a listed status', async () => {
      signedIn();
      routes['GET /api/stock'] = () => Response.json([stockEntry]);
      const { app } = await loaded();
      const stock = counted('GET /api/stock');
      routes['DELETE /api/stock/s1'] = () => Response.json({ error: 'Gone' }, { status: 404 });
      expect(await app.removeStock('s1')).toBe(false);
      expect(stock.loads).toBe(1);
      expect(get(app.state).error).toBe('Gone');
      routes['DELETE /api/stock/s1'] = () => Response.json({ error: 'Busy' }, { status: 500 });
      expect(await app.removeStock('s1')).toBe(false);
      expect(stock.loads).toBe(1);
      expect(get(app.state).error).toBe('Busy');
    });

    it('reloads after a 409 only when an existing combination was saved', async () => {
      signedIn();
      const { app } = await loaded();
      const combinations = counted('GET /api/sync/combinations');
      const conflict = () => Response.json({ error: 'Changed meanwhile' }, { status: 409 });
      const input = { title: 'Test', steps: [{ glazeId: 'g1', coats: 1 }] };
      routes['POST /api/combinations'] = conflict;
      expect(await app.saveCombination(input)).toBeNull();
      expect(combinations.loads).toBe(0);
      expect(get(app.state).formError).toMatchObject({ form: 'combination' });
      routes['PUT /api/combinations/c1'] = conflict;
      expect(await app.saveCombination(input, 'c1')).toBeNull();
      expect(combinations.loads).toBe(1);
    });
  });

  describe('in-flight key', () => {
    const twin = { ...image, id: 'i2', url: '/api/images/i2', cardUrl: '/api/images/i2/card' };
    const pictures = () => {
      signedIn();
      routes['GET /api/glazes'] = () => Response.json([{ ...glaze, images: [image, twin] }]);
    };

    it('refuses a second delete of the same picture but not of another one', async () => {
      pictures();
      const firstWrite = held('DELETE /api/images/i1', () => new Response(null, { status: 204 }));
      const secondWrite = held('DELETE /api/images/i2', () => new Response(null, { status: 204 }));
      const { app } = await loaded();
      const [first, second] = get(app.state).glazes[0].images;
      const one = app.deleteImage(first);
      const two = app.deleteImage(second);
      expect(await app.deleteImage(first)).toBe(false);
      await Promise.all([firstWrite.requested, secondWrite.requested]);
      firstWrite.answer();
      secondWrite.answer();
      expect(await Promise.all([one, two])).toEqual([true, true]);
      expect(get(app.state).glazes[0].images).toEqual([]);
    });

    it('frees the key after a failure so the picture can be deleted again', async () => {
      pictures();
      routes['DELETE /api/images/i1'] = () => Response.json({ error: 'Busy' }, { status: 500 });
      const { app } = await loaded();
      const [first] = get(app.state).glazes[0].images;
      expect(await app.deleteImage(first)).toBe(false);
      routes['DELETE /api/images/i1'] = () => new Response(null, { status: 204 });
      expect(await app.deleteImage(first)).toBe(true);
      expect(get(app.state).toast).toBe('notices.photoDeleted');
    });
  });

  describe('sign-out', () => {
    const club = { id: 'c1', name: 'Kiln', role: 'ADMIN' };
    const owned = () => {
      signedIn();
      vi.stubGlobal('location', { hash: '#/' });
      routes['GET /api/stock'] = () => Response.json([stockEntry]);
      routes['GET /api/clubs'] = () => Response.json([club]);
      routes[`GET /api/clubs/${club.id}/members`] = () => Response.json([{ id: 'u1', displayName: 'Ana', role: 'MEMBER' }]);
      routes['GET /api/favorites'] = () => Response.json({ glazeIds: ['g1'], combinationIds: ['c9'] });
    };

    it('empties every private listing before the guest data arrives', async () => {
      owned();
      const { app } = await loaded();
      expect(get(app.state)).toMatchObject({ stock: [stockEntry], clubs: [club], clubMembers: { [club.id]: [{ displayName: 'Ana' }] } });
      routes['POST /api/auth/logout'] = () => new Response(null, { status: 204 });
      routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
      const guest = held('GET /api/glazes', () => Response.json([glaze]));
      const signingOut = app.logout();
      await guest.requested;
      expect(flat(get(app.state))).toMatchObject({ ...emptyAccountData(), user: null, loading: true });
      guest.answer();
      await signingOut;
      expect(get(app.state)).toMatchObject({ user: null, stock: [], clubs: [], clubMembers: {}, glazes: [glaze] });
    });

    it('empties every private listing when the session check says signed out', async () => {
      owned();
      const { app } = await loaded();
      routes['GET /api/auth/me'] = () => new Response(null, { status: 401 });
      routes['GET /api/glazes'] = () => Response.json([]);
      await app.refresh();
      expect(get(app.state)).toMatchObject({ ...emptyAccountData(), user: null });
    });

    it('empties them when another account signs in', async () => {
      owned();
      const { app } = await loaded();
      const next = held('GET /api/stock', () => Response.json([]));
      routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u2' });
      const refreshing = app.refresh();
      await next.requested;
      expect(get(app.state)).toMatchObject({ user: { id: 'u2' }, stock: [], clubs: [] });
      expect(get(app.state).favorites).toEqual({ glazeIds: [], combinationIds: [] });
      next.answer();
      await refreshing;
    });
  });

  describe('account changed meanwhile', () => {
    it('applies nothing, notifies nothing and answers false', async () => {
      signedIn();
      routes['GET /api/stock'] = () => Response.json([stockEntry]);
      const { app } = await loaded();
      const removal = held('DELETE /api/stock/s1', () => new Response(null, { status: 204 }));
      const pending = app.removeStock('s1');
      await removal.requested;
      routes['GET /api/stock'] = () => Response.json([{ ...stockEntry, id: 's7', userId: 'u2' }]);
      await switchAccount(app);
      removal.answer();
      expect(await pending).toBe(false);
      expect(get(app.state).stock.map((item) => item.id)).toEqual(['s7']);
      expect(get(app.state)).toMatchObject({ toast: '', error: '' });
      expect(await readSnapshot('u1')).toBeNull();
    });

    it('does not call onSaved for a form write of the previous account', async () => {
      signedIn();
      const onSaved = vi.fn();
      const app = createAppController({ onSaved });
      await app.refresh();
      const input = { manufacturerId: 'm1', name: 'Green', code: 'PC-21' } as never;
      const adding = held('POST /api/glazes', () => Response.json({ id: glaze.id, glaze, stock: [] }));
      const pending = app.addGlaze(input);
      await adding.requested;
      await switchAccount(app);
      adding.answer();
      expect(await pending).toBeNull();
      expect(onSaved).not.toHaveBeenCalled();
      routes['POST /api/glazes'] = created;
      expect(await app.addGlaze(input)).not.toBeNull();
      expect(onSaved).toHaveBeenCalledTimes(1);
    });

    it('lets a request that reloads itself finish the reload for the new account, which opens no page and answers null', async () => {
      signedIn();
      const app = createAppController();
      await app.refresh();
      const clubs = counted('GET /api/clubs');
      const creation = held('POST /api/clubs', () => Response.json({}));
      const pending = app.createClub('Kiln');
      await creation.requested;
      await switchAccount(app);
      const before = clubs.loads;
      creation.answer();
      expect(await pending).toBeNull();
      expect(clubs.loads).toBe(before + 1);
      expect(get(app.state).toast).toBe('');
    });
  });
});
