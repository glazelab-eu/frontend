import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAMERA_IDLE_MS, createCameraSession, type CameraPause } from './camera-session';
import { CameraError } from './scanner';

class FakeTrack {
  readyState: MediaStreamTrackState = 'live';
  stop() {
    this.readyState = 'ended';
  }
}

function fakeStream() {
  const track = new FakeTrack();
  return { track, stream: { getTracks: () => [track] } as unknown as MediaStream };
}

class FakeTarget extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
}

describe('createCameraSession', () => {
  let doc: FakeTarget;
  let win: FakeTarget;
  let pauses: CameraPause[];
  let opened: ReturnType<typeof fakeStream>[];
  const open = vi.fn(async () => {
    const camera = fakeStream();
    opened.push(camera);
    return camera.stream;
  });
  const session = (options: Partial<Parameters<typeof createCameraSession>[0]> = {}) =>
    createCameraSession({ onPause: (reason) => pauses.push(reason), open, doc, win, ...options });

  beforeEach(() => {
    vi.useFakeTimers();
    doc = new FakeTarget();
    win = new FakeTarget();
    pauses = [];
    opened = [];
    open.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('stops every track when the page is hidden and reports a pause', async () => {
    const camera = session();
    await camera.start();
    expect(opened[0].track.readyState).toBe('live');
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(opened[0].track.readyState).toBe('ended');
    expect(pauses).toEqual(['away']);
  });

  it('a visible page again does not turn the camera on by itself; start does', async () => {
    const camera = session();
    await camera.start();
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(open).toHaveBeenCalledTimes(1);
    await camera.start();
    expect(open).toHaveBeenCalledTimes(2);
    expect(opened[1].track.readyState).toBe('live');
  });

  it.each([
    ['pagehide', () => win],
    ['hashchange', () => win],
    ['freeze', () => doc],
  ])('stops on %s', async (type, target) => {
    const camera = session();
    await camera.start();
    target().dispatchEvent(new Event(type));
    expect(opened[0].track.readyState).toBe('ended');
    expect(pauses).toEqual(['away']);
  });

  it('a camera that opens after the page was hidden is stopped at once', async () => {
    let resolve!: (stream: MediaStream) => void;
    const late = fakeStream();
    const camera = session({ open: () => new Promise((done) => (resolve = done)) });
    const starting = camera.start();
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    resolve(late.stream);
    expect(await starting).toBeNull();
    expect(late.track.readyState).toBe('ended');
    expect(pauses).toEqual(['away']);
  });

  it('never opens the camera on a hidden page', async () => {
    doc.visibilityState = 'hidden';
    expect(await session().start()).toBeNull();
    expect(open).not.toHaveBeenCalled();
    expect(pauses).toEqual(['away']);
  });

  it('turns off after the idle limit; a scan starts the limit again', async () => {
    const camera = session();
    await camera.start();
    vi.advanceTimersByTime(CAMERA_IDLE_MS - 1);
    camera.activity();
    vi.advanceTimersByTime(CAMERA_IDLE_MS - 1);
    expect(opened[0].track.readyState).toBe('live');
    vi.advanceTimersByTime(1);
    expect(opened[0].track.readyState).toBe('ended');
    expect(pauses).toEqual(['idle']);
  });

  it('a held code stops the idle limit, which starts again in full on release; leaving still pauses', async () => {
    const camera = session();
    await camera.start();
    vi.advanceTimersByTime(CAMERA_IDLE_MS - 1);
    camera.hold(true);
    vi.advanceTimersByTime(CAMERA_IDLE_MS * 5);
    expect(opened[0].track.readyState).toBe('live');
    camera.hold(false);
    vi.advanceTimersByTime(CAMERA_IDLE_MS - 1);
    expect(opened[0].track.readyState).toBe('live');
    vi.advanceTimersByTime(1);
    expect(pauses).toEqual(['idle']);

    // A held session that resumes keeps the limit off; a hidden page still stops the camera.
    camera.hold(true);
    await camera.start();
    vi.advanceTimersByTime(CAMERA_IDLE_MS * 2);
    expect(opened[1].track.readyState).toBe('live');
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(opened[1].track.readyState).toBe('ended');
    expect(pauses).toEqual(['idle', 'away']);
  });

  it('stop (a code handed over, an error) ends the tracks without a pause, and later events change nothing', async () => {
    const camera = session();
    await camera.start();
    camera.stop();
    expect(opened[0].track.readyState).toBe('ended');
    win.dispatchEvent(new Event('pagehide'));
    vi.advanceTimersByTime(CAMERA_IDLE_MS);
    expect(pauses).toEqual([]);
  });

  it('a failed start reports no pause afterwards, so the error stays shown', async () => {
    const camera = session({ open: () => Promise.reject(new CameraError('denied')) });
    await expect(camera.start()).rejects.toEqual(new CameraError('denied'));
    win.dispatchEvent(new Event('pagehide'));
    expect(pauses).toEqual([]);
  });

  it('dispose (close, unmount) ends the tracks and the listeners', async () => {
    const camera = session();
    await camera.start();
    camera.dispose();
    expect(opened[0].track.readyState).toBe('ended');
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(pauses).toEqual([]);
  });

  it('a second start stops the previous stream first', async () => {
    const camera = session();
    await camera.start();
    await camera.start();
    expect(opened[0].track.readyState).toBe('ended');
    expect(opened[1].track.readyState).toBe('live');
  });
});
