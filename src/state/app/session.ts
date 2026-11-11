import { api, resetCsrf } from '../../lib/api/client';
import type { User } from '../../lib/api/models';
import { rememberIncludeBuddies, rememberIncludeClubs } from '../../lib/buddies/include';
import { forgetIntroDismissal } from '../../lib/explore/audience';
import { clearPrivateCache, logoutPending, saveLastUser, setLogoutPending } from '../../lib/offline/offline';
import { home } from '../../lib/routing/routes';
import { forgetScanShelf } from '../../lib/stock/scan-shelf';
import type { LoadFailure } from '../../lib/sync/lifecycle';
import { emptyAccountData, type AppPatch } from './app-state';
import type { AppContext } from './context';
import type { createSnapshot } from './snapshot';

/**
 * The session of this device (STATE-1a): the session setter, the sign-out plumbing (LOGOUT-1/2: `logout`, `endServerSession`,
 * `signingIn`, `forgetAccount`, `clearHttpCache`), account deletion and the check of a 401 (`checkSession`). Owns the sign-out flags
 * (`pendingLogout`, `ending`, `signIns`) and the session-check memory (`sessionCheck`, `checkingSession`, `sessionEnded`, `confirmed`,
 * `keptShownFor`, the last reset through `onAccountChange`). The load reads and sets the flags it shares through the accessors of the
 * returned object (`pendingLogout`, `signIns`, `checkingSession`, `sessionEnded`, `confirmed`, `keptShownFor`), as `snapshot.synced`.
 */
