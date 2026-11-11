import { ApiError, api, errorMessage, resetCsrf } from '../../lib/api/client';
import type { AppPatch } from './app-state';
import type { User } from '../../lib/api/models';
import { avatarUrls } from '../../lib/avatars/avatar';
import { emptyBuddies } from '../../lib/buddies/buddies';
import { listingOrder, warmListing } from '../../lib/explore/listing';
import { freshRequestMemory, requestNews, requestShownBy } from '../../lib/feed/request-toast';
import type { SyncView } from '../../lib/generated/types.gen';
import { failureVerdict, RETRY_DELAY_MS } from '../../lib/offline/grace';
import {
  avatarIdsConfirmed,
  clearPrivateCache,
  dropCachedImages,
  logoutPending,
  onAvatarGone,
  pruneImageCache,
  readLastUser,
  saveLastUser,
} from '../../lib/offline/offline';
import { activeSort } from '../../lib/routing/routes';
import { emptyAvailability } from '../../lib/stock/buddy-shelf';
import { applyDelta, RESUME_SYNC_MS, type Listings, type SyncPoint } from '../../lib/sync/sync';
import { isLoading, type SyncEvent } from '../../lib/sync/lifecycle';
import type { createNavigation } from '../navigation/navigation';
import type { createAccountData } from './account-data';
import { loadFailureOf, shownImageUrls } from './app-state';
import type { AppContext } from './context';
import type { createDiagnosticsWiring } from './diagnostics-wiring';
import type { createListingSync } from './listing-sync';
import type { createSession } from './session';
import type { createSnapshot } from './snapshot';

/** The least time between two reads of the lists that name profile pictures after one answered 404 (`refreshAvatarIds`). */
const AVATAR_REFRESH_MS = 30_000;
/**
 * The activity badge's poll (FEED-1, live while the app is open; no push): one tiny `GET /api/feed/unread` per interval while the page
 * is visible, online and signed in, never while hidden, offline, signing in or out, or during a load (which reads the count with `/me`).
 * A failure doubles the wait up to `FEED_POLL_MAX_MS`; an answer that changes nothing patches nothing.
 */
export const FEED_POLL_MS = 30_000;
export const FEED_POLL_MAX_MS = 8 * 60_000;

const ENDED: SyncEvent = { type: 'ended' };
const LOADED: SyncEvent = { type: 'loaded' };
/** The load goes on over listings that are shown (no change while nothing is shown). */
const BEGIN_SHOWN: SyncEvent = { type: 'begin', shown: true };

/**
 * The load (STATE-1a): `load`/`loadAs` with the listings' `settle`, `rest()`, `shownData`, the `touched` re-ask and the patch that
 * shows the data in one unit (the loop's last `touched()`/`current()` check and that patch run in one synchronous step: never an
 * await between them), the start with its listeners and health poll, the grace window and the profile-picture refresh. Owns
 * `loadsRunning`, `lastSync`, `starting`, `offlineAt`, `grace` and `lastAvatarRefresh`, and registers `refreshAvatarIds` with
 * `onAvatarGone` when it is built. The session flags it shares are the session module's (`sessions`).
 */
