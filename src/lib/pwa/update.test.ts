import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { CHECK_INTERVAL_MS, DRAFT_POLL_MS, MIN_CHECK_GAP_MS, RECOVERY_LIMIT_MS, RELOAD_FALLBACK_MS, takeover, type WorkerEvents } from './update';

// `reloadApp` remembers that this page accepted the update, so every test takes a fresh module.
let update: typeof import('./update');
let events: EventTarget & { visibilityState: string };
let unsaved: boolean;
let online: boolean;
let callbacks: WorkerEvents;
let allowUnload: ReturnType<typeof vi.fn>;
let registration: { update: ReturnType<typeof vi.fn>; waiting?: ServiceWorker | null; installing?: ServiceWorker | null };
let registered: (value?: unknown) => void;
let failRegistration: (error: unknown) => void;
let stop: (() => void) | undefined;
let worker: EventTarget & { getRegistration?: () => Promise<unknown> };
let waiting: { postMessage: ReturnType<typeof vi.fn> } | null;
let reload: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  update = await import('./update');
  vi.useFakeTimers();
  events = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('document', events);
  unsaved = false;
  online = true;
  allowUnload = vi.fn();
  registration = { update: vi.fn(async () => {}) };
  waiting = { postMessage: vi.fn() };
  worker = Object.assign(new EventTarget(), { getRegistration: async () => ({ waiting }) });
  vi.stubGlobal('navigator', { serviceWorker: worker });
  reload = vi.fn();
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function started() {
  const controller = update.createUpdateController({
    register: (given) => {
      callbacks = given;
      return new Promise((resolve, reject) => {
        registered = () => resolve(registration as unknown as ServiceWorkerRegistration);
        failRegistration = reject;
      });
    },
    hasUnsavedWork: () => unsaved,
    online: () => online,
    allowUnload: allowUnload as unknown as () => void,
    now: () => Date.now(),
    reload: reload as unknown as () => void,
  });
  stop = controller.start();
  return controller;
}
/** The registration resolves and its first check runs. */
const connected = async () => {
  registered();
  await vi.advanceTimersByTimeAsync(0);
};
const hide = (state: 'hidden' | 'visible') => {
  events.visibilityState = state;
  events.dispatchEvent(new Event('visibilitychange'));
};
/** The new worker takes control: `workbox-window` reports `controlling`, the container `controllerchange`. */
const takeOver = (isUpdate = true) => {
  worker.dispatchEvent(new Event('controllerchange'));
  callbacks.onControlling(isUpdate);
};
const initial = { available: false, draft: false, confirming: false, stale: false, next: null };

describe('takeover decision', () => {
  it.each([
    [{ newer: true, accepted: false, unsaved: false }, 'reload'],
    [{ newer: true, accepted: false, unsaved: true }, 'defer'],
    [{ newer: true, accepted: true, unsaved: true }, 'ignore'],
    [{ newer: true, accepted: true, unsaved: false }, 'ignore'],
    [{ newer: false, accepted: false, unsaved: false }, 'ignore'],
    [{ newer: false, accepted: false, unsaved: true }, 'ignore'],
  ] as const)('%o -> %s', (change, expected) => {
    expect(takeover(change)).toBe(expected);
  });
});

