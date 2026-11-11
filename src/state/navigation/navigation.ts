import { isTokenRoute, parseRoute, routeHref, routeKey, withoutPhotoPointer, type Route } from '../../lib/routing/routes';
import { afterViewerPop, skipStaleViewerEntry } from '../../lib/images/viewer-history';
import type { AppPatch, AppState, LeaveGuard } from '../app/app-state';

/** How long after "Discard" an unload passes without the browser's own question. */
const UNLOAD_GRACE_MS = 10 * 1000;

/** What the controller keeps in `history.state` (next to the list positions `PagedGrid` saves there). */
export interface NavigationMarker {
  session: string;
  previous: Route | null;
}

/**
 * The route to remember as the predecessor of `route`: the one before it in this controller session
 * (`marker`), the stored one when the entry is replaced, none for an entry of another session, the
 * current route for a fresh entry. A token route, an unknown page or `route` itself is never kept, and the
 * one-time `photo` pointer of an item link is dropped: history holds no tokens, item metadata or account data.
 */
export function previousRouteFor({
  marker,
  session,
  replace,
  stored,
  current,
  route,
}: {
  marker: NavigationMarker | null | undefined;
  session: string;
  replace: boolean;
  stored: Route | null;
  current: Route;
  route: Route;
}): Route | null {
  const previous = replace
    ? stored
    : marker?.session === session
      ? marker.previous
      : marker
        ? null // An entry from another controller session has no known predecessor here.
        : current;
  const kept = previous && withoutPhotoPointer(previous);
  return kept && !isTokenRoute(kept) && kept.name !== 'not-found' && routeHref(kept) !== routeHref(withoutPhotoPointer(route)) ? kept : null;
}

/**
 * History and navigation: the hash listener, leave guards and the recorded predecessor.
 * `patch` is the controller's store update and `read` its state.
 */