export function createLoad(
  ctx: Pick<AppContext, 'read' | 'patch' | 'step' | 'stale' | 'fail' | 'storage' | 'saveCurrent' | 'ticket' | 'onAccountChange'>,
  {
    snapshot,
    listingSync: { listingsOf, fullListings },
    sessions,
    accountData: { membersOf, availabilityOf, authorAvatarsOf },
    loadAuthOptions,
    navigation,
    diagnostics,
    reloadBuddies,
  }: {
    snapshot: ReturnType<typeof createSnapshot>;
    listingSync: ReturnType<typeof createListingSync>;
    sessions: ReturnType<typeof createSession>;
    accountData: ReturnType<typeof createAccountData>;
    loadAuthOptions: () => Promise<void>;
    navigation: Pick<ReturnType<typeof createNavigation>, 'start' | 'hasUnsavedWork'>;
    diagnostics: ReturnType<typeof createDiagnosticsWiring>['diagnostics'];
    reloadBuddies: () => Promise<void>;
  },
) {
  const { ownerOf, persist, restore } = snapshot;
  const { session, clearHttpCache, endServerSession, forgetAccount } = sessions;

  /** Unreachable API, or a 5xx such as an nginx 502/503/504 page: keep the session and saved data. */
  const unavailable = (error: unknown) => error instanceof ApiError && (error.status === 0 || error.status >= 500);
  /** Rate limited (429): the server is up and the session valid; keep both and retry later. */
  const limited = (error: unknown) => error instanceof ApiError && error.status === 429;

  /** The kind of a failed load; one that is a server error (not offline, not a limit) is also an error report. */
  function failureOf(error: unknown) {
    const failure = loadFailureOf(error);
    if (failure === 'server') diagnostics.capture('ERROR', `Load failed: ${errorMessage(error)}`, error instanceof Error ? error.stack : undefined);
    return failure;
  }

  /** When the listings were last confirmed by the server (a finished load), for the refresh on returning to the app. */
  let lastSync = 0;
  let loadsRunning = 0;
  /**
   * The load version when the last `offline` event arrived. A load that began up to then and is still in flight finishes
   * with answers that were on their way before the connection dropped: it shows its data but does not report `online`
   * again, which would hide the event until the health poll (`reachable`). A later load (the `online` event, a manual
   * retry, the poll's reload) does, even on a device that reports itself offline.
   */
  let offlineAt = 0;
  /** The first load of this controller: it may show the snapshot of the account the device last saw before asking the server. */
  let starting = true;
  /**
   * What the badge poll knows of the account's waiting buddy requests (FEED-2, `lib/feed/request-toast.ts`): memory only, never stored;
   * an account change starts from the baseline again (a new object, so an answer asked with the old one is dropped).
   */
  let requests = freshRequestMemory();
  ctx.onAccountChange(() => {
    requests = freshRequestMemory();
  });

  // The grace window of `lib/offline/grace.ts`: opened by the start, a resume and the `online` event.
  let grace = { since: Date.now(), retries: 0 };
  const openGrace = () => {
    grace = { since: Date.now(), retries: 0 };
  };
  /** An unreachable API inside the grace window is no warning yet: true (and counted) when a silent retry should follow. */
  function waitsOut(error: unknown): boolean {
    if (!(error instanceof ApiError) || error.status !== 0) return false;
    const verdict = failureVerdict({ onLine: globalThis.navigator?.onLine, sinceMs: Date.now() - grace.since, retries: grace.retries });
    if (verdict === 'warn') return false;
    grace.retries++;
    return true;
  }
  const pause = () => new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));

  // tryApi: a passed health check or a manual retry reaches the API even when the
  // device reports offline (some VPN/VM adapters, localhost without a network).
  // patient: a start, resume or `online` load waits out an early unreachable answer (`waitsOut`): the `loading` phase
  // stays on during the silent retry, so no offline state or warning shows in between.
  async function load(options: { tryApi?: boolean; patient?: boolean } = {}): Promise<void> {
    const version = ctx.ticket.begin();
    loadsRunning++;
    try {
      await loadAs(version, options);
    } finally {
      loadsRunning--;
      // Every load ends here (`ended` changes nothing after `loaded`); dropped for a superseded load, as a newer one (a silent
      // retry included) ends itself. A path that patches anyway on its way out ends in that patch instead.
      ctx.step(version, ENDED);
    }
  }

  /**
   * One load: the saved snapshot first while nothing is shown (the instant start: the account the device last saw,
   * the guest's for guests), then the session, then the listings by delta or in full with stock, clubs, members and
   * favourites in full. Shown listings stay on screen meanwhile (`refreshing`) and are updated in place.
   */
  async function loadAs(version: number, { tryApi = false, patient = false }: { tryApi?: boolean; patient?: boolean }): Promise<void> {
    const current = () => ctx.ticket.isCurrent(version);
    const reachable = () => (version > offlineAt ? { online: true } : {});
    ctx.patch({ error: '' });
    sessions.pendingLogout ||= logoutPending();
    // A sign-out whose clean-up did not finish (the page closed right after the press) finishes before anything shows.
    const left = sessions.pendingLogout ? readLastUser() : null;
    if (left?.id) {
      await forgetAccount(left.id);
      if (!current()) return;
    }
    const last = sessions.pendingLogout ? null : readLastUser();
    // Nothing of the account shown (a failed first load without a snapshot): loading again, not "unavailable".
    if (snapshot.synced?.owner !== ownerOf(ctx.read().user?.id)) ctx.step(version, { type: 'begin', shown: false });
    if (isLoading(ctx.read().sync)) {
      // The instant start: the snapshot of the account this device last saw shows before the network answers. Later loads
      // with nothing shown (after a sign-out or an account change) show only the state's own account's snapshot.
      if (starting) session(last);
      starting = false;
      // The snapshot shows refreshing in the same patch: no update sees it settled while the load goes on.
      await restore(ctx.read().user?.id, version, true);
      if (!current()) return;
    }
    ctx.step(version, BEGIN_SHOWN);
    if (!tryApi && globalThis.navigator?.onLine === false) {
      session(last, { online: false }, { version, failure: 'offline' });
      await restore(last?.id, version, false);
      return;
    }
    if (sessions.pendingLogout && sessions.signIns) {
      // A sign-in runs, which sends or awaits the pending sign-out itself: until it answered the cookie may still name the old
      // account, so this load asks nothing (`/me` would show that account again); the sign-in's own load follows.
      return;
    }
    if (sessions.pendingLogout) {
      try {
        await endServerSession();
        if (!current()) return;
      } catch (error) {
        if (!current()) return;
        // The signed-out account's listings leave with it (`session`), as with the sign-out itself, before the guest snapshot shows.
        session(null, limited(error) ? {} : { online: false }, { version, failure: loadFailureOf(error) });
        await restore(null, version, false);
        return;
      }
    }
    if (!current()) return;

    let user: User | null;
    try {
      user = await api.me();
      if (!current()) return;
      sessions.confirmed = user.id;
      sessions.keptShownFor = null;
      session(user, reachable());
      if (last?.id && last.id !== user.id) await ctx.storage(() => clearPrivateCache(last.id));
      // The picture was replaced or removed elsewhere (another device, a site admin): its saved copies go, as after a change here.
      else if (last?.avatarId && last.avatarId !== user.avatarId) {
        const [owner, previous] = [user.id, last.avatarId];
        await ctx.storage(() => dropCachedImages(owner, Object.values(avatarUrls(previous))));
      }
      if (!current()) return;
      await ctx.storage(() => saveLastUser(user));
      if (!current()) return;
      // Another account than the device last saw: its own snapshot, if this device has one.
      await restore(user.id, version, true);
    } catch (error) {
      if (!current()) return;
      if (patient && waitsOut(error)) {
        await pause();
        return current() ? load({ patient }) : undefined;
      }
      if (unavailable(error) || limited(error)) {
        if (error instanceof ApiError && error.status === 0) ctx.patch({ online: false });
        else ctx.fail(error);
        session(last, {}, { version, failure: failureOf(error) });
        await restore(last?.id, version, false);
        return;
      }
      // The server ended a session this app was showing (23-72b): the sign-in says so, and input that is unsaved is never dropped for it.
      // A remembered session that the server never confirmed in this run (the instant start) is gone silently, like a start as a guest.
      const ended = !!ctx.read().user && error instanceof ApiError && error.status === 401;
      // Unsaved input is kept even for a remembered account (an offline start, then a reconnect): the writer saw that account.
      const kept = ended && navigation.hasUnsavedWork();
      const announce = ended && (sessions.checkingSession || sessions.confirmed === ctx.read().user?.id);
      if (ended) sessions.sessionEnded = true;
      if (kept) {
        // Shown once per account: a background load (resume, `online`, health poll) leaves the page and the dialog as they are.
        const quiet = !sessions.checkingSession && sessions.keptShownFor === ctx.read().user?.id;
        if (quiet) ctx.step(version, ENDED, reachable());
        else {
          sessions.keptShownFor = ctx.read().user?.id ?? null;
          ctx.step(version, ENDED, { ...reachable(), authOpen: true, authNotice: 'sessionEndedKept' });
          void loadAuthOptions();
        }
        return;
      }
      // The account on screen as well as `lastUser`: another tab's sign-out may have forgotten `lastUser` while a load of this tab
      // saved the shown account's snapshot again (FE-12).
      const ownersToClear = new Set([ctx.read().user?.id, last?.id].filter((id): id is string => !!id));
      user = null;
      sessions.confirmed = null;
      session(null);
      // The dead session still gets the logout, then the cache clearing (`clearHttpCache`), which empties the browser's HTTP cache of
      // this account's club and private photos, which a shared computer would keep (the terms promise otherwise). Best effort; not
      // for a kept-input end.
      const loggedOut = ended
        ? api
            .logout()
            .then(clearHttpCache, () => undefined)
            .finally(resetCsrf)
        : undefined;
      if (announce) {
        ctx.patch({ authOpen: true, authNotice: 'sessionEnded' });
        void loadAuthOptions();
      }
      for (const id of ownersToClear) await ctx.storage(() => clearPrivateCache(id));
      if (!current()) return;
      await ctx.storage(() => saveLastUser(null));
      await loggedOut;
      if (!current()) return;
      await restore(null, version, true);
    }
    if (!current()) return;
    ctx.step(version, BEGIN_SHOWN);

    const owner = ownerOf(user?.id);
    type Next = Listings & { point: SyncPoint; changed: boolean };
    /** `answer` applied to `listings` at `base`, or the full listings it asks for; null when a newer load took over. */
    const settle = async (listings: Listings, base: SyncPoint, answer: SyncView): Promise<Next | null> => {
      const outcome = applyDelta({ ...listings, point: base }, answer);
      if (outcome.kind === 'applied') {
        // Explore derives the new listing in the task that shows it: most of that goes ahead in tasks of its own. The `touched` check below runs after this wait.
        const route = ctx.read().route;
        if (outcome.changed && route.name === 'discover')
          await warmListing(outcome.listings.glazes, outcome.listings.combinations, listingOrder(activeSort(route.sort, route.type)));
        return { ...outcome.listings, point: outcome.point, changed: outcome.changed };
      }
      const full = await fullListings(user?.id, outcome.start, answer.visibleCombinations, version);
      return full && { ...full, changed: true };
    };
    const rest = () =>
      Promise.all([
        user ? api.stock() : Promise.resolve([]),
        user ? api.clubs() : Promise.resolve([]),
        user ? api.favorites() : Promise.resolve({ glazeIds: [], combinationIds: [] }),
        user ? api.buddies() : Promise.resolve(emptyBuddies()),
        user ? availabilityOf() : Promise.resolve(emptyAvailability()),
        user ? authorAvatarsOf() : Promise.resolve({}),
        api.favoriteCounts().catch(() => ctx.read().favoriteCounts ?? { glazes: [], combinations: [] }),
      ]);
    /** What a write patches in place; the answers of a load read before such a patch may predate it. */
    const shownData = () => {
      const { glazes, combinations, stock, clubs, clubMembers, buddies, buddyAvailability, authorAvatars, favorites, favoriteCounts } = ctx.read();
      return [glazes, combinations, stock, clubs, clubMembers, buddies, buddyAvailability, authorAvatars, favorites, favoriteCounts];
    };
    try {
      let before = shownData();
      const [listed, others] = await Promise.all([listingsOf(user?.id, version), rest()]);
      let [stock, clubs, favorites, buddies, buddyAvailability, authorAvatars, favoriteCounts] = others;
      // Every member may read the member list; it follows the clubs, so a role change shows at once and the club page works offline.
      let clubMembers = await membersOf(clubs);
      if (!current() || !listed) return;
      let next: Next | null = listed.kind === 'full' ? { ...listed, changed: true } : await settle(listed.listings, listed.base, listed.answer);
      // A write that patched the shown data while these answers travelled may be missing from them (a deleted combination
      // would come back), and the pages of a resumed load may be days old: ask again from the point just reached, since
      // an answer requested after the write includes it. At most twice; the next load catches up with anything later.
      const touched = () => shownData().some((value, index) => value !== before[index]);
      for (let round = 0; current() && next && round < 2 && (touched() || (round === 0 && listed.kind === 'full' && listed.resumed)); round++) {
        before = shownData();
        const reached: Next = next;
        const [answer, later] = await Promise.all([api.sync(reached.point), rest()]);
        [stock, clubs, favorites, buddies, buddyAvailability, authorAvatars, favoriteCounts] = later;
        clubMembers = await membersOf(clubs);
        if (!current()) return;
        const step = await settle(reached, reached.point, answer);
        next = step && { ...step, changed: reached.changed || step.changed };
      }
      if (!current() || !next) return;
      const { glazes, combinations, point, changed } = next;
      // The picture IDs of the lists are this session's answers now: downloads of them are allowed (lib/offline/offline.ts).
      avatarIdsConfirmed.set(true);
      // The `loading` phase ends with the data, not after the snapshot is saved: the guest welcome and the intro card would otherwise push the list down later.
      ctx.step(version, LOADED, {
        glazes,
        combinations,
        stock,
        clubs,
        clubMembers,
        buddies,
        buddyAvailability,
        authorAvatars,
        favorites,
        favoriteCounts,
        ...reachable(),
      });
      snapshot.synced = { owner, point };
      lastSync = Date.now();
      void loadAuthOptions();
      const saved = await persist(
        user?.id,
        { glazes, combinations, stock, clubs, clubMembers, buddies, buddyAvailability, authorAvatars, favorites, favoriteCounts },
        point,
        true,
      );
      // A later successful save ends an earlier, possibly transient, storage failure.
      if (saved && current() && ctx.read().storageWarning) ctx.patch({ storageWarning: false });
      // Pictures no longer listed (removed, moved or not shared any more) must not show offline.
      if (current() && changed) await pruneImageCache(user?.id, shownImageUrls({ glazes, combinations }));
    } catch (error) {
      if (!current()) return;
      if (patient && waitsOut(error)) {
        await pause();
        return current() ? load({ patient }) : undefined;
      }
      void ctx.fail(error);
      const failed: SyncEvent = { type: 'failed', failure: failureOf(error) };
      // Nothing shown: loading stays during the snapshot read (no "unavailable" flash). Shown: the failure and the end in one patch.
      if (isLoading(ctx.read().sync)) {
        ctx.step(version, failed);
        await restore(user?.id, version, false);
      } else ctx.step(version, [failed, ENDED]);
    }
  }

  function start() {
    const stopNavigation = navigation.start();
    openGrace();
    void load({ patient: true });
    const refresh = () => {
      if (navigator.onLine) {
        openGrace();
        void load({ patient: true });
      } else {
        offlineAt = ctx.ticket.now();
        ctx.patch({ online: false });
      }
    };
    // Back from the background the radio may still be waking, and the poll's timer was suspended: look again now, patiently.
    const resume = () => {
      if (globalThis.document?.visibilityState !== 'visible') return;
      openGrace();
      // Offline, failed or a sign-out to send (the health poll waited while hidden): look again now. Online: refresh by delta unless a
      // load runs or the last one is recent.
      const state = ctx.read();
      if (!state.online || state.sync.failure || sessions.pendingLogout || (!loadsRunning && Date.now() - lastSync >= RESUME_SYNC_MS))
        void load({ patient: true });
    };
    let feedTimer: ReturnType<typeof setTimeout> | undefined;
    let feedDelay = FEED_POLL_MS;
    let stopped = false;
    const feedLater = () => {
      clearTimeout(feedTimer);
      if (!stopped) feedTimer = setTimeout(() => void checkFeed(), feedDelay);
    };
    const checkFeed = async () => {
      // Hidden: no timer until the page is visible again (`resume` asks at once).
      if (globalThis.document?.visibilityState === 'hidden') return;
      const state = ctx.read();
      const asked = state.user;
      const memory = requests;
      if (asked && state.online && !sessions.pendingLogout && !sessions.signIns && !loadsRunning && !isLoading(state.sync)) {
        try {
          const badge = await api.feedBadge();
          feedDelay = FEED_POLL_MS;
          // Only onto the account object it was asked for: another account, a load's `/me` or a "seen" that answered meanwhile
          // knows better (the next interval asks again).
          const user = ctx.read().user;
          if (!stopped && user === asked && !loadsRunning && (user.feedUnread ?? 0) !== badge.unread) {
            const updated = { ...user, feedUnread: badge.unread };
            ctx.patch({ user: updated });
            await ctx.storage(() => saveLastUser(updated));
          }
          // FEED-2: a buddy request that arrived since the last answer gets one toast; patched only when the toast changes.
          const known = requests;
          if (!stopped && known === memory && ctx.read().user?.id === asked.id && !loadsRunning) {
            const now = ctx.read();
            const news = requestNews(known, badge, { known: now.buddies.incoming.map((buddy) => buddy.id), quiet: requestShownBy(now.route) });
            requests = news.memory;
            if (news.toast !== undefined && (news.toast !== null || now.requestToast !== null)) ctx.patch({ requestToast: news.toast });
          }
        } catch (error) {
          feedDelay = Math.min(feedDelay * 2, FEED_POLL_MAX_MS);
          // The session ended on the server: the same check as every other read (the sign-in instead of asking on).
          if (!stopped && error instanceof ApiError && error.status === 401) void ctx.fail(error, asked.id);
        }
      }
      feedLater();
    };
    feedLater();
    const resumeFeed = () => {
      if (globalThis.document?.visibilityState !== 'visible') return;
      feedDelay = FEED_POLL_MS;
      // A load started by `resume` reads the count with `/me`; without one the badge is asked for at once.
      if (loadsRunning) feedLater();
      else void checkFeed();
    };
    // Back online: the load of `refresh` reads the count; the poll starts again from the interval, not from a grown wait.
    const onlineFeed = () => {
      feedDelay = FEED_POLL_MS;
      feedLater();
    };
    window.addEventListener('online', onlineFeed);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    window.addEventListener('visibilitychange', resume);
    window.addEventListener('visibilitychange', resumeFeed);
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      // Hidden: nothing to show it to (`resume` looks at once when the page is visible again, FE-A4).
      if (globalThis.document?.visibilityState === 'hidden') return;
      try {
        await api.health();
        if (!ctx.read().online || ctx.read().sync.failure || sessions.pendingLogout) await load({ tryApi: true });
      } catch (error) {
        if (limited(error)) return;
        if (waitsOut(error)) retryTimer = setTimeout(check, RETRY_DELAY_MS);
        else ctx.patch({ online: false });
      }
    };
    const poll = setInterval(check, 15000);
    return () => {
      stopNavigation();
      ctx.ticket.cancel();
      clearInterval(poll);
      clearTimeout(retryTimer);
      stopped = true;
      clearTimeout(feedTimer);
      window.removeEventListener('visibilitychange', resumeFeed);
      window.removeEventListener('online', onlineFeed);
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
      window.removeEventListener('visibilitychange', resume);
    };
  }

  /**
   * A profile picture answered 404 (replaced or removed since the lists were read): reads the lists that name pictures again, at most
   * once per `AVATAR_REFRESH_MS`, so the next render asks for the new ID instead of the old one (which is never asked twice). Silent;
   * not while a load runs (it brings the lists anyway), offline or signed out.
   */
  let lastAvatarRefresh = 0;
  async function refreshAvatarIds() {
    const actor = ctx.read().user?.id;
    if (!actor || !ctx.read().online || isLoading(ctx.read().sync) || loadsRunning || Date.now() - lastAvatarRefresh < AVATAR_REFRESH_MS) return;
    lastAvatarRefresh = Date.now();
    try {
      const [authorAvatars, clubMembers] = await Promise.all([authorAvatarsOf(), membersOf(ctx.read().clubs)]);
      if (ctx.stale(actor) || loadsRunning) return;
      const changes: AppPatch = {};
      if (JSON.stringify(authorAvatars) !== JSON.stringify(ctx.read().authorAvatars)) changes.authorAvatars = authorAvatars;
      if (JSON.stringify(clubMembers) !== JSON.stringify(ctx.read().clubMembers)) changes.clubMembers = clubMembers;
      if (Object.keys(changes).length) {
        ctx.patch(changes);
        await ctx.saveCurrent(actor);
      }
      await reloadBuddies();
    } catch {
      /* The next load reports it. */
    }
  }
  onAvatarGone(() => void refreshAvatarIds());

  return { load, start, refreshAvatarIds };
}
