import { describe, expect, it, vi } from 'vitest';
import { emptyBuddies } from '../../lib/buddies/buddies';
import { emptyAvailability } from '../../lib/stock/buddy-shelf';
import type { Snapshot } from '../../lib/api/models';
import { CLIENT_FORMAT, type SyncPoint } from '../../lib/sync/sync';
import { INITIAL_SYNC, type SyncState } from '../../lib/sync/lifecycle';
import { createLoadTicket } from './load-ticket';
import { createSnapshot } from './snapshot';
import { glaze, useMockApi } from './test-helpers';

const saves = vi.hoisted(() => ({ points: 0, snapshots: 0 }));
vi.mock('../../lib/offline/snapshots', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/offline/snapshots')>();
  return {
    ...actual,
    saveSyncPoint: (...args: Parameters<typeof actual.saveSyncPoint>) => {
      saves.points++;
      return actual.saveSyncPoint(...args);
    },
    saveSnapshot: (...args: Parameters<typeof actual.saveSnapshot>) => {
      saves.snapshots++;
      return actual.saveSnapshot(...args);
    },
  };
});

useMockApi();

describe('the snapshot memory', () => {
  const point = (cursor: string): SyncPoint => ({ cursor, epoch: 'e1', format: 1, client: CLIENT_FORMAT });
  const shown: Snapshot = {
    glazes: [glaze],
    combinations: [],
    stock: [],
    clubs: [],
    clubMembers: {},
    buddies: emptyBuddies(),
    buddyAvailability: emptyAvailability(),
    authorAvatars: {},
    favorites: { glazeIds: [], combinationIds: [] },
    favoriteCounts: { glazes: [], combinations: [] },
  };

  it('moves only the sync point for listings it saved, and forgets them and the sync point at an account change', async () => {
    const resets: (() => void)[] = [];
    const snapshot = createSnapshot({
      read: () => {
        throw new Error('not read');
      },
      step: () => true,
      stale: () => false,
      storage: async (action) => action(),
      ticket: createLoadTicket(),
      onAccountChange: (reset) => void resets.push(reset),
    });
    expect(resets).toHaveLength(1);
    // The shared test setup saved a snapshot of its own.
    Object.assign(saves, { points: 0, snapshots: 0 });
    await snapshot.persist('u1', shown, point('1.1'));
    snapshot.synced = { owner: 'u1', point: point('1.1') };
    await snapshot.persist('u1', shown, point('1.2'));
    expect(saves).toEqual({ points: 1, snapshots: 1 });
    resets[0]();
    expect(snapshot.synced).toBeNull();
    // The same listings again: without the memory of what was saved, the whole snapshot is written.
    await snapshot.persist('u1', shown, point('1.3'));
    expect(saves).toEqual({ points: 1, snapshots: 2 });
  });

  describe('restore (STATE-1a review: the guards after the IndexedDB read)', () => {
    /** A snapshot module over a state the test changes while the saved snapshot is read (`during`). */
    function restoring(during: (state: { user: { id: string } | null; sync: SyncState }, ticket: ReturnType<typeof createLoadTicket>) => void) {
      const state = { user: { id: 'u1' } as { id: string } | null, sync: INITIAL_SYNC };
      const ticket = createLoadTicket();
      const patches: { version: number; events: unknown; data: Record<string, unknown> }[] = [];
      let reading = false;
      const snapshot = createSnapshot({
        read: () => state as never,
        step: (version, events, data) => patches.push({ version, events, data: data as Record<string, unknown> }) > 0,
        stale: () => false,
        storage: async (action) => {
          const result = await action();
          if (reading) during(state, ticket);
          return result;
        },
        ticket,
        onAccountChange: () => undefined,
      });
      return {
        snapshot,
        patches,
        restore: async () => {
          reading = true;
          await snapshot.restore('u1', ticket.now(), true);
          reading = false;
        },
      };
    }

    it('shows the saved snapshot with the restored event in one patch, and remembers what the device holds', async () => {
      const { snapshot, patches, restore } = restoring(() => undefined);
      await snapshot.persist('u1', shown, point('1.1'));
      Object.assign(saves, { points: 0, snapshots: 0 });
      await restore();
      expect(patches).toHaveLength(1);
      expect(patches[0]).toMatchObject({ version: 0, events: { type: 'restored', continues: true }, data: { glazes: [glaze] } });
      expect(snapshot.synced).toEqual({ owner: 'u1', point: point('1.1') });
      // The restored listings saved again at a newer point: only the point moves, the device already holds them.
      const restored = patches[0].data as unknown as Snapshot;
      await snapshot.persist('u1', { ...shown, glazes: restored.glazes, combinations: restored.combinations }, point('1.2'));
      expect(saves).toEqual({ points: 1, snapshots: 0 });
    });

    for (const [what, change] of [
      ['a sign-out or newer load cancelled it', (_: unknown, ticket: ReturnType<typeof createLoadTicket>) => ticket.cancel()],
      ['another account signed in', (state: { user: { id: string } | null }) => (state.user = { id: 'u2' })],
      ['the account signed out', (state: { user: { id: string } | null }) => (state.user = null)],
      ['the listings arrived meanwhile', (state: { sync: SyncState }) => (state.sync = { phase: 'idle', failure: null })],
    ] as const) {
      it(`shows nothing when ${what} during the read`, async () => {
        const { snapshot, patches, restore } = restoring(change as never);
        await snapshot.persist('u1', shown, point('1.1'));
        await restore();
        expect(patches).toEqual([]);
        expect(snapshot.synced).toBeNull();
      });
    }
  });
});
