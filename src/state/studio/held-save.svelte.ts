import { untrack } from 'svelte';
import { cancel, finish, hold, idle, isActive, release, type HeldSave } from '../../lib/studio/held-save';

interface Options<T> {
  /** The primitive account ID (never the user object). */
  account: () => string | undefined;
  /** Online and loaded: the moment a held request may go out. */
  ready: () => boolean;
  /** Carries the request out like a normal save; answers whether it worked. */
  send: (request: T) => Promise<boolean>;
}

/**
 * Call while a page initializes. Holds one request in memory (`hold`), sends it once when `ready`
 * turns true for the account that held it and drops it when that account changes or signs out.
 * Unmounting ends the effect, so nothing is sent afterwards. The transitions are the pure ones of
 * `lib/studio/held-save.ts`. The page passes getters, so changing values are read lazily.
 */
export function createHeldSave<T>({ account, ready, send }: Options<T>) {
  let state = $state.raw<HeldSave<T>>(idle);
  /** Identifies the hold a running send belongs to, so a late answer never touches a newer one. */
  let serial = 0;

  async function run(request: T) {
    const mine = serial;
    let ok = false;
    try {
      ok = await send(request);
    } catch {
      ok = false;
    }
    if (mine === serial) state = finish(state, ok);
  }

  $effect(() => {
    const current = account();
    const now = ready();
    const released = release(state, current, now);
    if (released.state === state) return;
    state = released.state;
    if (released.send !== null) {
      const request = released.send;
      untrack(() => void run(request));
    } else serial++;
  });

  return {
    get phase() {
      return state.phase;
    },
    /** A save is waiting or on its way. */
    get active() {
      return isActive(state);
    },
    /** The held request, for the status text. */
    get request(): T | undefined {
      return state.phase === 'held' || state.phase === 'sending' ? state.request : undefined;
    },
    /** Holds `request` for the current account; false when one is already held or nobody is signed in. */
    hold(request: T) {
      const next = hold(state, request, account());
      if (next === state) return false;
      serial++;
      state = next;
      return true;
    },
    cancel() {
      state = cancel(state);
    },
  };
}
