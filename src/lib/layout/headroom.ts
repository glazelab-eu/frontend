import { routeKey, type Route } from '../routing/routes';

/** Pixels of scroll in one direction before the header changes: a small wobble of a finger or a wheel moves nothing. */
export const HEADROOM_TRAVEL = 12;

export interface Headroom {
  /** The header is slid out of view (the CSS does it only where the header is tall: under 70em). */
  hidden: boolean;
  /** Where the current run of scrolling in one direction began: the lowest position while shown, the highest while hidden. */
  anchor: number;
}

export const headroomStart: Headroom = { hidden: false, anchor: 0 };

/**
 * The header after the page scrolled to `y`. It hides after `HEADROOM_TRAVEL` px of scrolling down and returns after as many up;
 * within its own `height` of the top (and above it, as iOS bounces) it is always there. While `frozen` (a menu is open, focus is in the
 * header or in a field) it keeps its state, so nothing slides under a finger or the keyboard. Positions beyond `max` (the page's last scroll
 * position: iOS bounces past the end and springs back) count as `max`, so the bounce back at the end of a list is no scroll up.
 */
export function stepHeadroom(previous: Headroom, position: number, height: number, frozen: boolean, max = Infinity): Headroom {
  const y = Math.min(position, max);
  if (y <= height) return { hidden: false, anchor: y };
  if (frozen) return { hidden: previous.hidden, anchor: y };
  if (previous.hidden) {
    if (previous.anchor - y >= HEADROOM_TRAVEL) return { hidden: false, anchor: y };
    return { hidden: true, anchor: Math.max(previous.anchor, y) };
  }
  if (y - previous.anchor >= HEADROOM_TRAVEL) return { hidden: true, anchor: y };
  return { hidden: false, anchor: Math.min(previous.anchor, y) };
}

const EDITABLE =
  'textarea, select, [contenteditable]:not([contenteditable="false"]), input:not([type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="file"])';

/**
 * Whether the header must not move now: a menu of it is open, keyboard focus is inside it (`:focus-visible`: a button touched or clicked
 * keeps focus after its menu closed, which must not hold the header for good), a field has focus (the keyboard may be open), or a dialog
 * is open: the page may scroll behind one, and a dialog inside the header (the phone menu's scanner sheet) would go with it, since the
 * slid header's transform is the containing block of its fixed layer.
 */
function frozenNow(header: HTMLElement): boolean {
  if (document.querySelector('.modal') !== null || header.querySelector('[aria-expanded="true"]') !== null) return true;
  const active = document.activeElement;
  if (active === null) return false;
  return (header.contains(active) && active.matches(':focus-visible')) || active.matches(EDITABLE);
}

/**
 * Keeps the root's `--header-height` at the header's height (the CSS places sticky things below it and keeps focused fields clear of
 * it) and tells `onChange` whether the header is hidden, as the page scrolls (`stepHeadroom`). Focus moving into the header shows it.
 * Answers the cleanup.
 */
export function watchHeader(header: HTMLElement, onChange: (hidden: boolean) => void): () => void {
  const root = document.documentElement;
  let state = headroomStart;
  const apply = (next: Headroom) => {
    if (next.hidden !== state.hidden) onChange(next.hidden);
    state = next;
  };
  const measure = () => root.style.setProperty('--header-height', `${header.offsetHeight}px`);
  const onScroll = () => apply(stepHeadroom(state, window.scrollY, header.offsetHeight, frozenNow(header), root.scrollHeight - window.innerHeight));
  const onFocusIn = () => {
    if (header.contains(document.activeElement)) apply({ hidden: false, anchor: window.scrollY });
  };
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
  observer?.observe(header);
  measure();
  window.addEventListener('scroll', onScroll, { passive: true });
  header.addEventListener('focusin', onFocusIn);
  onScroll();
  return () => {
    observer?.disconnect();
    window.removeEventListener('scroll', onScroll);
    header.removeEventListener('focusin', onFocusIn);
    root.style.removeProperty('--header-height');
    onChange(false);
  };
}

/** The sticky header's height in px (0 when there is none), for a column that must fit below it. */
export function headerHeight(): number {
  return document.querySelector<HTMLElement>('.app-nav')?.offsetHeight ?? 0;
}

/**
 * Tapping the entry of the page already shown (the brand on Explore, the highlighted entry) leaves the route unchanged, so nothing scrolls:
 * this brings the page to its top, smoothly unless the person asks for less motion. Other taps navigate, and a new page starts at the top.
 * Plain primary clicks only: a modified click opens the link elsewhere.
 */
export function scrollTopOnSamePage(event: MouseEvent, current: Route, target: Route): void {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  if (routeKey(current) !== routeKey(target)) return;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: reduced ? 'instant' : 'smooth' });
}
