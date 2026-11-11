import type { MessageKey } from '../../lib/i18n';
import { createAdminActions } from '../admin/admin-actions';
import type { Write } from './write';
import type { AppContext } from './context';
import { createLoadTicket } from './load-ticket';
import { createSession } from './session';
import { createSnapshot } from './snapshot';
import { createListingSync } from './listing-sync';
import { createLoad } from './load';
import { createShareActions } from './share-actions';
import { createAccountData } from './account-data';
import { createDiagnosticsWiring } from './diagnostics-wiring';
import { createStockActions } from '../stock/stock-actions';
import { createCatalogActions } from '../catalog/catalog-actions';
import { createImageActions } from '../images/image-actions';
import { createClubActions } from '../clubs/club-actions';
import { createWishlistActions } from '../clubs/wishlist-actions';
import { createBuddyActions } from '../buddies/buddy-actions';
import { createAccountActions } from '../account/account-actions';
import { createFeedActions } from '../feed/feed-actions';
import { createFeedbackActions } from '../feedback/feedback-actions';
import { get, readonly } from 'svelte/store';
import { ApiError, errorMessage } from '../../lib/api/client';
import { networkReachable } from '../../lib/offline/offline';
import { DEFAULT_UPLOAD_VISIBILITY } from '../../lib/images/upload-queue';
import { createAppState } from './app-state';
import type { AppPatch, FormName } from './app-state';
import { INITIAL_SYNC, transition, type SyncEvent, type SyncState } from '../../lib/sync/lifecycle';
import { createNavigation } from '../navigation/navigation';

const ACCOUNT_CHANGED: SyncEvent = { type: 'accountChanged' };

/**
 * The app controller's core (STATE-1a): the store, `patch` with the account-change reset registry, the load ticket, the write lifecycle
 * and the public object, composed of modules built in the order below (`state/app/context.ts`; frontend guide "Controller modules").
 */
