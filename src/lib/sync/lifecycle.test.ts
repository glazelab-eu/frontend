import { describe, expect, it } from 'vitest';
import { flagsOf, INITIAL_SYNC, sameSync, transition, type SyncEvent, type SyncState } from './lifecycle';

const progress = { done: 1000, total: 4000 };
const loading: SyncState = { phase: 'loading', progress: null, failure: null };
const paged: SyncState = { phase: 'loading', progress, failure: null };
const loadingFailed: SyncState = { phase: 'loading', progress: null, failure: 'server' };
const refreshing: SyncState = { phase: 'refreshing', failure: null };
const refreshingFailed: SyncState = { phase: 'refreshing', failure: 'offline' };
const idle: SyncState = { phase: 'idle', failure: null };
const idleFailed: SyncState = { phase: 'idle', failure: 'rateLimited' };

const SAME = Symbol('the state itself');

/** [name, from, event, to]: `SAME` means the transition answers `from` itself (no patch). */
const TABLE: [string, SyncState, SyncEvent, SyncState | typeof SAME][] = [
  ['an account change shows loading over a refresh', refreshing, { type: 'accountChanged' }, loading],
  ['an account change drops the progress of a paged load', paged, { type: 'accountChanged' }, loading],
  ['an account change forgets the previous account’s failure', idleFailed, { type: 'accountChanged' }, loading],
  ['an account change while loading forgets the failure', loadingFailed, { type: 'accountChanged' }, loading],
  ['an account change while nothing is shown changes nothing', loading, { type: 'accountChanged' }, SAME],
  ['a load over shown listings refreshes', idle, { type: 'begin', shown: true }, refreshing],
  [
    'a load over shown listings keeps the failure (Try again stays)',
    idleFailed,
    { type: 'begin', shown: true },
    { phase: 'refreshing', failure: 'rateLimited' },
  ],
  ['a second load over a refresh changes nothing', refreshing, { type: 'begin', shown: true }, SAME],
  ['a load while nothing is shown keeps loading and its progress', paged, { type: 'begin', shown: true }, SAME],
  [
    'a load with nothing of the account shown shows loading',
    idleFailed,
    { type: 'begin', shown: false },
    { phase: 'loading', progress: null, failure: 'rateLimited' },
  ],
  ['a load with nothing shown over a refresh shows loading', refreshing, { type: 'begin', shown: false }, loading],
  ['a load with nothing shown while loading changes nothing', paged, { type: 'begin', shown: false }, SAME],
  ['a page of a first load counts', loading, { type: 'progress', progress }, paged],
  [
    'a larger total counts',
    paged,
    { type: 'progress', progress: { done: 1000, total: 5000 } },
    { phase: 'loading', progress: { done: 1000, total: 5000 }, failure: null },
  ],
  ['the same count again changes nothing', paged, { type: 'progress', progress: { ...progress } }, SAME],
  ['progress while listings are shown changes nothing', refreshing, { type: 'progress', progress }, SAME],
  ['a restore that the load follows refreshes', paged, { type: 'restored', continues: true }, refreshing],
  ['a restore that ends the load is idle and keeps the failure', loadingFailed, { type: 'restored', continues: false }, { phase: 'idle', failure: 'server' }],
  ['a restore while shown changes nothing', refreshing, { type: 'restored', continues: false }, SAME],
  [
    'a failure keeps loading (no "unavailable" during the snapshot read)',
    paged,
    { type: 'failed', failure: 'offline' },
    { phase: 'loading', progress, failure: 'offline' },
  ],
  ['a failure keeps the refresh', refreshing, { type: 'failed', failure: 'server' }, { phase: 'refreshing', failure: 'server' }],
  ['a failure while idle is recorded', idle, { type: 'failed', failure: 'offline' }, { phase: 'idle', failure: 'offline' }],
  ['the same failure again changes nothing', refreshingFailed, { type: 'failed', failure: 'offline' }, SAME],
  ['a finished load is idle without failure', loadingFailed, { type: 'loaded' }, idle],
  ['a finished refresh is idle without failure', refreshingFailed, { type: 'loaded' }, idle],
  ['a finished load while idle changes nothing', idle, { type: 'loaded' }, SAME],
  ['a finished load clears an idle failure', idleFailed, { type: 'loaded' }, idle],
  ['a load that ends without data is idle and keeps the failure', refreshingFailed, { type: 'ended' }, { phase: 'idle', failure: 'offline' }],
  ['an ending forgets the progress', paged, { type: 'ended' }, idle],
  ['an ending while idle changes nothing', idleFailed, { type: 'ended' }, SAME],
];

