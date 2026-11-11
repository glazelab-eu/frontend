import type { DeviceInfo, ReportBatch, ReportEvent } from '../generated/types.gen';
import { EVENT_BYTES_MAX, MESSAGE_MAX, eventKey, jsonBytes, scrubStack, scrubText, truncate } from './scrub';

/** What the app's error paths and the browser hooks report. */
export type ReportKind = ReportEvent['kind'];

/** The answer to a send, as the status only (0: unreachable); `retryAfter` is the 429's wait in seconds. */
export interface SendResult {
  status: number;
  retryAfter?: number;
}

export interface DiagnosticsDeps {
  /** Sends one batch. Never throws; its failures are not reported (no loops). */
  send: (batch: ReportBatch) => Promise<SendResult>;
  /** The device facts at send time. */
  device: () => DeviceInfo;
  /** The current route's name (never its address), or null when it cannot be said. */
  route: () => string | null;
  /** The app's build label. */
  build: string;
  /** The app's origin, removed from stacks. */
  origin?: string;
  /** 409: the account's choice is off on the server; the app reads the account again. */
  onOff: () => void;
  /** 428: the account must accept the current terms before anything is sent. */
  onTermsRequired: () => void;
  now?: () => number;
}

/** At most this many reports (distinct events) per ten minutes, on top of the server's own limits. */
export const BUDGET = 20;
export const BUDGET_WINDOW_MS = 10 * 60 * 1000;
/** Distinct events kept in memory; further new ones are dropped until a send frees room. */
export const BUFFER_MAX = 50;
/** Batch limits of the API (20 events, 32 KB; kept below). */
export const BATCH_EVENTS = 20;
export const BATCH_BYTES = 30 * 1024;
/** A quiet moment collects a burst into one request; two requests are at least this far apart (the server allows 2 per minute). */
export const FLUSH_DELAY_MS = 5000;
export const MIN_GAP_MS = 30_000;
export const BACKOFF_START_MS = 60_000;
export const BACKOFF_MAX_MS = 10 * 60_000;

/** Browser noise without a bug behind it. */
const IGNORED = [/ResizeObserver loop/i];

interface Entry {
  event: ReportEvent;
  key: string;
}

/**
 * Error reports (32-2): collects errors and warnings in MEMORY ONLY (never storage; a reload loses them) while the signed-in account
 * has opted in, and sends them in small batches. Guests and opted-out accounts collect and send nothing, and the app tells this module
 * which state it is in (`update`). The module never reports its own failures and never retries in a loop: sends are spaced by
 * `MIN_GAP_MS`, a failed one waits a doubling time, and the buffer and the budget are capped.
 */