describe('update notice', () => {
  it('shows when a worker waits and hides on dismiss until the next detection', () => {
    const controller = started();
    expect(get(controller.state)).toEqual(initial);
    callbacks.onWaiting();
    expect(get(controller.state).available).toBe(true);
    controller.dismiss();
    expect(get(controller.state).available).toBe(false);
    vi.advanceTimersByTime(CHECK_INTERVAL_MS * 2);
    expect(get(controller.state).available).toBe(false);
    callbacks.onWaiting();
    expect(get(controller.state).available).toBe(true);
  });

  it('refreshes by activating the waiting worker and reloads once when it takes control, without asking when nothing is unsaved', async () => {
    const controller = started();
    callbacks.onWaiting();
    controller.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(waiting?.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'SKIP_WAITING' });
    expect(allowUnload).not.toHaveBeenCalled();
    expect(get(controller.state).confirming).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    takeOver();
    takeOver();
    vi.advanceTimersByTime(RELOAD_FALLBACK_MS);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('asks first when work is unsaved: Stay keeps everything, Discard allows the unload and refreshes', async () => {
    const controller = started();
    callbacks.onWaiting();
    unsaved = true;
    controller.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(waiting?.postMessage).not.toHaveBeenCalled();
    expect(get(controller.state)).toMatchObject({ available: true, confirming: true });
    controller.stay();
    expect(get(controller.state)).toMatchObject({ available: true, confirming: false });
    controller.refresh();
    controller.discard();
    await vi.advanceTimersByTimeAsync(0);
    expect(allowUnload).toHaveBeenCalledOnce();
    expect(waiting?.postMessage).toHaveBeenCalledOnce();
    expect(get(controller.state).confirming).toBe(false);
    // Its own acceptance: the takeover reloads although the guard is still dirty (the user discarded it).
    takeOver();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('says so while work is unsaved and follows it until dismissed', () => {
    unsaved = true;
    const controller = started();
    callbacks.onWaiting();
    expect(get(controller.state).draft).toBe(true);
    unsaved = false;
    vi.advanceTimersByTime(DRAFT_POLL_MS);
    expect(get(controller.state).draft).toBe(false);
    unsaved = true;
    vi.advanceTimersByTime(DRAFT_POLL_MS);
    expect(get(controller.state).draft).toBe(true);
    controller.dismiss();
    expect(vi.getTimerCount()).toBe(1); // only the hourly check remains
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('another tab accepts the update', () => {
  it('reloads a tab without unsaved work once, also after Later', () => {
    const controller = started();
    callbacks.onWaiting();
    controller.dismiss();
    takeOver();
    takeOver();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('keeps a tab with unsaved work and its notice, and reloads it once the work is saved or left', () => {
    const controller = started();
    callbacks.onWaiting();
    controller.dismiss();
    unsaved = true;
    takeOver();
    expect(reload).not.toHaveBeenCalled();
    expect(get(controller.state)).toEqual({ available: true, draft: true, confirming: false, stale: true, next: null });
    // The notice cannot be put off: the tab already runs under the new worker.
    controller.dismiss();
    expect(get(controller.state).available).toBe(true);
    vi.advanceTimersByTime(DRAFT_POLL_MS * 5);
    expect(reload).not.toHaveBeenCalled();
    unsaved = false;
    vi.advanceTimersByTime(DRAFT_POLL_MS);
    expect(reload).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(DRAFT_POLL_MS * 5);
    takeOver();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('lets a kept tab discard its work: the reload asks first and passes the browser question', async () => {
    const controller = started();
    callbacks.onWaiting();
    unsaved = true;
    takeOver();
    waiting = null; // the accepting tab activated it
    controller.refresh();
    expect(get(controller.state)).toMatchObject({ confirming: true, stale: true });
    controller.stay();
    expect(reload).not.toHaveBeenCalled();
    controller.refresh();
    controller.discard();
    await vi.advanceTimersByTimeAsync(0);
    expect(allowUnload).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads a clean tab that missed the waiting notice when a newer worker takes over', () => {
    started();
    takeOver(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('treats a takeover as newer once the page announced a waiting worker, even if no worker controlled it at registration', () => {
    const controller = started();
    callbacks.onWaiting();
    unsaved = true;
    takeOver(false);
    expect(get(controller.state)).toMatchObject({ available: true, stale: true });
    unsaved = false;
    takeOver(false);
    vi.advanceTimersByTime(DRAFT_POLL_MS);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('follows the guards with one poll however often the notice is raised', () => {
    const controller = started();
    callbacks.onWaiting();
    callbacks.onWaiting();
    unsaved = true;
    takeOver();
    controller.dismiss();
    expect(vi.getTimerCount()).toBe(2); // the hourly check and the stale tab's one poll
  });

  it('leaves a page alone when the first worker claims it', () => {
    const controller = started();
    takeOver(false);
    expect(reload).not.toHaveBeenCalled();
    expect(get(controller.state)).toEqual(initial);
  });

  it('ignores a takeover after the controller stopped', () => {
    started();
    callbacks.onWaiting();
    stop?.();
    stop = undefined;
    takeOver();
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads only through the reload offer when that offer activated the worker', async () => {
    started();
    callbacks.onWaiting();
    await update.reloadApp(reload as unknown as () => void);
    takeOver();
    expect(reload).toHaveBeenCalledOnce();
  });

  // A plain reload (nothing waiting) that the browser's leave question cancelled must not hide a later takeover from this page.
  it('keeps a page with unsaved work when an offer found nothing waiting and another tab accepts later', async () => {
    waiting = null;
    const plain = vi.fn();
    const controller = started();
    await update.reloadApp(plain as unknown as () => void);
    expect(plain).toHaveBeenCalledOnce();
    unsaved = true;
    takeOver();
    expect(get(controller.state)).toMatchObject({ available: true, stale: true });
    unsaved = false;
    vi.advanceTimersByTime(DRAFT_POLL_MS);
    expect(reload).toHaveBeenCalledOnce();
  });
});

describe('update checks', () => {
  it('checks on registration, then every minute, and stops with the controller', async () => {
    started();
    await connected();
    expect(registration.update).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(registration.update).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(registration.update).toHaveBeenCalledTimes(3);
    stop?.();
    stop = undefined;
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 3);
    expect(registration.update).toHaveBeenCalledTimes(3);
  });

  it('does not check on the timer while the app is hidden', async () => {
    started();
    await connected();
    registration.update.mockClear();
    hide('hidden');
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 3);
    expect(registration.update).not.toHaveBeenCalled();
    hide('visible');
    registration.update.mockClear();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it('checks when the app returns to the foreground, at most once a minute, never while hidden', async () => {
    started();
    await connected();
    registration.update.mockClear();
    hide('hidden');
    vi.setSystemTime(Date.now() + MIN_CHECK_GAP_MS * 2);
    expect(registration.update).not.toHaveBeenCalled();
    hide('visible');
    expect(registration.update).toHaveBeenCalledTimes(1);
    hide('visible');
    expect(registration.update).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + MIN_CHECK_GAP_MS);
    hide('visible');
    expect(registration.update).toHaveBeenCalledTimes(2);
  });

  it('does not check while offline and checks again once back online', async () => {
    started();
    online = false;
    await connected();
    hide('visible');
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(registration.update).not.toHaveBeenCalled();
    online = true;
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it('stays silent when a check fails', async () => {
    registration.update.mockRejectedValue(new TypeError('Failed to fetch'));
    const controller = started();
    await connected();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(registration.update).toHaveBeenCalledTimes(2);
    expect(get(controller.state)).toEqual(initial);
  });

  it('stays silent and never checks when the worker cannot register', async () => {
    const controller = started();
    failRegistration(new Error('no service worker'));
    hide('visible');
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(registration.update).not.toHaveBeenCalled();
    expect(get(controller.state)).toEqual(initial);
  });

  it('does nothing without a registration', async () => {
    started();
    hide('visible');
    expect(registration.update).not.toHaveBeenCalled();
  });

  it('stops the foreground check with the controller', async () => {
    started();
    await connected();
    registration.update.mockClear();
    stop?.();
    stop = undefined;
    vi.setSystemTime(Date.now() + MIN_CHECK_GAP_MS * 2);
    hide('visible');
    expect(registration.update).not.toHaveBeenCalled();
  });
});

describe('a newer build after the first one', () => {
  /** A fake service worker: a state and `statechange`. */
  const build = (state: ServiceWorker['state']) => Object.assign(new EventTarget(), { state }) as unknown as ServiceWorker & { state: ServiceWorker['state'] };
  const checkNow = () => vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);

  it('raises the notice again for a different waiting worker after Later, which `workbox-window` no longer reports', async () => {
    const controller = started();
    await connected();
    const second = build('installed');
    const third = build('installed');
    callbacks.onWaiting(second);
    controller.dismiss();
    registration.waiting = second;
    await checkNow();
    expect(get(controller.state).available).toBe(false);
    registration.waiting = third;
    await checkNow();
    expect(get(controller.state).available).toBe(true);
    controller.dismiss();
    await checkNow();
    expect(get(controller.state).available).toBe(false);
  });

  it('follows a worker that is still installing when the check returns, and raises the notice once it waits', async () => {
    const controller = started();
    await connected();
    const next = build('installing');
    registration.installing = next;
    await checkNow();
    expect(get(controller.state).available).toBe(false);
    Object.assign(next, { state: 'installed' });
    registration.installing = null;
    registration.waiting = next;
    next.dispatchEvent(new Event('statechange'));
    expect(get(controller.state).available).toBe(true);
    controller.dismiss();
    next.dispatchEvent(new Event('statechange'));
    expect(get(controller.state).available).toBe(false);
  });

  // `update()` resolves once the new worker is installing, so the dismissed one still waits beside it.
  it('follows a newer worker installing beside the dismissed waiting one', async () => {
    const controller = started();
    await connected();
    const second = build('installed');
    callbacks.onWaiting(second);
    controller.dismiss();
    const third = build('installing');
    registration.waiting = second;
    registration.installing = third;
    await checkNow();
    expect(get(controller.state).available).toBe(false);
    Object.assign(third, { state: 'installed' });
    registration.installing = null;
    registration.waiting = third;
    third.dispatchEvent(new Event('statechange'));
    expect(get(controller.state).available).toBe(true);
  });

  it('follows an installing worker with one listener over several checks, removes it once installed, and keeps a notice put off for it hidden', async () => {
    const controller = started();
    await connected();
    const next = build('installing');
    const add = vi.spyOn(next, 'addEventListener');
    const remove = vi.spyOn(next, 'removeEventListener');
    registration.installing = next;
    await checkNow();
    await checkNow();
    expect(add).toHaveBeenCalledOnce();
    Object.assign(next, { state: 'installed' });
    registration.installing = null;
    registration.waiting = next;
    // `workbox-window` may report the same worker first; Later then holds for it.
    callbacks.onWaiting(next);
    controller.dismiss();
    next.dispatchEvent(new Event('statechange'));
    expect(remove).toHaveBeenCalledWith('statechange', add.mock.calls[0][1]);
    expect(get(controller.state).available).toBe(false);
  });

  // `workbox-window` reports a worker it follows itself some 200 ms after it is installed, so the check's own report comes first.
  it('keeps a notice put off when `workbox-window` reports the same worker after the check did', async () => {
    const controller = started();
    await connected();
    const next = build('installing');
    registration.installing = next;
    await checkNow();
    Object.assign(next, { state: 'installed' });
    registration.installing = null;
    registration.waiting = next;
    next.dispatchEvent(new Event('statechange'));
    expect(get(controller.state).available).toBe(true);
    controller.dismiss();
    callbacks.onWaiting(next);
    expect(get(controller.state).available).toBe(false);
  });

  it('remembers the waiting worker of a report that names none', async () => {
    const controller = started();
    await connected();
    registration.waiting = build('installed');
    callbacks.onWaiting();
    controller.dismiss();
    await checkNow();
    expect(get(controller.state).available).toBe(false);
  });

  it('stays quiet for a worker that turns redundant, and for one already announced', async () => {
    const controller = started();
    await connected();
    const failed = build('installing');
    registration.installing = failed;
    await checkNow();
    Object.assign(failed, { state: 'redundant' });
    failed.dispatchEvent(new Event('statechange'));
    expect(get(controller.state).available).toBe(false);
    const known = build('installed');
    callbacks.onWaiting(known);
    controller.dismiss();
    registration.waiting = known;
    await checkNow();
    hide('visible');
    expect(get(controller.state).available).toBe(false);
  });

  it('does not announce a waiting worker twice when the start check finds the one `workbox-window` reported', async () => {
    const controller = started();
    const first = build('installed');
    registration.waiting = first;
    callbacks.onWaiting(first);
    controller.dismiss();
    await connected();
    expect(registration.update).toHaveBeenCalledOnce();
    expect(get(controller.state).available).toBe(false);
  });
});

describe('reload offer', () => {
  // A plain reload keeps the old worker in control while a new one waits: a missing old-hash chunk would fail again.
  it('activates a waiting worker and reloads once it controls the page', async () => {
    const waiting = { postMessage: vi.fn() };
    Object.assign(worker, { getRegistration: async () => ({ waiting }) });
    await update.reloadApp(reload as unknown as () => void);
    expect(waiting.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'SKIP_WAITING' });
    expect(reload).not.toHaveBeenCalled();
    worker.dispatchEvent(new Event('controllerchange'));
    worker.dispatchEvent(new Event('controllerchange'));
    vi.advanceTimersByTime(RELOAD_FALLBACK_MS);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads anyway when an activating worker has not taken control yet, without recovering', async () => {
    const unregister = vi.fn(async () => true);
    Object.assign(worker, { getRegistration: async () => ({ waiting: { postMessage: vi.fn(), state: 'activating' }, unregister }) });
    await update.reloadApp(reload as unknown as () => void);
    vi.advanceTimersByTime(RELOAD_FALLBACK_MS);
    expect(reload).toHaveBeenCalledOnce();
    expect(unregister).not.toHaveBeenCalled();
    worker.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledOnce();
  });

  describe('a waiting worker that does not act on the skip-waiting message (Firefox, 23-68)', () => {
    let unregister: ReturnType<typeof vi.fn>;
    let deleted: string[];
    let stuck: { postMessage: ReturnType<typeof vi.fn>; state: ServiceWorkerState; scriptURL: string };
    let probe: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      unregister = vi.fn(async () => true);
      deleted = [];
      stuck = { postMessage: vi.fn(), state: 'installed', scriptURL: 'https://glazelab.eu/sw.js' };
      probe = vi.fn(async () => new Response('self.skipWaiting()'));
      vi.stubGlobal('fetch', probe);
      Object.assign(worker, { getRegistration: async () => ({ waiting: stuck, unregister }) });
      vi.stubGlobal('caches', {
        keys: async () => ['workbox-precache-v2-https://glazelab.eu/', 'label-ocr', 'barcode-scanner'],
        delete: async (name: string) => deleted.push(name) > 0,
      });
    });

    it.each([
      ['installed', true, 'recover'],
      ['installed', false, 'reload'],
      ['activating', true, 'reload'],
      ['activated', true, 'reload'],
      ['redundant', true, 'reload'],
    ] as const)('a %s worker, online %s -> %s', (state, online, expected) => {
      expect(update.afterSkipWaiting({ state }, online)).toBe(expected);
    });

    it('an unreachable worker is recovered online only', () => {
      expect(update.afterSkipWaiting('unreachable', true)).toBe('recover');
      expect(update.afterSkipWaiting('unreachable', false)).toBe('reload');
    });

    it('waits RELOAD_FALLBACK_MS, fetches the new worker, then unregisters, keeps every cache and reloads once', async () => {
      await update.reloadApp(reload as unknown as () => void);
      expect(stuck.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'SKIP_WAITING' });
      await vi.advanceTimersByTimeAsync(RELOAD_FALLBACK_MS - 1);
      expect(probe).not.toHaveBeenCalled();
      expect(unregister).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(probe).toHaveBeenCalledExactlyOnceWith('https://glazelab.eu/sw.js', { cache: 'no-store' });
      expect(unregister).toHaveBeenCalledOnce();
      expect(probe.mock.invocationCallOrder[0]).toBeLessThan(unregister.mock.invocationCallOrder[0]);
      // The precache stays: a tab with unsaved input still runs under the old worker, and the new worker's activation tidies it.
      expect(deleted).toEqual([]);
      expect(reload).toHaveBeenCalledOnce();
      worker.dispatchEvent(new Event('controllerchange'));
      await vi.advanceTimersByTimeAsync(RECOVERY_LIMIT_MS);
      expect(reload).toHaveBeenCalledOnce();
    });

    it.each([
      ['the network fails', () => Promise.reject(new TypeError('NetworkError'))],
      ['the server answers 502 (a deployment)', async () => new Response('', { status: 502 })],
      ['the fetch outlasts RECOVERY_LIMIT_MS', () => new Promise(() => {})],
    ])('keeps the registration and its shell when %s: a plain reload, served by the old worker', async (_, answer) => {
      probe.mockImplementation(answer);
      await update.reloadApp(reload as unknown as () => void);
      await vi.advanceTimersByTimeAsync(RELOAD_FALLBACK_MS + RECOVERY_LIMIT_MS);
      expect(probe).toHaveBeenCalledOnce();
      expect(unregister).not.toHaveBeenCalled();
      expect(deleted).toEqual([]);
      expect(reload).toHaveBeenCalledOnce();
    });

    it('does not unregister when the fetch answers only after the page reloaded', async () => {
      let answer: (response: Response) => void = () => {};
      probe.mockImplementation(() => new Promise((done) => (answer = done)));
      await update.reloadApp(reload as unknown as () => void);
      await vi.advanceTimersByTimeAsync(RELOAD_FALLBACK_MS + RECOVERY_LIMIT_MS);
      expect(reload).toHaveBeenCalledOnce();
      answer(new Response('late'));
      await vi.advanceTimersByTimeAsync(0);
      expect(unregister).not.toHaveBeenCalled();
    });

    it('recovers when the message cannot be sent (storage restricted)', async () => {
      stuck.postMessage.mockImplementation(() => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      });
      await update.reloadApp(reload as unknown as () => void);
      await vi.advanceTimersByTimeAsync(RELOAD_FALLBACK_MS);
      expect(unregister).toHaveBeenCalledOnce();
      expect(reload).toHaveBeenCalledOnce();
    });

    it('reloads after RECOVERY_LIMIT_MS when unregistering never settles, and when every step fails', async () => {
      unregister.mockImplementation(() => new Promise(() => {}));
      await update.reloadApp(reload as unknown as () => void);
      await vi.advanceTimersByTimeAsync(RELOAD_FALLBACK_MS);
      expect(reload).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(RECOVERY_LIMIT_MS);
      expect(reload).toHaveBeenCalledOnce();

      vi.resetModules();
      update = await import('./update');
      const again = vi.fn();
      unregister.mockImplementation(async () => Promise.reject(new DOMException('insecure', 'SecurityError')));
      vi.stubGlobal('caches', { keys: async () => Promise.reject(new DOMException('insecure', 'SecurityError')) });
      await update.reloadApp(again as unknown as () => void);
      await vi.advanceTimersByTimeAsync(RELOAD_FALLBACK_MS);
      expect(again).toHaveBeenCalledOnce();
    });

    it('keeps the worker offline: a plain reload, which the old worker can still serve', async () => {
      vi.stubGlobal('navigator', { serviceWorker: worker, onLine: false });
      await update.reloadApp(reload as unknown as () => void);
      await vi.advanceTimersByTimeAsync(RELOAD_FALLBACK_MS);
      expect(probe).not.toHaveBeenCalled();
      expect(unregister).not.toHaveBeenCalled();
      expect(deleted).toEqual([]);
      expect(reload).toHaveBeenCalledOnce();
    });

    it('does not recover a worker that takes control in time', async () => {
      await update.reloadApp(reload as unknown as () => void);
      worker.dispatchEvent(new Event('controllerchange'));
      await vi.advanceTimersByTimeAsync(RELOAD_FALLBACK_MS + RECOVERY_LIMIT_MS);
      expect(unregister).not.toHaveBeenCalled();
      expect(reload).toHaveBeenCalledOnce();
    });

    it('Refresh in the notice recovers too, after the unsaved-input question', async () => {
      const controller = started();
      callbacks.onWaiting();
      unsaved = true;
      controller.refresh();
      await vi.advanceTimersByTimeAsync(RELOAD_FALLBACK_MS);
      expect(unregister).not.toHaveBeenCalled();
      controller.discard();
      await vi.advanceTimersByTimeAsync(RELOAD_FALLBACK_MS);
      expect(allowUnload).toHaveBeenCalledOnce();
      expect(unregister).toHaveBeenCalledOnce();
      expect(reload).toHaveBeenCalledOnce();
    });
  });

  it.each([
    ['no waiting worker', { getRegistration: async () => ({ waiting: null }) }],
    ['no registration', { getRegistration: async () => undefined }],
    ['a failing lookup', { getRegistration: async () => Promise.reject(new Error('insecure')) }],
  ])('reloads at once with %s', async (_, sw) => {
    Object.assign(worker, sw);
    await update.reloadApp(reload as unknown as () => void);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads at once without service workers', async () => {
    vi.stubGlobal('navigator', {});
    await update.reloadApp(reload as unknown as () => void);
    expect(reload).toHaveBeenCalledOnce();
  });
});

describe('the newer build, named beside the footer version', () => {
  const page = (label?: string) =>
    `<!doctype html><html><head><meta charset="UTF-8" />${label === undefined ? '' : `<meta name="glazelab-version" content="${label}" />`}</head></html>`;

  it('reads the label index.html carries', () => {
    expect(update.versionIn(page('0.1.0 (2026-10-31 00:31:14Z)'))).toBe('0.1.0 (2026-10-31 00:31:14Z)');
    expect(update.versionIn(page('0.1.0 (&quot;x&quot; &amp; &lt;y&gt;)'))).toBe('0.1.0 ("x" & <y>)');
    expect(update.versionIn(page())).toBeNull();
  });

  it.each([
    [['0.1.0 (a)', '0.1.0 (b)'], '0.1.0 (a)', '0.1.0 (b)'],
    [['0.1.0 (a)', '0.1.0 (b)', '0.1.0 (c)'], '0.1.0 (a)', '0.1.0 (c)'],
    [[null, '0.1.0 (b)'], '0.1.0 (b)', null],
    [['0.1.0 (a)'], '0.1.0 (a)', null],
    [[], '0.1.0 (a)', null],
  ])('%j running %s -> %s', (labels, current, expected) => {
    expect(update.newerVersion(labels, current)).toBe(expected);
  });

  it('looks in the precache, and answers null where the Cache API fails', async () => {
    const stored = new Map<string, string>([
      ['https://glazelab.eu/index.html?__WB_REVISION__=1', page('0.1.0 (a)')],
      ['https://glazelab.eu/assets/index-1.js', ''],
      ['https://glazelab.eu/index.html?__WB_REVISION__=2', page('0.1.0 (b)')],
    ]);
    const cache = {
      keys: async () => [...stored.keys()].map((url) => ({ url })),
      match: async (request: { url: string }) => new Response(stored.get(request.url)),
    };
    vi.stubGlobal('caches', {
      keys: async () => ['label-ocr', 'workbox-precache-v2-https://glazelab.eu/'],
      open: async (name: string) => (name.startsWith('workbox-precache') ? cache : Promise.reject(new Error(name))),
    });
    expect(await update.waitingVersion('0.1.0 (a)')).toBe('0.1.0 (b)');
    vi.stubGlobal('caches', { keys: async () => Promise.reject(new DOMException('insecure', 'SecurityError')) });
    expect(await update.waitingVersion('0.1.0 (a)')).toBeNull();
    vi.stubGlobal('caches', undefined);
    expect(await update.waitingVersion('0.1.0 (a)')).toBeNull();
  });

  it('the controller looks it up when the notice rises', async () => {
    const nextVersion = vi.fn(async () => '0.1.0 (b)');
    const controller = update.createUpdateController({
      register: async (given) => {
        callbacks = given;
        return registration as unknown as ServiceWorkerRegistration;
      },
      hasUnsavedWork: () => false,
      online: () => true,
      allowUnload: () => {},
      reload: reload as unknown as () => void,
      nextVersion,
    });
    stop = controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(nextVersion).not.toHaveBeenCalled();
    callbacks.onWaiting();
    await vi.advanceTimersByTimeAsync(0);
    expect(get(controller.state)).toMatchObject({ available: true, next: '0.1.0 (b)' });
    controller.dismiss();
    expect(get(controller.state)).toMatchObject({ available: false, next: '0.1.0 (b)' });
  });
});
