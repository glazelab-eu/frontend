import type { MessageKey } from '../i18n';

/**
 * The one save Studio may hold while offline (decision Q19): idle, then held with a snapshot of the
 * form taken at click time, then sending once the connection is back, then done or failed; the writer
 * can cancel a held save, and a held save of another account is cancelled instead of sent. The state
 * lives in memory in the Studio page only: nothing here persists. Every step is a pure function, so
 * a repeated call (a second `online` event, a second click) changes nothing and a request is handed
 * out exactly once, by `release`.
 */
export type HeldSave<T> =
  | { phase: 'idle' }
  | { phase: 'held'; request: T; account: string }
  | { phase: 'sending'; request: T; account: string }
  | { phase: 'done' }
  | { phase: 'failed' }
  | { phase: 'cancelled'; reason: 'user' | 'account' };

export const idle = { phase: 'idle' } as const;

/** A save is waiting or on its way: the form stays as it was when the writer chose to save. */
export const isActive = (state: HeldSave<unknown>) => state.phase === 'held' || state.phase === 'sending';

/** Holds `request` for `account`; refused while another one is held or on its way. */
export function hold<T>(state: HeldSave<T>, request: T, account: string | undefined): HeldSave<T> {
  if (!account || isActive(state)) return state;
  return { phase: 'held', request, account };
}

/** The writer cancels a held save; once it is sending it can no longer be called back. */
export function cancel<T>(state: HeldSave<T>): HeldSave<T> {
  return state.phase === 'held' ? { phase: 'cancelled', reason: 'user' } : state;
}

/**
 * Called whenever the connection or the account may have changed. A save of another account (or of
 * nobody) is dropped, also one already sending (the controller ends that write quietly). A held save
 * of the same account becomes `sending` as soon as `ready` (online and loaded) and `send` carries
 * the request to send, once; in every other case `state` comes back unchanged.
 */
export function release<T>(state: HeldSave<T>, account: string | undefined, ready: boolean): { state: HeldSave<T>; send: T | null } {
  if (state.phase !== 'held' && state.phase !== 'sending') return { state, send: null };
  if (state.account !== account) {
    return { state: { phase: 'cancelled', reason: 'account' }, send: null };
  }
  if (state.phase === 'sending' || !ready) return { state, send: null };
  return { state: { ...state, phase: 'sending' }, send: state.request };
}

/** The send ended: `done`, or `failed` (the form keeps its input and shows the error). */
export function finish<T>(state: HeldSave<T>, ok: boolean): HeldSave<T> {
  return state.phase === 'sending' ? { phase: ok ? 'done' : 'failed' } : state;
}

/** The leave question of a page: its title, and optionally its own body and leave button (else "Discard"). */
export interface LeaveQuestion {
  message: MessageKey;
  body?: MessageKey;
  leave?: MessageKey;
}

/**
 * What leaving Studio asks. Unsaved input and a save still waiting offer to discard (leaving drops
 * the held save). A request that is already out (a held save `sending`, or an online save under way)
 * cannot be called back and may already be stored, so that question promises no discard: the save
 * finishes whatever the answer is, and the leave button says so. Photos on their way (`photos: 'sending'`: the save or
 * their uploads are out) are dropped by leaving, though the combination stays saved; photos that failed after the save
 * (`'failed'`) are offered for discarding.
 */
export function studioLeaveQuestion({
  dirty,
  phase,
  saving,
  photos = 'none',
}: {
  dirty: boolean;
  phase: HeldSave<unknown>['phase'];
  saving: boolean;
  photos?: 'none' | 'sending' | 'failed';
}): LeaveQuestion & {
  dirty: boolean;
} {
  if (photos === 'sending') return { dirty: true, message: 'studio.leave.saving', body: 'studio.leave.photosBody', leave: 'studio.leave.anyway' };
  if (photos === 'failed') return { dirty: true, message: 'drafts.discardUpload' };
  if (saving || phase === 'sending') {
    return { dirty: true, message: 'studio.leave.saving', body: 'studio.leave.savingBody', leave: 'studio.leave.anyway' };
  }
  if (phase === 'held') return { dirty: true, message: 'studio.held.discard' };
  return { dirty, message: 'drafts.discardCombination' };
}
