import { readonly, writable } from 'svelte/store';
import { Workbox } from 'workbox-window';

/** A new service worker is checked for every minute while the app is visible, and when it returns to the foreground. */
export const CHECK_INTERVAL_MS = 60 * 1000;
/** Switching back and forth between apps must not fetch the worker script each time. */
export const MIN_CHECK_GAP_MS = 60 * 1000;
/** While the notice shows, the "unsaved input" sentence follows the pages' guards at this pace. */
export const DRAFT_POLL_MS = 1000;

/** How long a reload offer waits for a waiting worker to take control before it reloads anyway (or recovers, see `afterSkipWaiting`). */
export const RELOAD_FALLBACK_MS = 3000;
/** The recovery's fetch of the new worker and its unregister get this long; the page reloads then, whatever they did. */
export const RECOVERY_LIMIT_MS = 2000;
/** `vite-plugin-pwa`'s Workbox precache: `workbox-precache-v2-<scope>` (read for the waiting build's label). */
const PRECACHE_PREFIX = 'workbox-precache';

/** Set once this page has asked for the new version (Refresh, a reload offer): the takeover that follows is its own reload. */
let accepted = false;

/**
 * What a reload offer does when the waiting worker has not taken control within `RELOAD_FALLBACK_MS` (pure). A worker that started
 * activating (or was replaced) is on its way: a plain reload, whose navigation waits for the activation. A worker still `installed` never
 * acted on the skip-waiting message, or the message could not be sent (`unreachable`): a plain reload would bring the old version and the
 * notice back, so the registration is recovered, unless the app is offline, where a page without its worker would not load.
 */
export function afterSkipWaiting(worker: 'unreachable' | { state: ServiceWorkerState }, online: boolean): 'reload' | 'recover' {
  if (!online) return 'reload';
  return worker === 'unreachable' || worker.state === 'installed' ? 'recover' : 'reload';
}

/**
 * The hard recovery when a waiting worker does not activate, what unregistering by hand did for users: the registration goes (tabs it
 * controls keep it until the new one claims them), so the reload loads the current build from the network and installs its worker
 * afresh, which controls the page at once (`clientsClaim`) without a skip-waiting message. Unregistering leaves an installed app without
 * its offline shell until that reload succeeds, so it runs only after the new worker script was fetched from the network (a network that
 * fails, or a server answering an error during a deployment, keeps the old worker: a plain reload, the notice back). No cache is deleted:
 * a tab with unsaved input still runs under the old worker from its precache, and the new worker's activation tidies the precache. A step
 * that fails or outlasts `RECOVERY_LIMIT_MS` (storage restricted by privacy settings) ends the recovery: the page reloads anyway.
 */
async function recover(registration: ServiceWorkerRegistration, script: string): Promise<void> {
  console.warn('glazelab: the new version did not take over; its service worker is installed afresh');
  let late = false;
  const work = (async () => {
    const reachable = await fetch(script, { cache: 'no-store' }).then(
      (response) => response.ok,
      () => false,
    );
    if (!reachable || late) return;
    await registration.unregister().catch(() => false);
  })();
  await Promise.race([work, new Promise((resolve) => setTimeout(resolve, RECOVERY_LIMIT_MS))]);
  late = true;
}

/**
 * Reloads into the newest version: Refresh, the reload offer of a lazily loaded chunk that failed (an older build's file is gone from
 * the server) or a crashed page. A plain reload keeps the old worker in control while a new one waits, so the old page and its missing
 * chunk would come back: a waiting worker is activated first (the skip-waiting message) and the page reloads once it controls it. A
 * worker that does not act on the message is recovered before the reload (`afterSkipWaiting`).
 */
export async function reloadApp(reload: () => void = () => location.reload()): Promise<void> {
  const container = navigator.serviceWorker;
  const registration = await container
    ?.getRegistration()
    .then((found) => found ?? undefined)
    .catch(() => undefined);
  const waiting = registration?.waiting;
  if (!container || !registration || !waiting) return reload();
  // Only an activation this page asked for is its own takeover; a plain reload that a leave question cancelled marks nothing.
  accepted = true;
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    container.removeEventListener('controllerchange', once);
    reload();
  };
  container.addEventListener('controllerchange', once);
  let reached = true;
  try {
    waiting.postMessage({ type: 'SKIP_WAITING' });
  } catch {
    // Firefox refuses `postMessage` where storage is restricted for the page: this worker can never be told.
    reached = false;
  }
  setTimeout(() => {
    if (done) return;
    if (afterSkipWaiting(reached ? waiting : 'unreachable', navigator.onLine !== false) === 'reload') return once();
    void recover(registration, waiting.scriptURL).finally(once);
  }, RELOAD_FALLBACK_MS);
}

/** The `<meta name>` that carries the build label in `index.html` (`versionMeta` in `scripts/build-version.ts`). */
export const VERSION_META = 'glazelab-version';

