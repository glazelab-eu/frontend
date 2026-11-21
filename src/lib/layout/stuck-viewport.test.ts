import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STUCK_SETTLE, viewportStuck, watchStuckViewport } from './stuck-viewport';

const fine = { offsetTop: 0, height: 852, scale: 1 };

describe('viewportStuck', () => {
  it('holds while the viewport is offset or shorter than the window', () => {
    expect(viewportStuck(fine, 852)).toBe(false);
    expect(viewportStuck({ ...fine, offsetTop: 0.4 }, 852)).toBe(false);
    expect(viewportStuck({ ...fine, offsetTop: 336 }, 852)).toBe(true);
    expect(viewportStuck({ ...fine, height: 516 }, 852)).toBe(true);
  });

  it('never holds while pinch-zoomed, which offsets the viewport on purpose', () => {
    expect(viewportStuck({ offsetTop: 200, height: 426, scale: 2 }, 852)).toBe(false);
  });
});

describe('watchStuckViewport', () => {
  const scrollBy = vi.fn();
  let viewport: EventTarget & typeof fine;
  let page: EventTarget & { visualViewport: typeof viewport; innerHeight: number; scrollY: number; scrollBy: typeof scrollBy };
  let doc: EventTarget & { activeElement: unknown };

  beforeEach(() => {
    vi.useFakeTimers();
    viewport = Object.assign(new EventTarget(), fine);
    page = Object.assign(new EventTarget(), { visualViewport: viewport, innerHeight: 852, scrollY: 400, scrollBy });
    doc = Object.assign(new EventTarget(), { activeElement: null });
    vi.stubGlobal('window', page);
    vi.stubGlobal('document', doc);
  });
  afterEach(() => {
    scrollBy.mockReset();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  /** Fires `type` on `target` and lets the page settle. */
  const settle = (target: EventTarget, type: string) => {
    target.dispatchEvent(new Event(type));
    vi.advanceTimersByTime(STUCK_SETTLE);
  };

  it('nudges a stuck page 1 px and back once things settled, toward the top unless at the top', () => {
    watchStuckViewport();
    settle(page, 'scroll');
    expect(scrollBy).not.toHaveBeenCalled();
    viewport.offsetTop = 336;
    settle(doc, 'focusout');
    expect(scrollBy).toHaveBeenCalledExactlyOnceWith({ top: -1, behavior: 'instant' });
    vi.advanceTimersByTime(50);
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 1, behavior: 'instant' });
    scrollBy.mockReset();
    viewport.offsetTop = 0;
    settle(viewport, 'resize');
    page.scrollY = 0;
    viewport.height = 516;
    settle(viewport, 'resize');
    expect(scrollBy.mock.calls).toEqual([[{ top: 1, behavior: 'instant' }]]);
  });

  it('nudges once per occurrence, also when its own scroll restarts the wait', () => {
    watchStuckViewport();
    viewport.offsetTop = 336;
    settle(page, 'scroll');
    page.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(STUCK_SETTLE * 3);
    settle(page, 'scroll');
    expect(scrollBy).toHaveBeenCalledTimes(2);
  });

  it('waits while a field has focus, which keeps the keyboard up', () => {
    watchStuckViewport();
    doc.activeElement = { tagName: 'INPUT', isContentEditable: false };
    viewport.height = 516;
    settle(viewport, 'resize');
    expect(scrollBy).not.toHaveBeenCalled();
    doc.activeElement = { tagName: 'BODY', isContentEditable: false };
    settle(doc, 'focusout');
    expect(scrollBy).toHaveBeenCalledTimes(1);
  });

  it('stops listening on cleanup and does nothing without visualViewport', () => {
    watchStuckViewport()();
    viewport.offsetTop = 336;
    settle(page, 'scroll');
    expect(scrollBy).not.toHaveBeenCalled();
    page.visualViewport = undefined as never;
    watchStuckViewport();
    settle(page, 'scroll');
    expect(scrollBy).not.toHaveBeenCalled();
  });
});
