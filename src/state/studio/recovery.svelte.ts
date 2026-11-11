import { untrack } from 'svelte';
import { lifetime } from '../shared/lifetime';
import { newRequestId } from '../../lib/api/request-id';
import { deleteStudioRecovery, readStudioRecovery, saveStudioRecovery } from '../../lib/offline/snapshots';
import { parseRecovery, type StudioContent, type StudioRecovery } from '../../lib/studio/recovery';

/** Typing writes the recovery after this pause; hiding or leaving the page and unmounting Studio write it at once. */
export const RECOVERY_DELAY_MS = 400;

/** One recovery per account and Studio route; read before writing so reopening cannot overwrite it. */
export function createStudioRecovery(options: {
  account: () => string | undefined;
  route: () => string;
  ready: () => boolean;
  dirty: () => boolean;
  content: () => StudioContent;
}) {
  const life = lifetime(options.account);
  let checked = $state(false);
  let candidate = $state.raw<StudioRecovery>();
  let failed = $state(false);
  let latest: StudioRecovery | undefined;
  /** The revision in storage (read, or handed to a write): the only one `clear` may remove. */
  let written: string | undefined;
  /** The write that waits for a pause in typing. */
  let pending: { account: string; route: string; value: StudioRecovery } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** Writes the waiting recovery now, unless its account is no longer the current one (signed out, another account). */
  function flush() {
    clearTimeout(timer);
    timer = undefined;
    const next = pending;
    pending = undefined;
    if (!next || untrack(options.account) !== next.account) return;
    written = next.value.revision;
    void saveStudioRecovery(next.account, next.route, next.value).catch(() => {
      if (life.current(next.account)) failed = true;
    });
  }

  $effect(() => {
    const hidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  });

  $effect(() => {
    const account = options.account();
    if (!account || !options.ready()) return;
    let active = true;
    checked = false;
    candidate = undefined;
    const route = options.route();
    void readStudioRecovery(account, route)
      .then((value) => {
        if (!active || !life.current(account)) return;
        latest = parseRecovery(value);
        written = latest?.revision;
        candidate = latest;
        checked = true;
      })
      .catch(() => {
        if (active && life.current(account)) {
          checked = true;
          failed = true;
        }
      });
    return () => {
      active = false;
    };
  });

  $effect(() => {
    const account = options.account();
    if (!account || !options.ready() || !checked || candidate) return;
    const route = options.route();
    if (!options.dirty()) {
      if (latest) void clear();
      latest = undefined;
      return;
    }
    const content = JSON.parse(JSON.stringify(options.content())) as StudioContent;
    latest = { version: 1, revision: newRequestId(), content };
    pending = { account, route, value: latest };
    clearTimeout(timer);
    timer = setTimeout(flush, RECOVERY_DELAY_MS);
  });

  function clear() {
    clearTimeout(timer);
    pending = undefined;
    const account = untrack(options.account);
    const route = untrack(options.route);
    const revision = written;
    written = undefined;
    if (!account || !revision) return Promise.resolve();
    return deleteStudioRecovery(account, route, revision).catch(() => {
      if (life.current(account)) failed = true;
    });
  }

  return {
    get candidate() {
      return candidate;
    },
    get checking() {
      return !checked;
    },
    get failed() {
      return failed;
    },
    take() {
      const content = candidate?.content;
      candidate = undefined;
      return content;
    },
    discard() {
      void clear();
      candidate = undefined;
    },
    clear,
  };
}