describe('transition', () => {
  it.each(TABLE)('%s', (_, from, event, to) => {
    const next = transition(from, event);
    if (to === SAME) expect(next).toBe(from);
    else {
      expect(next).toEqual(to);
      expect(next).not.toBe(from);
    }
  });

  it('starts loading with nothing shown', () => {
    expect(INITIAL_SYNC).toEqual(loading);
  });
});

describe('flagsOf', () => {
  it('projects the five loading fields', () => {
    expect(flagsOf(paged)).toEqual({ loading: true, syncing: false, syncProgress: progress, loadFailed: false, loadFailure: 'offline' });
    expect(flagsOf(refreshingFailed)).toEqual({ loading: false, syncing: true, syncProgress: null, loadFailed: true, loadFailure: 'offline' });
    expect(flagsOf(idleFailed)).toEqual({ loading: false, syncing: false, syncProgress: null, loadFailed: true, loadFailure: 'rateLimited' });
    expect(flagsOf(loadingFailed)).toMatchObject({ loading: true, loadFailed: true, loadFailure: 'server' });
  });
});

/** A small seeded generator (mulberry32), so a failing sequence can be replayed from its seed. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function anyEvent(next: () => number): SyncEvent {
  const pick = <T>(items: readonly T[]) => items[Math.floor(next() * items.length)];
  switch (pick(['accountChanged', 'begin', 'progress', 'restored', 'failed', 'loaded', 'ended'] as const)) {
    case 'accountChanged':
      return { type: 'accountChanged' };
    case 'begin':
      return { type: 'begin', shown: next() < 0.5 };
    case 'progress':
      return { type: 'progress', progress: { done: pick([0, 1000, 2000]), total: pick([2000, 4000]) } };
    case 'restored':
      return { type: 'restored', continues: next() < 0.5 };
    case 'failed':
      return { type: 'failed', failure: pick(['offline', 'server', 'rateLimited'] as const) };
    case 'loaded':
      return { type: 'loaded' };
    case 'ended':
      return { type: 'ended' };
  }
}

describe('any sequence of events', () => {
  it('keeps the flags consistent, patches exactly the changes and answers the state itself for no change', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const next = random(seed);
      let state = INITIAL_SYNC;
      let flags = flagsOf(state);
      for (let i = 0; i < 60; i++) {
        const event = anyEvent(next);
        const after = transition(state, event);
        const context = `seed ${seed}, event ${i}: ${JSON.stringify(event)} from ${JSON.stringify(state)}`;
        // Never two of the old fields' "impossible by convention" combinations.
        const projected = flagsOf(after);
        expect(projected.loading && projected.syncing, context).toBe(false);
        if (projected.syncProgress) expect(projected.loading, context).toBe(true);
        // The state itself exactly when nothing changed (then the dispatcher patches nothing), and else a projection that differs.
        expect(after === state, context).toBe(sameSync(after, state));
        expect(after === state, context).toBe(JSON.stringify(projected) === JSON.stringify(flags));
        flags = projected;
        // Every event is idempotent: the same event again is no patch.
        expect(transition(after, event), context).toBe(after);
        // What the events promise.
        if (event.type === 'loaded') expect(after, context).toEqual({ phase: 'idle', failure: null });
        if (event.type === 'ended') expect(after, context).toEqual({ phase: 'idle', failure: state.failure });
        if (event.type === 'failed') expect([after.phase, after.failure], context).toEqual([state.phase, event.failure]);
        if (event.type === 'accountChanged') expect(after, context).toEqual({ phase: 'loading', progress: null, failure: null });
        if (!['failed', 'loaded', 'accountChanged'].includes(event.type)) expect(after.failure, context).toBe(state.failure);
        if (state.phase === 'loading' && after.phase !== 'loading') expect(['restored', 'loaded', 'ended'], context).toContain(event.type);
        state = after;
      }
    }
  });
});