export function createDiagnostics(deps: DiagnosticsDeps) {
  const now = () => (deps.now ?? Date.now)();
  let entries: Entry[] = [];
  let enabled = false;
  let capturing = false;
  let canSend = false;
  let sending = false;
  let lastSend = -Infinity;
  let backoff = 0;
  let blockedUntil = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** When each sent event was sent, within the budget window. */
  let sent: number[] = [];

  function schedule(delay = FLUSH_DELAY_MS) {
    if (timer !== undefined || !enabled || !canSend || sending || !entries.length) return;
    const wait = Math.max(delay, lastSend + MIN_GAP_MS - now(), blockedUntil - now(), budgetWait());
    timer = setTimeout(() => {
      timer = undefined;
      void flush().catch(() => {});
    }, wait);
  }

  function spent() {
    sent = sent.filter((at) => now() - at < BUDGET_WINDOW_MS);
    return sent.length;
  }

  function budgetWait() {
    return spent() >= BUDGET ? sent[0] + BUDGET_WINDOW_MS - now() : 0;
  }

  function clear() {
    entries = [];
    clearTimeout(timer);
    timer = undefined;
  }

  /** Records one event (scrubbed, merged with its repeats). Does nothing unless the account opted in. */
  function capture(kind: ReportKind, message: string, stack?: string | null) {
    if (!enabled || capturing) return;
    capturing = true;
    try {
      const route = deps.route();
      if (route === null) return;
      const text = scrubText(message, MESSAGE_MAX).trim();
      if (!text || IGNORED.some((pattern) => pattern.test(text))) return;
      const key = eventKey(kind, text);
      const known = entries.find((entry) => entry.key === key);
      if (known) {
        known.event.count = Math.min((known.event.count ?? 1) + 1, 1000);
        return;
      }
      if (entries.length >= BUFFER_MAX) return;
      const event: ReportEvent = {
        kind,
        message: text,
        build: deps.build,
        occurredAt: new Date(now()).toISOString(),
        count: 1,
        route,
      };
      let trace = stack ? scrubStack(stack, deps.origin) : '';
      if (trace) event.stack = trace;
      // A multi-byte stack can exceed the server's 4 KB per event: shorten it until the event fits (the message stays).
      while (trace && jsonBytes(event) > EVENT_BYTES_MAX) {
        trace = truncate(trace, Math.max(0, Math.floor(Array.from(trace).length * 0.8) - 1));
        if (trace) event.stack = trace;
        else delete event.stack;
      }
      if (jsonBytes(event) > EVENT_BYTES_MAX) return;
      entries.push({ event, key });
      schedule();
    } finally {
      capturing = false;
    }
  }

  /** Picks what one request carries: the oldest events within the budget, the event count and the byte limit. */
  function take(): Entry[] {
    const room = Math.min(BATCH_EVENTS, BUDGET - spent());
    const picked: Entry[] = [];
    for (const entry of entries) {
      if (picked.length >= room) break;
      if (jsonBytes({ device: deps.device(), events: [...picked, entry].map((one) => one.event) }) > BATCH_BYTES) break;
      picked.push(entry);
    }
    return picked;
  }

  async function flush() {
    if (!enabled || !canSend || sending || !entries.length) return;
    if (now() < lastSend + MIN_GAP_MS || now() < blockedUntil || spent() >= BUDGET) return schedule(0);
    const picked = take();
    if (!picked.length) {
      // One event never fits (cannot happen below 4 KB): drop it rather than retry forever.
      entries.shift();
      return schedule(0);
    }
    sending = true;
    lastSend = now();
    let result: SendResult;
    try {
      result = await deps.send({ device: deps.device(), events: picked.map((entry) => entry.event) });
    } catch {
      result = { status: 0 };
    } finally {
      sending = false;
    }
    if (!enabled) return;
    const { status } = result;
    const dropPicked = () => (entries = entries.filter((entry) => !picked.includes(entry)));
    if (status >= 200 && status < 300) {
      dropPicked();
      sent.push(...picked.map(() => now()));
      backoff = 0;
    } else if (status === 409 || status === 401) {
      clear();
      if (status === 409) deps.onOff();
      return;
    } else if (status === 400 || status === 413) {
      // The server refused this very content: never retry it and never report it.
      dropPicked();
    } else if (status === 428) {
      deps.onTermsRequired();
      canSend = false;
      return;
    } else if (status === 429) {
      blockedUntil = now() + Math.min(Math.max(result.retryAfter ?? 60, 1) * 1000, BACKOFF_MAX_MS);
    } else {
      backoff = Math.min(backoff ? backoff * 2 : BACKOFF_START_MS, BACKOFF_MAX_MS);
      blockedUntil = now() + backoff;
    }
    schedule();
  }

  return {
    capture,
    /** The app's state: `enabled` (signed in and opted in: events are collected), `canSend` (online, terms accepted, not on a token page). */
    update(state: { enabled: boolean; canSend: boolean }) {
      const was = enabled;
      enabled = state.enabled;
      canSend = state.canSend;
      if (!enabled) {
        clear();
        if (was) {
          backoff = 0;
          blockedUntil = 0;
          sent = [];
        }
        return;
      }
      if (!canSend) {
        clearTimeout(timer);
        timer = undefined;
        return;
      }
      schedule();
    },
    /** Sends what is buffered now (tests, and the hand-over before the page hides). */
    flush,
    pending: () => entries.length,
  };
}

export type Diagnostics = ReturnType<typeof createDiagnostics>;
