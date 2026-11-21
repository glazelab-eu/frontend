import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STUCK_SETTLE, viewportStuck, watchStuckViewport, windowShort } from './stuck-viewport';

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

describe('windowShort', () => {
  it('holds once the window is over 4 px shorter than its tallest', () => {
    expect(windowShort(852, 852)).toBe(false);
    expect(windowShort(848, 852)).toBe(false);
    expect(windowShort(847, 852)).toBe(true);
    expect(windowShort(514, 852)).toBe(true);
  });
});

describe('watchStuckViewport', () => {
  const scrollBy = vi.fn();
  const scrollTo = vi.fn();
  const media = { matches: false };
  /** The `display` of `root` at each forced layout. */
  let layouts: string[];
  let root: HTMLElement;
  let viewport: EventTarget & typeof fine;
  let page: EventTarget & {
    visualViewport: typeof viewport;
    innerWidth: number;
    innerHeight: number;
    scrollX: number;
    scrollY: number;
    scrollBy: typeof scrollBy;
    scrollTo: typeof scrollTo;
    matchMedia: (query: string) => typeof media;
  };
  let doc: EventTarget & { activeElement: unknown };

  beforeEach(() => {
    vi.useFakeTimers();
    layouts = [];
    const style = { display: '' };
    root = {
      style,
      get offsetHeight() {
        layouts.push(style.display);
        return 0;
      },
    } as unknown as HTMLElement;
    media.matches = false;
    viewport = Object.assign(new EventTarget(), fine);
    page = Object.assign(new EventTarget(), {
      visualViewport: viewport,
      innerWidth: 393,
      innerHeight: 852,
      scrollX: 0,
      scrollY: 400,
      scrollBy,
      scrollTo,
      matchMedia: () => media,
    });
    doc = Object.assign(new EventTarget(), { activeElement: null });
    vi.stubGlobal('window', page);
    vi.stubGlobal('document', doc);
  });
  afterEach(() => {
    scrollBy.mockReset();
    scrollTo.mockReset();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  /** Fires `type` on `target` and lets the page settle. */
  const settle = (target: EventTarget, type: string) => {
    target.dispatchEvent(new Event(type));
    vi.advanceTimersByTime(STUCK_SETTLE);
  };
  /** A Home Screen app measured at its full height, then typed in: iOS 18 keeps the window as short as the keyboard left it. */
  const typedIn = (button = { tagName: 'BUTTON', isContentEditable: false, focus: vi.fn() }) => {
    media.matches = true;
    watchStuckViewport(root);
    vi.advanceTimersByTime(STUCK_SETTLE);
    doc.activeElement = { tagName: 'TEXTAREA', isContentEditable: false };
    page.innerHeight = viewport.height = 514;
    settle(viewport, 'resize');
    doc.activeElement = button;
    settle(doc, 'focusout');
    return button;
  };

  it('nudges a stuck viewport 1 px and back once things settled, toward the top unless at the top', () => {
    watchStuckViewport(root);
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
    expect(layouts).toEqual([]);
  });

  it('nudges once per occurrence, also when its own scroll restarts the wait', () => {
    watchStuckViewport(root);
    viewport.offsetTop = 336;
    settle(page, 'scroll');
    page.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(STUCK_SETTLE * 3);
    settle(page, 'scroll');
    expect(scrollBy).toHaveBeenCalledTimes(2);
  });

  it('waits while a field has focus, which keeps the keyboard up', () => {
    watchStuckViewport(root);
    doc.activeElement = { tagName: 'INPUT', isContentEditable: false };
    viewport.height = 516;
    settle(viewport, 'resize');
    expect(scrollBy).not.toHaveBeenCalled();
    doc.activeElement = { tagName: 'BODY', isContentEditable: false };
    settle(doc, 'focusout');
    expect(scrollBy).toHaveBeenCalledTimes(1);
  });

  it("re-lays out a Home Screen app's window stuck short, keeping scroll and focus, once per occurrence", () => {
    const button = typedIn();
    expect(layouts).toEqual(['none']);
    expect(root.style.display).toBe('');
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ left: 0, top: 400, behavior: 'instant' });
    expect(button.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(scrollBy).toHaveBeenCalledTimes(1);
    settle(page, 'scroll');
    expect(layouts).toHaveLength(1);
    page.innerHeight = viewport.height = 852;
    settle(page, 'resize');
    page.innerHeight = viewport.height = 514;
    settle(doc, 'visibilitychange');
    expect(layouts).toHaveLength(2);
  });

  it('does not take a turned phone for a window stuck short', () => {
    media.matches = true;
    watchStuckViewport(root);
    vi.advanceTimersByTime(STUCK_SETTLE);
    page.innerWidth = 852;
    page.innerHeight = viewport.height = 393;
    settle(page, 'resize');
    expect(layouts).toEqual([]);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('leaves a shorter window alone in the browser, whose toolbars shorten it on purpose', () => {
    watchStuckViewport(root);
    vi.advanceTimersByTime(STUCK_SETTLE);
    page.innerHeight = viewport.height = 760;
    settle(page, 'resize');
    expect(layouts).toEqual([]);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('stops listening on cleanup and does nothing without visualViewport', () => {
    watchStuckViewport(root)();
    viewport.offsetTop = 336;
    settle(page, 'scroll');
    expect(scrollBy).not.toHaveBeenCalled();
    page.visualViewport = undefined as never;
    watchStuckViewport(root);
    settle(page, 'scroll');
    expect(scrollBy).not.toHaveBeenCalled();
  });
});