export function createSession(
  ctx: Pick<AppContext, 'read' | 'patch' | 'step' | 'storage' | 'notify' | 'mutate' | 'load' | 'go' | 'onAccountChange' | 'ticket'>,
  { restore }: Pick<ReturnType<typeof createSnapshot>, 'restore'>,
) {
  /**
   * Sets the signed-in account (or none); another account than the shown one clears every private listing and shows loading (the
   * `accountChanged` event of the same patch). `failed`: the load `version` failed, recorded in the same patch.
   */
  function session(user: User | null, changes: AppPatch = {}, failed?: { version: number; failure: LoadFailure }) {
    const data = { ...changes, user, ...(ctx.read().user?.id !== user?.id ? { ...emptyAccountData(), storageWarning: false } : {}) };
    if (failed) ctx.step(failed.version, { type: 'failed', failure: failed.failure }, data);
    else ctx.patch(data);
  }

  // Keep an offline sign-out pending in memory even if device preferences cannot be saved.
  let pendingLogout = logoutPending();
  /** The request that ends the server session of a sign-out (`endServerSession`), shared by every load and sign-in that waits for it. */
  let ending: Promise<void> | null = null;
  /** Sign-ins under way (`signingIn`): no load sends a pending sign-out meanwhile, whose answer would end the new session. */
  let signIns = 0;
  /** The version of a sign-out that left its load to the sign-ins under way (`logout`): if they all fail, nothing else loads the guest. */
  let leftToSignIn: number | null = null;

  /** The check of a 401 that is under way (parallel failures share it) and whether a load found the session ended meanwhile. */
  let sessionCheck: Promise<boolean> | null = null;
  let checkingSession = false;
  let sessionEnded = false;
  /** The account the server confirmed in this run (its session check answered); a remembered one is not, until then. */
  let confirmed: string | null = null;
  /**
   * The account whose 'signed out, input kept' notice has shown (23-72c): later background loads that find the session
   * still dead keep that state quietly; only a write (a check) opens the dialog again. Reset by an account change and
   * by any load that finds the session alive (a sign-in ends in one).
   */
  let keptShownFor: string | null = null;
  ctx.onAccountChange(() => {
    keptShownFor = null;
  });

  /**
   * Asks the browser to empty its HTTP cache of this origin (club and private photos a shared device would keep for a week) once the
   * server has ended the session or the account (LOGOUT-2). Never awaited: the browser may hold that answer for seconds while it
   * empties the cache, and nothing (the sign-out notice, the next sign-in, a load) waits for it. Best effort, no retry.
   */
  function clearHttpCache() {
    void api.clearBrowserCache();
  }

  /**
   * Tells the server that this device signed out (`pendingLogout`): one request at a time, shared. Its success drops the flag and the
   * CSRF token, which died with the session, and sends the cache clearing without waiting for it (`clearHttpCache`).
   */
  function endServerSession(): Promise<void> {
    ending ??= api
      .logout()
      .then(async () => {
        pendingLogout = false;
        resetCsrf();
        clearHttpCache();
        await ctx.storage(() => setLogoutPending(false));
      })
      .catch((error) => {
        // The next attempt fetches a fresh token: another tab may have replaced the cookie this one matched (FE-4).
        resetCsrf();
        throw error;
      })
      .finally(() => {
        ending = null;
      });
    return ending;
  }

  /**
   * Runs a request that signs this device in. A pending sign-out goes first (its request in flight awaited, or sent now): its late
   * answer clears the session cookie and must never land on the new session. After the sign-in the flag goes whatever that request
   * did, so no later load ends the new session; an old session the server could not be told about ends with the sign-in, which
   * ends the session its request's cookie names (backend `LoginSessions`).
   */
  async function signingIn<T>(request: () => Promise<T>): Promise<T> {
    signIns++;
    let signedIn = false;
    try {
      if (pendingLogout) await endServerSession().catch(() => undefined);
      const answer = await request();
      if (pendingLogout) {
        pendingLogout = false;
        await ctx.storage(() => setLogoutPending(false));
      }
      signedIn = true;
      return answer;
    } finally {
      signIns--;
      // Nothing loaded since the sign-out that left its load to this sign-in: the guest would stay loading without it.
      if (!signedIn && !signIns && leftToSignIn !== null && ctx.ticket.isCurrent(leftToSignIn)) void ctx.load();
    }
  }

  /**
   * Removes what this device keeps of an account that signed out: its device flags, snapshot, photos and similar looks, and `lastUser`
   * last, so a sign-out whose page closed midway finishes at the next start (`loadAs`).
   */
  async function forgetAccount(accountId: string) {
    await ctx.storage(() => forgetDevicePreferences(accountId));
    await ctx.storage(() => clearPrivateCache(accountId));
    await ctx.storage(() => saveLastUser(null));
  }

  /**
   * Asks the server whether the session is still there after a 401 (a load, whose session check decides what follows:
   * the sign-out and the sign-in notice, or the sign-in in place while input is unsaved). One check serves every failure
   * that arrives meanwhile. Answers whether the session had ended; a session that is fine means the 401 was something else
   * (a request that raced a renewed session), and the caller reports the failure as usual. A load started by the check
   * never starts another, whatever it meets.
   */
  function checkSession(): Promise<boolean> {
    sessionCheck ??= (async () => {
      checkingSession = true;
      sessionEnded = false;
      try {
        await ctx.load({ tryApi: true });
        return sessionEnded;
      } finally {
        checkingSession = false;
        sessionCheck = null;
      }
    })();
    return sessionCheck;
  }

  /** The account's per-account device flags ("Include buddies", "Include club glazes", the dismissed intro card, the last scan shelf): sign-out and deletion remove them (27-7). */
  function forgetDevicePreferences(accountId: string | undefined) {
    if (!accountId) return;
    rememberIncludeBuddies(accountId, false);
    rememberIncludeClubs(accountId, false);
    forgetIntroDismissal(accountId);
    forgetScanShelf(accountId);
  }

  /**
   * Signs this device out at once (LOGOUT-1): the account and its data leave the state before anything is awaited, and loads started
   * earlier are discarded. The server is told in the background (`pendingLogout` until it confirms; the health poll and the next start
   * send a failed or unsent request again), and `signingOut` stands while the clean-up or that request still runs. The guest listings
   * load only once the server confirmed: before that the session cookie still names the account.
   */
  async function logout() {
    const { online, user } = ctx.read();
    if (!user) return;
    const version = ctx.ticket.begin();
    // The account change shows loading in the same patch (`accountChanged`).
    ctx.patch({ user: null, ...emptyAccountData(), storageWarning: false, signingOut: true });
    pendingLogout = true;
    await ctx.storage(() => setLogoutPending(true));
    const told = online
      ? endServerSession().then(
          () => true,
          () => false,
        )
      : Promise.resolve(false);
    await forgetAccount(user.id);
    if (!ctx.read().user) {
      ctx.go(home);
      // The guest's own snapshot, if any, while the server is told.
      await restore(null, version, false);
    }
    const confirmedOut = await told;
    ctx.patch({ signingOut: false });
    // Signed in again meanwhile: that sign-in's own load and notice stand (or, if it fails, its load: `signingIn`).
    if (ctx.read().user) return;
    if (signIns) {
      leftToSignIn = version;
      return;
    }
    if (confirmedOut) {
      await ctx.load();
      if (!ctx.read().user) ctx.notify('notices.signedOut');
      return;
    }
    ctx.step(version, { type: 'ended' });
    ctx.notify(online ? 'notices.signedOutPending' : 'notices.signedOutOffline');
  }

  /** Confirm account deletion online, then discard local identity and private data before reloading. */
  function deleteAccount(password: string) {
    return ctx.mutate({
      request: () => api.deleteAccount(password),
      apply: async (_, actor) => {
        const version = ctx.ticket.begin();
        resetCsrf();
        session(null, { toast: '', error: '' });
        clearHttpCache();
        pendingLogout = false;
        // Separate steps, as in `logout`: a failing localStorage must not keep the deleted account's snapshot and photos.
        await ctx.storage(() => setLogoutPending(false));
        await ctx.storage(() => saveLastUser(null));
        await ctx.storage(() => forgetDevicePreferences(actor));
        await ctx.storage(() => clearPrivateCache(actor));
        if (!ctx.ticket.isCurrent(version)) return;
        ctx.go(home, { replace: true });
        await ctx.load();
        if (!ctx.read().user) ctx.notify('notices.accountDeleted');
      },
      // As the password change: a refusal after the dialog closed (a page change) goes to the banner.
      form: () => (ctx.read().deletingAccount ? 'account-delete' : undefined),
      requireOnline: true,
      busy: 'deleting-account',
    });
  }

  return {
    session,
    clearHttpCache,
    endServerSession,
    signingIn,
    forgetAccount,
    checkSession,
    logout,
    deleteAccount,
    /** A sign-out the server has not confirmed yet (memory and localStorage): every load and sign-in sends or awaits it first. */
    get pendingLogout() {
      return pendingLogout;
    },
    set pendingLogout(value: boolean) {
      pendingLogout = value;
    },
    /** Sign-ins under way: no load sends a pending sign-out meanwhile. */
    get signIns() {
      return signIns;
    },
    /** A `checkSession` load runs. */
    get checkingSession() {
      return checkingSession;
    },
    /** A load found the session ended while a check ran. */
    get sessionEnded() {
      return sessionEnded;
    },
    set sessionEnded(value: boolean) {
      sessionEnded = value;
    },
    /** The account the server confirmed in this run. */
    get confirmed() {
      return confirmed;
    },
    set confirmed(value: string | null) {
      confirmed = value;
    },
    /** The account whose 'signed out, input kept' notice has shown. */
    get keptShownFor() {
      return keptShownFor;
    },
    set keptShownFor(value: string | null) {
      keptShownFor = value;
    },
  };
}
