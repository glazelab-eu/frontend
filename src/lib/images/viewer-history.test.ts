import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubSessionHistory } from '../../state/app/test-helpers';
import { afterViewerPop, enterViewer, holdViewerEntry, isViewerEntry, leaveViewer, skipStaleViewerEntry } from './viewer-history';

/** One tick of the stub's queued traversal. */
const settle = () => new Promise<void>((done) => setTimeout(done, 0));

afterEach(async () => {
  vi.useRealTimers();
  // Whatever a test left open ends here, so the module's one viewer does not leak into the next test.
  leaveViewer();
  await settle();
  vi.unstubAllGlobals();
});

describe('the viewer as a history entry', () => {
  it('pushes an entry with the same URL and a copy of the whole state of the page entry', () => {
    const { session } = stubSessionHistory('#/glazes/1');
    session.replaceState({ glazelabNavigation: { session: 's', previous: null }, scrollY: 40 }, '', '#/glazes/1');
    expect(enterViewer(() => {})).toBe(true);
    expect(session.length).toBe(2);
    expect(location.hash).toBe('#/glazes/1');
    expect(isViewerEntry()).toBe(true);
    // The marker, the list positions of PagedGrid and anything else: a reload on this entry finds the page's own state.
    expect(session.state).toMatchObject({ glazelabNavigation: { session: 's' }, scrollY: 40, glazelabViewer: expect.any(String) });
  });

  it('copies the list positions, which are still there on the page entry after the viewer closed', async () => {
    const { session } = stubSessionHistory('#/');
    const lists = { glazelabLists: { explore: { limit: 36, scrollY: 900, top: 120 } } };
    session.replaceState({ glazelabNavigation: { session: 's', previous: null }, ...lists }, '', '#/');
    enterViewer(() => {});
    expect(session.state).toMatchObject(lists);
    leaveViewer();
    await settle();
    expect(session.state).toEqual({ glazelabNavigation: { session: 's', previous: null }, ...lists });
  });

  it('browser Back removes the entry and tells the viewer to close', async () => {
    const { session } = stubSessionHistory('#/glazes/1');
    const gone = vi.fn();
    enterViewer(gone);
    session.back();
    await settle();
    expect(gone).toHaveBeenCalledOnce();
    expect(isViewerEntry()).toBe(false);
    expect(session.index).toBe(0);
    // The viewer is over: leaving it again pops nothing.
    expect(leaveViewer()).toBe(false);
    expect(session.back).toHaveBeenCalledTimes(1);
  });

  it('leaving pops the entry, closes through the popstate and leaves no extra step', async () => {
    const { session } = stubSessionHistory('#/glazes/1');
    const gone = vi.fn();
    enterViewer(gone);
    expect(leaveViewer()).toBe(true);
    expect(leaveViewer()).toBe(true); // a second Escape while the pop is on its way pops nothing more
    expect(gone).not.toHaveBeenCalled();
    await settle();
    expect(session.back).toHaveBeenCalledTimes(1);
    expect(gone).toHaveBeenCalledOnce();
    expect(session.index).toBe(0);
  });

  it('closes anyway when the browser never answers the pop', async () => {
    vi.useFakeTimers();
    const { session } = stubSessionHistory('#/glazes/1');
    session.back.mockImplementation(() => {});
    const gone = vi.fn();
    enterViewer(gone);
    leaveViewer();
    vi.advanceTimersByTime(1100);
    expect(gone).toHaveBeenCalledOnce();
  });

  it('a pop that was answered leaves no timer that could close the next viewer', async () => {
    vi.useFakeTimers();
    const { session } = stubSessionHistory('#/glazes/1');
    enterViewer(() => {});
    leaveViewer();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.index).toBe(0);
    const next = vi.fn();
    expect(enterViewer(next)).toBe(true);
    await vi.advanceTimersByTimeAsync(1100);
    expect(next).not.toHaveBeenCalled();
    expect(isViewerEntry()).toBe(true);
  });

  it('never pops an entry that is not its own (an entry followed it without a popstate)', async () => {
    const { session } = stubSessionHistory('#/glazes/1');
    enterViewer(() => {});
    session.pushState(null, '', '#/glazes/2');
    const order: string[] = [];
    afterViewerPop(() => order.push('ran'));
    expect(order).toEqual(['ran']); // nothing to wait for
    enterViewer(() => {});
    session.pushState(null, '', '#/glazes/3');
    expect(leaveViewer()).toBe(false);
    await settle();
    expect(session.back).not.toHaveBeenCalled();
    expect(session.index).toBe(4);
  });

  it("a viewer without an entry of its own never pops another viewer's entry, and one pop closes the one that has it", async () => {
    const { session } = stubSessionHistory('#/glazes/1');
    const first = vi.fn();
    const second = vi.fn();
    const leaveFirst = holdViewerEntry(first);
    const leaveSecond = holdViewerEntry(second); // the first one's entry is open: no entry for this one
    expect(session.length).toBe(2);
    expect(leaveSecond()).toBe(false);
    expect(session.back).not.toHaveBeenCalled();
    expect(leaveFirst()).toBe(true);
    await settle();
    expect(session.back).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    expect(session.index).toBe(0);
  });

  it('a viewer whose entry is over does not pop the entry of the viewer opened after it', async () => {
    const { session } = stubSessionHistory('#/glazes/1');
    const leaveOld = holdViewerEntry(() => {});
    session.back();
    await settle();
    expect(session.index).toBe(0);
    const leaveNew = holdViewerEntry(() => {});
    expect(session.index).toBe(1);
    expect(leaveOld()).toBe(false); // the old viewer's late cleanup
    await settle();
    expect(session.index).toBe(1);
    expect(isViewerEntry()).toBe(true);
    expect(leaveNew()).toBe(true);
    await settle();
    expect(session.index).toBe(0);
  });

  it('without an entry the viewer must close itself', () => {
    stubSessionHistory('#/glazes/1');
    expect(leaveViewer()).toBe(false);
    const { session } = stubSessionHistory('#/glazes/1');
    session.pushState.mockImplementation(() => {
      throw new Error('refused');
    });
    expect(enterViewer(() => {})).toBe(false);
    expect(leaveViewer()).toBe(false);
  });

  it('lets navigation wait for the pop, so no entry follows the viewer', async () => {
    const { session } = stubSessionHistory('#/glazes/1');
    enterViewer(() => {});
    const order: string[] = [];
    afterViewerPop(() => order.push('first'));
    afterViewerPop(() => order.push('second'));
    expect(order).toEqual([]);
    await settle();
    expect(order).toEqual(['first', 'second']);
    expect(session.index).toBe(0);
    // Without a viewer it runs at once.
    afterViewerPop(() => order.push('now'));
    expect(order).toEqual(['first', 'second', 'now']);
  });

  it('steps back over an entry of a viewer that is not open (reload, Forward)', async () => {
    const { session } = stubSessionHistory('#/glazes/1');
    enterViewer(() => {});
    session.back();
    await settle();
    session.forward();
    await settle();
    expect(isViewerEntry()).toBe(true);
    skipStaleViewerEntry();
    await settle();
    expect(session.index).toBe(0);
    skipStaleViewerEntry();
    expect(session.back).toHaveBeenCalledTimes(2);
  });
});
