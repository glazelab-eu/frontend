import type { MessageKey } from '../../lib/i18n';
import type { Route } from '../../lib/routing/routes';
import type { SyncEvent } from '../../lib/sync/lifecycle';
import type { AppPatch, AppState, FormName } from './app-state';
import type { LoadTicket } from './load-ticket';
import type { Write } from './write';

/**
 * What the app controller hands the modules it is composed of (`create<X>(ctx, deps)`, as `createNavigation` and `createAdminActions`):
 * the store, the shared write lifecycle and failure report, storage, the snapshot save, the load, the load ticket and navigation. A module
 * takes a `Pick` of the members it uses and gets what other modules hand back (`deps`, such as `signingIn` or `reloadBuddies`) as a second
 * argument. It keeps no module-level state: it owns its per-account memory (a token, the snapshot's sync point, the session-check memory)
 * and registers its reset with `onAccountChange`, and never keeps a load counter of its own (it uses `ticket`). The controller keeps the
 * store, `patch` with the reset registry, the write lifecycle and the order in which the modules are built; `load` is bound late, because
 * the load module is built after the modules that call it.
 */
export interface AppContext {
  read: () => AppState;
  /** Changes the store; never `sync`, which only `step` writes. */
  patch: (changes: AppPatch) => void;
  /**
   * The sync dispatcher: applies the sync events of the load `version` with `data` in one patch, drops both unless that load is the
   * newest (`ticket`), and patches nothing when nothing changes. The one writer of `sync`; answers whether it applied.
   */
  step: (version: number, events: SyncEvent | readonly SyncEvent[], data?: AppPatch) => boolean;
  /** `actor` (the account that started a write or read) is no longer the signed-in one. */
  stale: (actor: string | undefined) => boolean;
  notify: (key: MessageKey, actor?: string, values?: Record<string, number | string>) => void;
  query: <T>(action: () => Promise<T>, form?: FormName) => Promise<T | null>;
  mutate: <R>(spec: Write<R, unknown>) => Promise<boolean>;
  mutateFor: <R, T>(spec: Write<R, T>) => Promise<T | null>;
  /** Reports a failure (`formError` or the error toast; a 401 of the signed-in account checks the session first). */
  fail: (error: unknown, actor?: string, form?: FormName) => Promise<void> | void;
  /** Runs a storage action; a failure shows the storage warning and answers undefined, never failing the caller. */
  storage: <T>(action: () => T | Promise<T>) => Promise<T | undefined>;
  load: (options?: { tryApi?: boolean; patient?: boolean }) => Promise<void>;
  /** Saves the shown data as the account's offline snapshot after a small in-place change. */
  saveCurrent: (actor: string | undefined) => Promise<void>;
  go: (route: Route, options?: { replace?: boolean }) => void;
  /** The current visit of a page (`navigation.visit`): a write that outlives its page compares it. */
  visit: () => number;
  /**
   * Registers the reset of a module's per-account memory: `patch` runs it synchronously inside the update that changes the account,
   * before any subscriber sees the new account (a store subscription would run too late).
   */
  onAccountChange: (reset: () => void) => void;
  /** The controller's one load counter: a module that loads or cancels loads uses it, never a counter of its own. */
  ticket: LoadTicket;
}
