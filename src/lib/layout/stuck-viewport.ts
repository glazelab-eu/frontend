/** What `viewportStuck` reads of `window.visualViewport`. */
type Viewport = Pick<VisualViewport, 'offsetTop' | 'height' | 'scale'>;

/** Wait after the last scroll, resize or focus change before checking (ms): the keyboard has finished closing. */
export const STUCK_SETTLE = 150;

/**
 * Whether iOS left the visual viewport out of place: offset from the window's top or shorter than it, with no pinch zoom (which offsets it on
 * purpose). A WebKit bug since iOS 26, in Home Screen apps too (WebKit 297779 and 300523, FB19889436), after the keyboard closes or a scroll to
 * the page's end and back: every fixed and sticky element (the bottom navigation, the header, Studio's bar) is drawn that far from its edge,
 * mid-page. An open keyboard shortens it as well; the caller skips that.
 */
export function viewportStuck(viewport: Viewport, innerHeight: number): boolean {
  return Math.abs(viewport.scale - 1) <= 0.01 && (viewport.offsetTop > 0.5 || innerHeight - viewport.height > 1);
}

/** Whether focus is in a field, so the soft keyboard may be up. */
const typing = (element: Element | null) => !!element && ((element as HTMLElement).isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName));

/**
 * Scrolls the page 1 px and back once per occurrence of `viewportStuck`, `STUCK_SETTLE` ms after scrolling, resizing and focus settled and
 * never while typing: iOS then lays the viewport out again and the fixed bars return to their edges (the same nudge confirmed on an iPhone
 * in Sedna.UI #172). Answers the cleanup; does nothing where `visualViewport` is missing.
 */
export function watchStuckViewport(): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  let settle: ReturnType<typeof setTimeout> | undefined;
  let back: ReturnType<typeof setTimeout> | undefined;
  let nudged = false;
  const check = () => {
    if (!viewportStuck(viewport, window.innerHeight)) nudged = false;
    else if (!nudged && !typing(document.activeElement)) {
      nudged = true;
      const step = window.scrollY > 0 ? -1 : 1;
      window.scrollBy({ top: step, behavior: 'instant' });
      // A timer, not a frame: iOS may not paint the stuck page, and a frame would wait for it. Its own timer: the nudge's scroll restarts `settle`.
      back = setTimeout(() => window.scrollBy({ top: -step, behavior: 'instant' }), 50);
    }
  };
  const later = () => {
    clearTimeout(settle);
    settle = setTimeout(check, STUCK_SETTLE);
  };
  const events: [EventTarget, string][] = [
    [window, 'scroll'],
    [window, 'resize'],
    [document, 'focusout'],
    [viewport, 'scroll'],
    [viewport, 'resize'],
  ];
  for (const [target, type] of events) target.addEventListener(type, later, { passive: true });
  return () => {
    clearTimeout(settle);
    clearTimeout(back);
    for (const [target, type] of events) target.removeEventListener(type, later);
  };
}