export function createAppController({ onSaved = () => {} }: { onSaved?: () => void } = {}) {
  const state = createAppState();
  const read = () => get(state);
  // Pictures that are not saved are not requested while the app knows it is offline (lib/offline/offline.ts).
  state.subscribe((current) => networkReachable.set(current.online));
  /** `actor` (the account that started a write or read) is no longer the signed-in one. */
  const stale = (actor: string | undefined) => read().user?.id !== actor;
  /**
   * The resets of per-account memory (this session's tokens and the like), registered by the module that owns it (`onAccountChange`):
   * `patch` runs them synchronously inside the update that changes the account, so no subscriber ever sees the new account beside the
   * previous account's memory. They run in the order they were registered; a throw is not caught (as with the statements they replaced).
   */
  const accountResets: (() => void)[] = [];
  const onAccountChange = (reset: () => void) => void accountResets.push(reset);
  /** The sync lifecycle (`lib/sync/lifecycle.ts`), mirrored into the store's `sync` by `update` only. */
  let sync: SyncState = INITIAL_SYNC;
  /**
   * The one store update: `changes`, the account-change resets, and the sync events (`accountChanged` first when the account changes)
   * with the new `sync` when they change it, all in one update. Only `patch` and the dispatcher `step` call it.
   */
  function update(changes: AppPatch, events: readonly SyncEvent[]) {
    state.update((current) => {
      const accountChanged = 'user' in changes && current.user?.id !== changes.user?.id;
      if (accountChanged) {
        for (const reset of accountResets) reset();
      }
      const before = sync;
      for (const event of accountChanged ? [ACCOUNT_CHANGED, ...events] : events) sync = transition(sync, event);
      return {
        ...current,
        ...changes,
        ...(sync !== before ? { sync } : {}),
        // The notice belongs to the dialog it opened with.
        ...(changes.authOpen === false && !('authNotice' in changes) ? { authNotice: null } : {}),
        ...(accountChanged
          ? {
              authOpen: false,
              authNotice: null,
              accountSetup: null,
              uploadFor: null,
              uploadVisibility: DEFAULT_UPLOAD_VISIBILITY,
              removingImage: null,
              deletingAccount: false,
              changingPassword: false,
              feedbackOpen: false,
              termsRequired: false,
              formError: null,
              leaving: null,
              requestToast: null,
            }
          : {}),
      };
    });
  }
  const patch = (changes: AppPatch) => update(changes, []);
  /**
   * The sync dispatcher: applies `events` of the load `version` with `data` in one patch, drops both unless that load is still the
   * newest (`ticket`), and patches nothing when neither the data nor the state changes. Answers whether it applied them.
   */
  function step(version: number, events: SyncEvent | readonly SyncEvent[], data: AppPatch = {}): boolean {
    if (!ticket.isCurrent(version)) return false;
    const list = Array.isArray(events) ? events : [events as SyncEvent];
    if (!Object.keys(data).length && list.reduce(transition, sync) === sync) return true;
    update(data, list);
    return true;
  }

  const ticket = createLoadTicket();
  // Registers its reset first, before the modules below (`storage` is a hoisted function declaration).
  const snapshot = createSnapshot({ read, step, stale, storage, ticket, onAccountChange });
  const { restore, saveCurrent } = snapshot;
  const listingSync = createListingSync({ read, step, storage, ticket }, { snapshot });
  const navigation = createNavigation({ read, patch });
  const { go } = navigation;
  // Every member is defined by now (the write lifecycle and `storage` are hoisted function declarations) but `load`, which is bound
  // late: the load module is built after the modules it calls, and nothing loads while the controller is built.
  const ctx: AppContext = {
    read,
    patch,
    stale,
    notify,
    query,
    mutate,
    mutateFor,
    fail,
    storage,
    load: (options) => load(options),
    saveCurrent,
    go,
    visit: navigation.visit,
    onAccountChange,
    ticket,
    step,
  };
  const accountData = createAccountData(ctx);
  const { availabilityOf } = accountData;
  const buddyActions = createBuddyActions(ctx, { availabilityOf });
  const { reloadBuddies } = buddyActions;
  const sessions = createSession(ctx, { restore });
  const { signingIn, checkSession, logout, deleteAccount } = sessions;
  const { loadAuthOptions, ...accountActions } = createAccountActions(ctx, { signingIn });
  const { openAuth } = accountActions;
  // Subscribes at once, after the `networkReachable` mirror, as before.
  const { diagnostics, setUpdatePending } = createDiagnosticsWiring(ctx, state);
  const { load, start, refreshAvatarIds } = createLoad(ctx, {
    snapshot,
    listingSync,
    sessions,
    accountData,
    loadAuthOptions,
    navigation,
    diagnostics,
    reloadBuddies,
  });

  /**
   * Shows a transient notice. Mutations pass the account that started them, so a notice that
   * arrives after a sign-out or account change is dropped instead of reaching the next account.
   */
  function notify(key: MessageKey, actor = read().user?.id, values: Record<string, number | string> = {}) {
    if (stale(actor)) return;
    patch({ toast: key, toastValues: values });
    setTimeout(() => {
      if (read().toast === key) patch({ toast: '', toastValues: {} });
    }, 4500);
  }

  /**
   * A 401 for the signed-in account outside the sign-in itself: the server ended the session (password changed or reset
   * elsewhere, deletion, 30 days idle, 365 days absolute). `auth` is the sign-in's own form, whose 401 means a wrong password.
   */
  const sessionLost = (error: unknown, actor: string | undefined, form?: FormName) =>
    error instanceof ApiError && error.status === 401 && form !== 'auth' && !!actor && !stale(actor);

  /**
   * Reports a failure; the message is dropped when the account changed since `actor` started. A
   * failed form submit goes to that form (`formError`) instead of the banner. A 401 of the signed-in account is
   * checked with the server first (`checkSession`) and shows the sign-in instead of the message when the session
   * has ended; the answer resolves when the check is over.
   */
  function fail(error: unknown, actor = read().user?.id, form?: FormName): Promise<void> | void {
    // A failure that arrives while a check runs (a parallel write, or the check's own load) waits for that same check.
    if (sessionLost(error, actor, form)) {
      return checkSession().then((ended) => {
        if (!ended) report(error, actor, form);
      });
    }
    report(error, actor, form);
  }

  function report(error: unknown, actor: string | undefined, form?: FormName) {
    const message = errorMessage(error);
    patch({
      ...(!stale(actor) ? (form ? { formError: { form, message } } : { error: message }) : {}),
      ...(error instanceof ApiError && error.status === 0 ? { online: false } : {}),
      // Writes from an account with outdated terms: keep the session and ask for acceptance.
      ...(error instanceof ApiError && error.status === 428 && !stale(actor) ? { termsRequired: true } : {}),
    });
  }

  const inFlight = new Set<string>();

  /**
   * Common write lifecycle: guards, clear the old error, request, stale-account check, apply, form
   * callback, notice. `request` or `apply` answering false ends it as a refusal. A failure reloads
   * after `reloadOn` statuses and is reported at the form or in the banner (dropped when the
   * account changed). Both phases may throw.
   */
  async function write<R, T>(spec: Write<R, T>): Promise<{ done: boolean; value: T | null }> {
    const { request, apply, notice, requireOnline, reloadOn, busy } = spec;
    const formNow = () => (typeof spec.form === 'function' ? spec.form() : spec.form);
    const form = formNow();
    const refused = { done: false, value: null };
    const actor = read().user?.id;
    if (requireOnline && (!actor || !read().online)) return refused;
    if (busy && inFlight.has(busy)) return refused;
    if (busy) inFlight.add(busy);
    patch({ error: '', ...(form ? { formError: null } : {}) });
    try {
      const result = await request(actor);
      if (result === false) return refused;
      let value: T | null = null;
      if (apply) {
        if (stale(actor)) return refused;
        const applied = await apply(result as R, actor);
        if (applied === false) return refused;
        value = applied ?? null;
      }
      if (form && actor && !stale(actor)) onSaved();
      if (notice) notify(typeof notice === 'function' ? notice() : notice, actor);
      return { done: true, value };
    } catch (error) {
      if (error instanceof ApiError && reloadOn?.includes(error.status)) await load();
      await fail(error, actor, formNow());
      return refused;
    } finally {
      if (busy) inFlight.delete(busy);
    }
  }

  /** A write that answers whether it worked. */
  async function mutate<R>(spec: Write<R, unknown>) {
    return (await write(spec)).done;
  }

  /** A write that answers what `apply` returned, or null after a failure or a stale account. */
  async function mutateFor<R, T>(spec: Write<R, T>): Promise<T | null> {
    const { done, value } = await write(spec);
    return done ? value : null;
  }

  /**
   * A read for a dialog or page, without a notice: the result, or null after a failure (reported like
   * a write's, at `form` or in the banner) or when the account changed meanwhile. It clears only its
   * own form's earlier error, so a retry starts clean without touching other forms.
   */
  async function query<T>(action: () => Promise<T>, form?: FormName): Promise<T | null> {
    const actor = read().user?.id;
    if (form && read().formError?.form === form) patch({ formError: null });
    try {
      const result = await action();
      return stale(actor) ? null : result;
    } catch (error) {
      await fail(error, actor, form);
      return null;
    }
  }

  async function storage<T>(action: () => T | Promise<T>): Promise<T | undefined> {
    try {
      return await action();
    } catch {
      patch({ storageWarning: true });
      return undefined;
    }
  }

  return {
    ...createAdminActions({ query, mutate, load, notify }),
    ...accountActions,
    ...createCatalogActions(ctx, { onSaved, openAuth }),
    ...createShareActions(ctx),
    ...createImageActions(ctx, { refreshAvatarIds }),
    deleteAccount,
    openAccountDeletion: () => {
      if (read().user) patch({ deletingAccount: true, error: '', formError: null });
    },
    closeAccountDeletion: () => patch({ deletingAccount: false, error: '', formError: null }),
    setUpdatePending,
    openPasswordChange: () => {
      if (read().user) patch({ changingPassword: true, formError: null });
    },
    closePasswordChange: () => patch({ changingPassword: false, formError: null }),
    state: readonly(state),
    start,
    refresh: () => load(),
    retry: () => load({ tryApi: true }),
    navigate: navigation.navigate,
    back: navigation.back,
    registerLeaveGuard: navigation.registerLeaveGuard,
    hasUnsavedWork: navigation.hasUnsavedWork,
    allowUnload: navigation.allowUnload,
    leaveAnyway: navigation.leaveAnyway,
    stay: navigation.stay,
    closeAuth: () => patch({ authOpen: false, formError: null }),
    /** A dialog opens or closes: an earlier failed submit must not greet the next one. */
    clearFormError: () => patch({ formError: null }),
    dismissError: () => patch({ error: '' }),
    /** A failure outside the controller's own requests (a language that could not be loaded) in the error toast. */
    showError: (message: MessageKey) => patch({ error: message }),
    dismissStorageWarning: () => patch({ storageWarning: false }),
    logout,
    ...createStockActions(ctx),
    ...createClubActions(ctx),
    ...createWishlistActions(ctx),
    ...buddyActions,
    ...createFeedActions(ctx),
    ...createFeedbackActions(ctx),
  };
}

export type AppController = ReturnType<typeof createAppController>;