export function createNavigation({ read, patch }: { read: () => AppState; patch: (changes: AppPatch) => void }) {
  /**
   * Pages with unsaved input (a Studio draft, the add-glaze form) register a guard while mounted;
   * leaving such a page for another one asks first (`leaving`). The controller's own navigation
   * (after a save, sign-out, used links) does not ask.
   */
  const guards = new Set<LeaveGuard>();
  const unsaved = (route: Route) => (routeKey(route) === routeKey(read().route) ? undefined : [...guards].find((g) => g.dirty()));
  /** Whether any page has unsaved work: the one definition behind a leave question and an app update's reload question. */
  const hasUnsavedWork = () => [...guards].some((guard) => guard.dirty());
  /** The next hash from approved navigation (including a successful save or sign-out). */
  let allowed: string | null = null;

  function registerLeaveGuard(guard: LeaveGuard): () => void {
    guards.add(guard);
    // A page registers again when its question changes (a held save that started sending can no longer
    // be discarded): an open question takes the new wording and keeps its target.
    const open = read().leaving;
    if (open && [...guards].find((other) => other.dirty()) === guard) ask(open.route, open.replace, guard);
    return () => {
      guards.delete(guard);
    };
  }

  // The marker distinguishes traversal from a fresh hash entry, including after back/forward.
  // Only the previous safe route is stored: never item metadata, account data or raw tokens.
  const navigationSession = Math.random().toString(36).slice(2);
  let trackingHistory = false;
  function recordRoute(route: Route, replace = false) {
    if (!trackingHistory) return;
    const previousRoute = previousRouteFor({
      marker: history.state?.glazelabNavigation,
      session: navigationSession,
      replace,
      stored: read().previousRoute,
      current: read().route,
      route,
    });
    history.replaceState(
      {
        ...history.state,
        glazelabNavigation: { session: navigationSession, previous: previousRoute },
      },
      '',
      routeHref(route),
    );
    patch({ previousRoute });
  }

  /** The hash listener applies the same unsaved-input guard to a back link as to browser Back. */
  function back(fallback: Route) {
    if (read().previousRoute) afterViewerPop(() => history.back());
    else navigate(fallback);
  }

  function ask(route: Route, replace: boolean, { message, body, leave }: LeaveGuard) {
    patch({ leaving: { route, replace, message, ...(body ? { body } : {}), ...(leave ? { leave } : {}) } });
  }

  /** Navigation by the user: asks before leaving unsaved input, otherwise like `go`. */
  function navigate(route: Route, { replace = false } = {}) {
    const guard = unsaved(route);
    if (guard) ask(route, replace, guard);
    else go(route, { replace });
  }

  /** "Discard": leaves without asking again. */
  function leaveAnyway() {
    const leaving = read().leaving;
    if (!leaving) return;
    for (const guard of guards) if (guard.dirty()) guard.discard?.();
    patch({ leaving: null });
    go(leaving.route, { replace: leaving.replace });
  }

  /**
   * Pushes a history entry (back/forward work), or replaces it, e.g. to drop a used token or to
   * follow typing in a search. Replacing within the same page keeps the entry's state (the list
   * positions PagedGrid saves there). An open photo viewer is a history entry of the page (24-11): it is popped
   * first, so the new entry follows the page's own and Back never lands on the viewer.
   */
  function go(route: Route, options: { replace?: boolean } = {}) {
    afterViewerPop(() => goNow(route, options));
  }

  function goNow(route: Route, { replace = false } = {}) {
    const href = routeHref(route);
    if (replace) {
      const samePage = routeKey(route) === routeKey(read().route);
      history.replaceState(samePage ? history.state : null, '', href);
      showRoute(route, true);
    } else if (location.hash !== href) {
      // User navigation has already passed its guard; controller navigation is approved too.
      allowed = href;
      location.hash = href;
    }
  }

  /**
   * Counts the changes of page; a write that outlives its page compares it to see whether the writer
   * is still where the write started (the same route reached again later is a new visit).
   */
  let visit = 0;

  /** Another page starts at the top and closes dialogs; a filter change on the same page does not. */
  function showRoute(route: Route, replace = false) {
    recordRoute(route, replace);
    const changed = routeKey(route) !== routeKey(read().route);
    if (changed) {
      visit++;
      window.scrollTo(0, 0);
    }
    patch({
      route,
      ...(changed
        ? {
            authOpen: false,
            uploadFor: null,
            removingImage: null,
            changingPassword: false,
            feedbackOpen: false,
            formError: null,
            // The page that lists or answers the request takes over from its toast (FEED-2).
            ...(route.name === 'account' || route.name === 'activity' ? { requestToast: null } : {}),
            // Like `closeAccountDeletion`; `leaving` is the question about this very navigation.
            ...(read().deletingAccount ? { deletingAccount: false, error: '' } : {}),
          }
        : {}),
    });
  }

  const followHash = () => {
    const route = parseRoute(location.hash);
    const pass = allowed === routeHref(route);
    allowed = null;
    const guard = pass ? undefined : unsaved(route);
    if (!guard) return showRoute(route);
    // A hash change (link, back or forward) cannot be cancelled: put this page's link back
    // without remounting it, and ask. "Discard" then replaces it with the target.
    history.replaceState(history.state, '', routeHref(read().route));
    recordRoute(read().route);
    ask(route, true, guard);
  };

  // Reloading or closing the tab with unsaved input asks through the browser's own prompt, unless the user
  // has just discarded it (an app update's reload): the permission covers that one unload and ends if it never comes.
  let unloadAllowed = false;
  let unloadTimer: ReturnType<typeof setTimeout> | undefined;
  function allowUnload() {
    unloadAllowed = true;
    clearTimeout(unloadTimer);
    unloadTimer = setTimeout(() => (unloadAllowed = false), UNLOAD_GRACE_MS);
  }
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (unloadAllowed) {
      unloadAllowed = false;
      clearTimeout(unloadTimer);
      return;
    }
    if (!hasUnsavedWork()) return;
    event.preventDefault();
    event.returnValue = '';
  };

  /** Starts recording history and following the hash; the returned function stops both. */
  function start() {
    trackingHistory = true;
    patch({ previousRoute: null });
    skipStaleViewerEntry(); // The page was reloaded or restored on a viewer entry.
    recordRoute(read().route, true);
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('hashchange', followHash);
    window.addEventListener('popstate', skipStaleViewerEntry);
    return () => {
      trackingHistory = false;
      window.removeEventListener('popstate', skipStaleViewerEntry);
      window.removeEventListener('hashchange', followHash);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }

  return {
    start,
    navigate,
    go,
    back,
    registerLeaveGuard,
    hasUnsavedWork,
    allowUnload,
    leaveAnyway,
    stay: () => patch({ leaving: null }),
    visit: () => visit,
  };
}
