import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clubMember } from '../../test/fixtures';
import { loaded, routes, useMockApi, user } from './test-helpers';

/** The controller's snapshot module, and whether its account-change reset has run (it forgets the sync point and the saved-snapshot memory). */
const memory = vi.hoisted(() => ({ snapshot: undefined as undefined | { synced: unknown }, resets: 0 }));
vi.mock('./snapshot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./snapshot')>();
  return {
    createSnapshot: (ctx: Parameters<typeof actual.createSnapshot>[0]) => {
      const snapshot = actual.createSnapshot({
        ...ctx,
        onAccountChange: (reset) =>
          ctx.onAccountChange(() => {
            reset();
            memory.resets++;
          }),
      });
      memory.snapshot = snapshot;
      return snapshot;
    },
  };
});

useMockApi();

const club = { id: 'c1', name: 'Kiln', houseRules: '', role: 'ADMIN', invitesEnabled: true, hasInviteLink: true, inviteVersion: 'v1' };

beforeEach(() => {
  vi.stubGlobal('window', Object.assign(new EventTarget(), { scrollTo: vi.fn() }));
  vi.stubGlobal('location', { hash: '#/account', origin: 'https://glazelab.eu', pathname: '/' });
  vi.stubGlobal('history', { state: null, replaceState: () => undefined });
  routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
  routes['GET /api/clubs'] = () => Response.json([club]);
  routes['GET /api/clubs/c1/members'] = () => Response.json([clubMember({ id: user.id, role: 'ADMIN' })]);
  routes['POST /api/clubs/c1/invite'] = () => Response.json({ token: 'I'.repeat(43), version: 'v1' });
  routes['POST /api/buddies/link'] = () => Response.json({ token: 'B'.repeat(43) });
});

describe('an account change', () => {
  it("drops the previous account's session memory in the same update: no subscriber sees the new account beside it", async () => {
    const { app } = await loaded();
    expect(await app.regenerateInvite('c1')).not.toBeNull();
    expect(await app.createBuddyLink(true)).not.toBeNull();
    const seen: unknown[] = [];
    const stop = app.state.subscribe((state) => {
      if (state.user?.id === 'u9') seen.push({ invite: app.inviteLink('c1'), buddy: app.buddyLink() });
    });
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u9' });
    routes['GET /api/clubs'] = () => Response.json([]);
    await app.refresh();
    stop();
    expect(seen.length).toBeGreaterThan(0);
    // The first update that shows the new account already finds the memory gone.
    expect(seen[0]).toEqual({ invite: null, buddy: null });
  });

  it('forgets the sync point and the saved-snapshot memory in the same update: no subscriber sees the new account beside them', async () => {
    const { app } = await loaded();
    expect(memory.snapshot?.synced).toMatchObject({ owner: 'u1' });
    const resetsBefore = memory.resets;
    const seen: unknown[] = [];
    const stop = app.state.subscribe((state) => {
      if (state.user?.id === 'u9') seen.push({ synced: memory.snapshot?.synced, resets: memory.resets - resetsBefore });
    });
    routes['GET /api/auth/me'] = () => Response.json({ ...user, id: 'u9' });
    routes['GET /api/clubs'] = () => Response.json([]);
    await app.refresh();
    stop();
    expect(seen.length).toBeGreaterThan(0);
    // The first update that shows the new account already finds the memory gone (the reset ran once for this account change).
    expect(seen[0]).toEqual({ synced: null, resets: 1 });
    expect(memory.snapshot?.synced).toMatchObject({ owner: 'u9' });
  });
});
