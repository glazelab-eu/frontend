/** What `viewportStuck` reads of `window.visualViewport`. */
type Viewport = Pick<VisualViewport, 'offsetTop' | 'height' | 'scale'>;

/** Wait after the last scroll, resize, focus or app switch before checking (ms): the keyboard has finished closing. */
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

/**
 * Whether a Home Screen app's window is stuck short: over 4 px shorter than the tallest it has been at this width. iOS 17 and 18 can keep
 * `innerHeight`, the visual viewport and `100dvh` all at the height they had with the keyboard up, so `viewportStuck` sees nothing while the
 * fixed bars float that far above the screen's foot. Only for standalone: in the browser its toolbars shorten the window on purpose.
 */
export function windowShort(innerHeight: number, tallest: number): boolean {
  return innerHeight < tallest - 4;
}

/** Whether focus is in a field, so the soft keyboard may be up. */
const typing = (element: Element | null) => !!element && ((element as HTMLElement).isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName));

/**
 * Puts the fixed bars back where iOS left them mid-screen, once per occurrence, `STUCK_SETTLE` ms after things settled and never while typing:
 * a stuck viewport (`viewportStuck`) gets the page scrolled 1 px and back (confirmed on an iPhone in Sedna.UI #172); a Home Screen app's window
 * stuck short (`windowShort`) first gets `root` emptied for one synchronous layout, never painted, with its scroll and focus kept, which makes
 * iOS measure the window again. Answers the cleanup; does nothing where `visualViewport` is missing.
 */
export function watchStuckViewport(root: HTMLElement): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  const standalone = window.matchMedia?.('(display-mode: standalone)');
  /** The tallest window seen per width, so a turn of the phone is not taken for a short window. */
  const tallest = new Map<number, number>();
  let settle: ReturnType<typeof setTimeout> | undefined;
  let back: ReturnType<typeof setTimeout> | undefined;
  let fixed = false;
  const relayout = () => {
    const { scrollX, scrollY } = window;
    const focused = document.activeElement as HTMLElement | null;
    root.style.display = 'none';
    void root.offsetHeight;
    root.style.display = '';
    window.scrollTo({ left: scrollX, top: scrollY, behavior: 'instant' });
    focused?.focus?.({ preventScroll: true });
  };
  const check = () => {
    const { innerWidth: width, innerHeight: height } = window;
    const top = Math.max(tallest.get(width) ?? 0, height);
    tallest.set(width, top);
    const short = !!standalone?.matches && windowShort(height, top);
    if (!short && !viewportStuck(viewport, height)) return void (fixed = false);
    if (fixed || typing(document.activeElement)) return;
    fixed = true;
    if (short) relayout();
    const step = window.scrollY > 0 ? -1 : 1;
    window.scrollBy({ top: step, behavior: 'instant' });
    // A timer, not a frame: iOS may not paint the stuck page, and a frame would wait for it. Its own timer: the nudge's scroll restarts `settle`.
    back = setTimeout(() => window.scrollBy({ top: -step, behavior: 'instant' }), 50);
  };
  const later = () => {
    clearTimeout(settle);
    settle = setTimeout(check, STUCK_SETTLE);
  };
  const events: [EventTarget, string][] = [
    [window, 'scroll'],
    [window, 'resize'],
    [window, 'pageshow'],
    [document, 'focusout'],
    [document, 'visibilitychange'],
    [viewport, 'scroll'],
    [viewport, 'resize'],
  ];
  for (const [target, type] of events) target.addEventListener(type, later, { passive: true });
  later();
  return () => {
    clearTimeout(settle);
    clearTimeout(back);
    for (const [target, type] of events) target.removeEventListener(type, later);
  };
}