/** The build label in an `index.html` (pure); null for a build without one. */
export function versionIn(html: string): string | null {
  const match = new RegExp(`<meta\\s+name="${VERSION_META}"\\s+content="([^"]*)"`).exec(html);
  if (!match) return null;
  return match[1].replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

/**
 * The newest build label among the precached `index.html` copies, in the order they were stored, that is not the running one (pure):
 * while a worker waits, the precache holds its `index.html` beside the running build's.
 */
export function newerVersion(labels: (string | null)[], current: string): string | null {
  return labels.filter((label): label is string => !!label && label !== current).at(-1) ?? null;
}

/** The build a newer worker serves, read from its precached `index.html`; null when it cannot be told (no Cache API, an older build). */
export async function waitingVersion(current: string): Promise<string | null> {
  try {
    const labels: (string | null)[] = [];
    for (const name of (await caches.keys()).filter((key) => key.startsWith(PRECACHE_PREFIX))) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        if (new URL(request.url).pathname !== '/index.html') continue;
        const response = await cache.match(request);
        labels.push(response ? versionIn(await response.text()) : null);
      }
    }
    return newerVersion(labels, current);
  } catch {
    return null;
  }
}

/** What the service worker tells a page: a newer worker waits, or a worker took control of this page. */
export interface WorkerEvents {
  /** `worker`: the one that waits, when the source knows it. */
  onWaiting: (worker?: ServiceWorker) => void;
  /** `isUpdate`: the page was already controlled by a worker when it registered, so this is a newer one. */
  onControlling: (isUpdate: boolean) => void;
}

/** Registers the worker; resolves to its registration, or undefined where there is none (dev server, no service workers). */
export type Registrar = (events: WorkerEvents) => Promise<ServiceWorkerRegistration | undefined>;

/**
 * `workbox-window` without `virtual:pwa-register`, whose own `controlling` listener reloaded every tab when one accepted: here the
 * update controller decides what a takeover does to this tab (`takeover`).
 */
export const registerWorker: Registrar = async (events) => {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return undefined;
  const workbox = new Workbox('/sw.js', { scope: '/' });
  workbox.addEventListener('waiting', (event) => events.onWaiting(event.sw));
  workbox.addEventListener('controlling', (event) => events.onControlling(Boolean(event.isUpdate)));
  return workbox.register({ immediate: true });
};

export type Takeover = 'ignore' | 'reload' | 'defer';

/**
 * What a tab does when a worker takes control of it. Its own acceptance reloads through `reloadApp`, and a first worker claiming the
 * page that installed it serves the same build: nothing to do. A newer worker that another tab accepted reloads a tab without unsaved
 * work; a tab with unsaved work is never reloaded unasked and keeps its page until the work is saved or discarded.
 */
export function takeover(change: { newer: boolean; accepted: boolean; unsaved: boolean }): Takeover {
  if (change.accepted || !change.newer) return 'ignore';
  return change.unsaved ? 'defer' : 'reload';
}

export interface UpdateDeps {
  register: Registrar;
  /** Whether a page has unsaved work: a dirty leave guard (Studio draft or held save, add-glaze, glaze edit, scan sheet, upload). */
  hasUnsavedWork: () => boolean;
  /** The app can reach the network: no update check while it cannot. */
  online: () => boolean;
  /** Lets the next unload pass without the browser's own prompt: the user has just discarded the unsaved work. */
  allowUnload: () => void;
  now?: () => number;
  /** Reloads the page; the default is `location.reload`. */
  reload?: () => void;
  /** The build label of the newer worker (`waitingVersion`), shown beside the footer's version; none: never looked up. */
  nextVersion?: () => Promise<string | null>;
}

export interface UpdateState {
  /** A new version waits (or already took over this tab) and the notice has not been dismissed. */
  available: boolean;
  /** Unsaved work is open now: the notice says so, and Refresh asks first. */
  draft: boolean;
  /** Refresh was pressed with unsaved work: the leave question is open. */
  confirming: boolean;
  /** Another tab accepted the new version while this one had unsaved work: the page still runs the old one. */
  stale: boolean;
  /** The newer build's label, once known (from its precached `index.html`): the footer names it beside the running version. */
  next: string | null;
}

/**
 * The service worker's update lifecycle, independent of account and server state (like `install.ts`).
 * `registerType: 'prompt'`: a new worker waits until a tab accepts it (`refresh`, `reloadApp`), and it then takes over every tab
 * of the origin. A tab without unsaved work reloads; one with unsaved work keeps its page (`stale`, its notice shows and cannot be
 * put off) and reloads by itself once that work is saved or left. Nothing else reloads, and a reload with unsaved work waits for the
 * user's answer. Every path reloads at most once.
 */
