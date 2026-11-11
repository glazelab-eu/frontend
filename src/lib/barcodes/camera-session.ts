import { openCamera, stopCamera } from './scanner';

/** Without a scan for this long the camera goes off and the scanner waits for "Resume camera"; a held code stops the clock. */
export const CAMERA_IDLE_MS = 2 * 60_000;

/** Why the camera went off by itself: the page was hidden, left or frozen, or no code was read for `CAMERA_IDLE_MS`. */
export type CameraPause = 'away' | 'idle';

interface EventSource {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface CameraSessionOptions {
  /** The camera went off by itself; the scanner shows its paused state and never restarts it unasked. */
  onPause: (reason: CameraPause) => void;
  open?: () => Promise<MediaStream>;
  doc?: EventSource & { readonly visibilityState: DocumentVisibilityState };
  win?: EventSource;
  idleMs?: number;
}

export interface CameraSession {
  /** Opens the camera; null when it was paused, stopped or disposed meanwhile (that stream is stopped already). Throws CameraError. */
  start(): Promise<MediaStream | null>;
  /** A code was read: the idle limit starts again. */
  activity(): void;
  /** A code is held while the person types (the shelf scan sheet): no idle limit until it is released, then a full one. */
  hold(on: boolean): void;
  /** Stops the camera without a pause (a code was handed over, an error, a close). */
  stop(): void;
  /** Stops the camera and the listeners (unmount). */
  dispose(): void;
}

/**
 * The camera's whole lifetime in one place: it runs only while the page is visible and the scanner mounted. A hidden,
 * left (`pagehide`) or frozen page, a route change (`hashchange`) and the idle limit stop every track and report a
 * pause; a new `start` (the person's "Resume camera") opens it again.
 */
export function createCameraSession({
  onPause,
  open = () => openCamera(),
  doc = globalThis.document,
  win = globalThis.window,
  idleMs = CAMERA_IDLE_MS,
}: CameraSessionOptions): CameraSession {
  let stream: MediaStream | null = null;
  /** Counts starts and stops, so a camera that opens after a stop is closed at once. */
  let run = 0;
  /** A start is pending or the camera is on: only then does a pause apply. */
  let active = false;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let held = false;

  function stop() {
    run++;
    active = false;
    clearTimeout(idle);
    stopCamera(stream);
    stream = null;
  }
  function pause(reason: CameraPause) {
    if (!active) return;
    stop();
    onPause(reason);
  }
  function activity() {
    clearTimeout(idle);
    if (stream && !held) idle = setTimeout(() => pause('idle'), idleMs);
  }
  const away = () => pause('away');
  const hidden = () => {
    if (doc.visibilityState === 'hidden') away();
  };
  doc.addEventListener('visibilitychange', hidden);
  doc.addEventListener('freeze', away);
  win.addEventListener('pagehide', away);
  win.addEventListener('hashchange', away);

  return {
    async start() {
      stop();
      const current = ++run;
      active = true;
      if (doc.visibilityState === 'hidden') {
        pause('away');
        return null;
      }
      let opened: MediaStream;
      try {
        opened = await open();
      } catch (error) {
        if (current === run) active = false;
        throw error;
      }
      if (current !== run) {
        stopCamera(opened);
        return null;
      }
      stream = opened;
      activity();
      return opened;
    },
    activity,
    hold(on) {
      held = on;
      activity();
    },
    stop,
    dispose() {
      stop();
      doc.removeEventListener('visibilitychange', hidden);
      doc.removeEventListener('freeze', away);
      win.removeEventListener('pagehide', away);
      win.removeEventListener('hashchange', away);
    },
  };
}
