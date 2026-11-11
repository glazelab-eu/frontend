import { readonly, writable, type Readable } from 'svelte/store';

/** How long the offline toast stays once the person has asked for it (long enough to read it and reach "Try again"). */
export const OFFLINE_TOAST_MS = 8000;

/**
 * The toast the header's offline icon opens (26-6). It is never shown by itself: only `open` (the person activated the icon) shows it,
 * and it goes away after `ms`, on `close`, or when the connection returns. While a pointer or focus is on the toast, `hold` stops the
 * clock and `release` starts it again, so nobody loses the button they are about to press. Opening it again restarts the clock; there is
 * one toast, never two.
 */
export interface OfflineToast {
  state: Readable<boolean>;
  open(): void;
  close(): void;
  hold(): void;
  release(): void;
}

export function createOfflineToast(ms = OFFLINE_TOAST_MS): OfflineToast {
  const shown = writable(false);
  let visible = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const set = (value: boolean) => {
    visible = value;
    shown.set(value);
  };
  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const start = () => {
    stop();
    timer = setTimeout(close, ms);
  };
  function close() {
    stop();
    set(false);
  }
  return {
    state: readonly(shown),
    open: () => {
      set(true);
      start();
    },
    close,
    hold: stop,
    release: () => {
      if (visible) start();
    },
  };
}
