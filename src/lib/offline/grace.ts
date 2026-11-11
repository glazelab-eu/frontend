/**
 * Whether an unreachable API is already the offline warning. Right after the app starts, resumes from the
 * background or the device reports its connection back, the radio may still be waking: the first request
 * then fails although the network is fine a moment later. That failure gets a short grace period and one
 * silent retry; a device that reports itself offline, a failure after the window or a failed retry warns.
 */

/** How long after a start, resume or `online` event a failure may still be a waking radio. */
export const GRACE_MS = 5000;
/** The wait before the silent retry. */
export const RETRY_DELAY_MS = 2000;
/** Silent retries per grace window; the failure after them warns. */
export const MAX_SILENT_RETRIES = 1;

export interface FailureContext {
  /** `navigator.onLine`: `false` is a device that knows it has no connection. */
  onLine: boolean | undefined;
  /** Milliseconds since the grace window opened. */
  sinceMs: number;
  /** Silent retries already made in this window. */
  retries: number;
}

/** `retry`: wait `RETRY_DELAY_MS` and ask again without a warning; `warn`: show the offline state. */
export function failureVerdict({ onLine, sinceMs, retries }: FailureContext): 'retry' | 'warn' {
  if (onLine === false) return 'warn';
  if (retries >= MAX_SILENT_RETRIES) return 'warn';
  return sinceMs < GRACE_MS ? 'retry' : 'warn';
}

/** How long screen readers get the "Back online" text after the connection returns. */
export const BACK_ONLINE_MS = 5000;
