/**
 * The full-screen photo viewer as a history entry (24-11), so the browser's and Android's Back close it instead
 * of leaving the page. The entry has the page's own URL (the hash is never written, so no `hashchange` and no
 * routing) and a copy of the page's `history.state`; a token in it tells it from the page's entries.
 *
 * One rule keeps the history free of dead entries: the viewer's entry is only ever the newest one, and whoever
 * ends the viewer removes it with `history.back()` while it is still the current entry. That is `leaveViewer`
 * (Escape, Close, backdrop, and every unmount of the viewer: an emptied list, an account change, a route change),
 * and `afterViewerPop` makes the app's own navigation (`go`, `back` in `state/navigation/navigation.ts`) wait for that pop so
 * a queued `back()` can never land after a new entry. A stale entry (the page reloaded or restored on it, or
 * reached again with Forward) is skipped by `skipStaleViewerEntry`. Only a hash typed into the address bar while
 * the viewer is open can leave an entry behind (the skip then handles the way back).
 */

const KEY = 'glazelabViewer';
/** How long the pop of the entry may take before the viewer is closed without it (a browser that never answers). */
const POP_TIMEOUT_MS = 1000;

interface Active {
  token: string;
  /** The entry is gone (Back, or the pop `leaveViewer` asked for): the viewer must close. */
  gone: () => void;
}

let active: Active | null = null;
let popping = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let waiting: Array<() => void> = [];

const tokenOf = (state: unknown): unknown => (state && typeof state === 'object' ? (state as Record<string, unknown>)[KEY] : undefined);

/** Whether the current history entry is a viewer entry (of any viewer, also one from an earlier page load). */
export const isViewerEntry = (): boolean => tokenOf(globalThis.history?.state) !== undefined;

/** Whether the current entry is the one of the viewer that is open now. */
const onOwnEntry = (): boolean => !!active && tokenOf(globalThis.history?.state) === active.token;

function onPopState() {
  if (active && !onOwnEntry()) finish(true);
}

/** The entry is gone or was never there: the viewer is over, and what waited for it goes on. */
function finish(notify: boolean) {
  const ended = active;
  active = null;
  popping = false;
  clearTimeout(timer);
  if (typeof window !== 'undefined') window.removeEventListener('popstate', onPopState);
  if (notify) ended?.gone();
  const run = waiting;
  waiting = [];
  for (const callback of run) callback();
}

/**
 * Pushes the viewer's entry (the same URL); `gone` is called when Back or a pop removed it. Returns false when
 * the browser refused or another viewer's entry is open, and the viewer then works without an entry. The whole
 * state of the entry below is copied (the list positions of `PagedGrid`, the navigation marker, ...), so a reload
 * or restore on the viewer's entry finds the page's own state, and the viewer's token is added to it.
 */
export function enterViewer(gone: () => void): boolean {
  if (active || typeof history === 'undefined' || typeof window === 'undefined') return false;
  const token = Math.random().toString(36).slice(2);
  try {
    const state = history.state && typeof history.state === 'object' ? (history.state as Record<string, unknown>) : {};
    history.pushState({ ...state, [KEY]: token }, '', location.href);
  } catch {
    return false;
  }
  active = { token, gone };
  window.addEventListener('popstate', onPopState);
  return true;
}

/**
 * `enterViewer` for a viewer component: the returned function ends the entry THIS viewer pushed (like `leaveViewer`,
 * which it returns the answer of) and does nothing, answering false, for a viewer that has no entry of its own or whose
 * entry is over: with several viewers possible (one per card) a viewer without an entry must never pop another's.
 */
export function holdViewerEntry(gone: () => void): () => boolean {
  if (!enterViewer(gone)) return () => false;
  const mine = active;
  return () => active === mine && leaveViewer();
}

/**
 * Ends the viewer's entry. While it is the current entry it is popped (`history.back()`) and `gone` runs on the
 * popstate; the return value says whether that will happen (false: there is no entry, close the viewer yourself).
 */
export function leaveViewer(): boolean {
  if (!active) return false;
  if (popping) return true;
  if (!onOwnEntry()) {
    finish(false);
    return false;
  }
  popping = true;
  timer = setTimeout(() => finish(true), POP_TIMEOUT_MS);
  history.back();
  return true;
}

/** Runs `run` once no viewer entry is the current one: at once, or after the pop it starts. */
export function afterViewerPop(run: () => void) {
  if (active && onOwnEntry()) leaveViewer();
  else if (active && !popping) finish(false);
  if (active) waiting.push(run);
  else run();
}

/**
 * An entry of a viewer that is not open (the page was reloaded or restored on it, or Forward reached it) shows
 * nothing and would be a second entry of the same page: step back over it.
 */
export function skipStaleViewerEntry() {
  if (isViewerEntry() && !onOwnEntry()) history.back();
}
