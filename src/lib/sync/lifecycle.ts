/**
 * The sync lifecycle of the app controller (STATE-1b): one typed state in place of the loading flags. `loading`: nothing of the
 * account is shown yet (its saved snapshot or a finished load), with the progress of a paged first load; `refreshing`: a load runs
 * while listings are shown; `idle`: no load runs. Each carries the failure of the last load (null when it did not fail), so a
 * failure never needs a phase of its own. Connectivity (`online`) is NOT part of it: it changes independently of the phase.
 *
 * `transition` is pure and answers the state itself when an event changes nothing, so a caller can tell "no patch" by identity.
 * The controller's dispatcher (`step`) is the only place that applies events; the store holds the result as `AppState.sync`.
 */

/** Unreachable (offline), rate limited, or anything else the server answered. */
export type LoadFailure = 'offline' | 'server' | 'rateLimited';

/** A paged first load of the account's library: combinations saved of the listing's (a type, so it fits translation values). */
export type SyncProgress = { done: number; total: number };

export type SyncState =
  | { phase: 'loading'; progress: SyncProgress | null; failure: LoadFailure | null }
  | { phase: 'refreshing'; failure: LoadFailure | null }
  | { phase: 'idle'; failure: LoadFailure | null };

export type SyncEvent =
  /** Another account (or none) is signed in: nothing of it is shown yet, and the previous account's failure goes with it. */
  | { type: 'accountChanged' }
  /** A load begins: over listings that are shown (`refreshing`), or with nothing of the account shown (`loading`). */
  | { type: 'begin'; shown: boolean }
  /** A page of a paged first load arrived. */
  | { type: 'progress'; progress: SyncProgress }
  /** The saved snapshot is shown while nothing was: the load goes on in the background (`continues`) or ends with it. */
  | { type: 'restored'; continues: boolean }
  /** The load failed; the phase stays until a restore or `ended`, so no "unavailable" shows during the snapshot read. */
  | { type: 'failed'; failure: LoadFailure }
  /** The load showed its data: no failure any more. */
  | { type: 'loaded' }
  /** The load is over without data of its own (failed, superseded by nothing, or nothing to ask): the failure stays. */
  | { type: 'ended' };

/** Before the first load: nothing shown. */
export const INITIAL_SYNC: SyncState = { phase: 'loading', progress: null, failure: null };

const loading = (progress: SyncProgress | null, failure: LoadFailure | null): SyncState => ({ phase: 'loading', progress, failure });
const refreshing = (failure: LoadFailure | null): SyncState => ({ phase: 'refreshing', failure });
const idle = (failure: LoadFailure | null): SyncState => ({ phase: 'idle', failure });

/** Nothing of the account is shown yet (its saved snapshot or a finished load). */
export const isLoading = (state: SyncState) => state.phase === 'loading';
/** The progress of a paged first load while nothing is shown; null otherwise. */
export const progressOf = (state: SyncState) => (state.phase === 'loading' ? state.progress : null);
const sameProgress = (a: SyncProgress | null, b: SyncProgress | null) => a === b || (!!a && !!b && a.done === b.done && a.total === b.total);

/** Two states that mean the same: same phase, failure and progress. */
export function sameSync(a: SyncState, b: SyncState): boolean {
  return a === b || (a.phase === b.phase && a.failure === b.failure && sameProgress(progressOf(a), progressOf(b)));
}

/** `next`, or `state` itself when `next` means the same. */
const settled = (state: SyncState, next: SyncState) => (sameSync(state, next) ? state : next);

/** The state after `event`; `state` itself when the event changes nothing. */
export function transition(state: SyncState, event: SyncEvent): SyncState {
  switch (event.type) {
    case 'accountChanged':
      return settled(state, loading(null, null));
    case 'begin':
      if (state.phase === 'loading') return state;
      if (!event.shown) return loading(null, state.failure);
      return state.phase === 'idle' ? refreshing(state.failure) : state;
    case 'progress':
      return state.phase === 'loading' ? settled(state, loading(event.progress, state.failure)) : state;
    case 'restored':
      if (state.phase !== 'loading') return state;
      return event.continues ? refreshing(state.failure) : idle(state.failure);
    case 'failed':
      return settled(state, { ...state, failure: event.failure });
    case 'loaded':
      return settled(state, idle(null));
    case 'ended':
      return settled(state, idle(state.failure));
  }
}

/** The five loading fields the store held before STATE-1b, projected from the state (tests assert with them; pages use the selectors). */
export interface SyncFlags {
  /** No listings of this account are shown yet: neither its saved snapshot nor a finished load. */
  loading: boolean;
  /**
   * A load runs while listings are shown (the saved snapshot at the start, or after a write): an item they do not
   * hold may still arrive, so it is not reported missing yet.
   */
  syncing: boolean;
  /** A paged first load of this account's library, while nothing is shown yet: combinations saved of the listing's. */
  syncProgress: SyncProgress | null;
  /** The last load could not fetch shared data (unreachable or 5xx); saved data may be shown. */
  loadFailed: boolean;
  /** Why the last load failed; only meaningful while `loadFailed` is set. */
  loadFailure: LoadFailure;
}

export function flagsOf(state: SyncState): SyncFlags {
  return {
    loading: state.phase === 'loading',
    syncing: state.phase === 'refreshing',
    syncProgress: progressOf(state),
    loadFailed: state.failure !== null,
    loadFailure: state.failure ?? 'offline',
  };
}
