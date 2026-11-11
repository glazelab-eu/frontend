/**
 * Spoken feedback for the keyboard in the crop dialog (31-5): a key repeats about 30 times a second, a screen reader needs the
 * live region to change at a speakable pace. The first message goes out at once, then at most one per `wait` ms, always the
 * latest one (so the final position is always said).
 */
export const ANNOUNCE_WAIT_MS = 700;

export interface Announcer {
  say: (text: string) => void;
  /** Stops a pending message (the dialog closes). */
  cancel: () => void;
}

export function createAnnouncer(announce: (text: string) => void, wait = ANNOUNCE_WAIT_MS): Announcer {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: string | undefined;
  const tick = () => {
    if (pending === undefined) {
      timer = undefined;
      return;
    }
    announce(pending);
    pending = undefined;
    timer = setTimeout(tick, wait);
  };
  return {
    say(text) {
      if (timer === undefined) {
        announce(text);
        timer = setTimeout(tick, wait);
      } else {
        pending = text;
      }
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending = undefined;
    },
  };
}