export function createUpdateController(deps: UpdateDeps) {
  const initial: UpdateState = { available: false, draft: false, confirming: false, stale: false, next: null };
  const state = writable<UpdateState>(initial);
  let current = initial;
  const patch = (changes: Partial<UpdateState>) => state.set((current = { ...current, ...changes }));
  const now = deps.now ?? (() => Date.now());
  const reloadPage = deps.reload ?? (() => location.reload());
  let active = false;
  let announced = false;
  /** The waiting worker the notice was last raised for: a different one is a newer build. */
  let announcedWorker: ServiceWorker | undefined;
  /** Workers whose installation a check is already following. */
  const followed = new WeakSet<ServiceWorker>();
  let reloading = false;
  let registration: ServiceWorkerRegistration | undefined;
  let lastCheck = Number.NEGATIVE_INFINITY;
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }

  function reload() {
    if (reloading) return;
    reloading = true;
    stopPolling();
    reloadPage();
  }

  /** Follows the pages' guards while the notice shows; a stale tab whose work is gone reloads. */
  function follow() {
    const unsaved = deps.hasUnsavedWork();
    if (current.stale && !unsaved) return reload();
    patch({ draft: unsaved });
  }

  function showNotice(changes: Partial<UpdateState> = {}) {
    patch({ available: true, draft: deps.hasUnsavedWork(), ...changes });
    stopPolling();
    pollTimer = setInterval(follow, DRAFT_POLL_MS);
    lookUp();
  }

  /** Names the newer build, so a notice that keeps coming back tells whether it is the same build or yet another one. */
  function lookUp() {
    deps.nextVersion?.().then(
      (next) => {
        if (active && next) patch({ next });
      },
      () => {},
    );
  }

  /**
   * A worker is waiting: the notice shows, also after an earlier dismissal for another worker. The same worker reported again
   * (`workbox-window` some 200 ms after a check's own report) keeps a dismissal.
   */
  function waiting(worker?: ServiceWorker) {
    if (!active) return;
    const next = worker ?? registration?.waiting ?? undefined;
    if (next && next === announcedWorker) return;
    announced = true;
    announcedWorker = next;
    showNotice();
  }

  /**
   * `workbox-window` stops listening for a new worker after the first update it calls external (found more than a minute after
   * registration), so a later build is found here, after each check: the notice rises once its worker waits, unless it is the one
   * already announced (a dismissed notice stays dismissed until a different build waits).
   */
  function found(worker: ServiceWorker | null | undefined) {
    if (!worker || worker === announcedWorker || followed.has(worker)) return;
    if (worker.state === 'installed') return waiting(worker);
    if (worker.state !== 'installing') return;
    followed.add(worker);
    worker.addEventListener('statechange', function installed() {
      if (worker.state === 'installing') return;
      worker.removeEventListener('statechange', installed);
      if (worker.state === 'installed' && registration?.waiting === worker && worker !== announcedWorker) waiting(worker);
    });
  }

  /** A worker took control of this page: its own acceptance, a first install, or another tab's Refresh. */
  function controlling(isUpdate: boolean) {
    if (!active) return;
    const decision = takeover({ newer: isUpdate || announced, accepted, unsaved: deps.hasUnsavedWork() });
    if (decision === 'reload') reload();
    else if (decision === 'defer') showNotice({ stale: true });
  }

  /** Hides the notice until the next detection of a (newer) waiting worker; a stale tab keeps it. */
  function dismiss() {
    if (current.stale) return;
    stopPolling();
    patch({ available: false, draft: false, confirming: false });
  }

  function apply() {
    stopPolling();
    patch({ confirming: false });
    void reloadApp(reload);
  }

  /** Reloads into the new version, after asking when a page has unsaved work. */
  function refresh() {
    if (!active) return;
    if (deps.hasUnsavedWork()) patch({ confirming: true });
    else apply();
  }

  /** "Discard": the user accepted losing the unsaved work. */
  function discard() {
    if (!active) return;
    deps.allowUnload();
    apply();
  }

  /** "Stay": keeps the page and the notice. */
  function stay() {
    patch({ confirming: false });
  }

  /** Asks the browser for a newer worker script; offline or failing, it stays silent and the next check retries. */
  async function check(minGap = 0) {
    if (!active || !registration || !deps.online()) return;
    const at = now();
    if (at - lastCheck < minGap) return;
    lastCheck = at;
    try {
      await registration.update();
      // `update()` resolves while a new worker is still installing, possibly beside an older one that waits: both count.
      found(registration?.waiting);
      found(registration?.installing);
    } catch {
      /* Offline or the server failed: no notice, no error. */
    }
  }

  /** Registers the worker and starts the periodic and foreground checks; the returned function stops them. */
  function start() {
    active = true;
    deps
      .register({ onWaiting: waiting, onControlling: controlling })
      .then((registered) => {
        if (!active) return;
        registration = registered;
        void check();
      })
      .catch(() => {
        /* No service worker (private mode, unsupported browser, offline first visit): the app works without one. */
      });
    const visible = () => {
      if (document.visibilityState === 'visible') void check(MIN_CHECK_GAP_MS);
    };
    document.addEventListener('visibilitychange', visible);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void check();
    }, CHECK_INTERVAL_MS);
    return () => {
      active = false;
      registration = undefined;
      stopPolling();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }

  return { state: readonly(state), start, dismiss, refresh, discard, stay };
}
