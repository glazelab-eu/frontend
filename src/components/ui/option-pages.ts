/**
 * Options a combobox renders at first and adds each time its list is scrolled near the end. A list shows fewer than ten;
 * thousands of options at once (a large library's matches for one letter) were seconds of DOM and layout on a slow phone.
 */
export const OPTION_PAGE = 50;

/** The options rendered, `start` up to (not including) `end`, as places among all matches. */
export interface OptionWindow {
  start: number;
  end: number;
}

/**
 * The options a list renders when it opens (or the text changes) with `active` the active option among `total` matches:
 * the first page, or one page around an active option further down (a chosen glaze far down the whole list, ArrowUp to
 * the last), never every option before it (PICK-1: 4,050 options for the last glaze were 0.7 to 1.4 s on the 4x phone).
 */
export function openWindow(active: number, total: number): OptionWindow {
  if (active < OPTION_PAGE) return { start: 0, end: Math.min(total, OPTION_PAGE) };
  const start = Math.max(0, Math.min(active - OPTION_PAGE / 2, total - OPTION_PAGE));
  return { start, end: Math.min(total, start + OPTION_PAGE) };
}

/**
 * The options rendered: the window, at least a page long, grown to the active option when the keys moved it past either edge, so that
 * `aria-activedescendant` names an element in the list and the active option can be scrolled into view, and never past
 * the matches (they may shrink under an open list).
 */
export function optionWindow(window: OptionWindow, active: number, total: number): OptionWindow {
  // At least a page from its start: options that arrive after the list opened (a picker whose options follow the text, such as
  // tag suggestions, opened with none) fill the window instead of staying out of it.
  const end = Math.min(total, Math.max(window.end, window.start + OPTION_PAGE, active + 1));
  const start = Math.min(window.start, active >= 0 ? active : window.start);
  return { start: Math.max(0, Math.min(start, end - 1)), end };
}

/** Whether a list scrolled this far is within one view of its end, where the next page of options is added. */
export function nearListEnd(scrollTop: number, viewHeight: number, scrollHeight: number): boolean {
  return scrollTop + 2 * viewHeight >= scrollHeight;
}

/** Whether a list scrolled this far is within one view of its start, where the page before the rendered ones is added. */
export function nearListStart(scrollTop: number, viewHeight: number): boolean {
  return scrollTop <= viewHeight;
}

/**
 * The active option among `total` matches: unchanged while it is still one of them, the last match when the matches
 * shrank under it (a sync delta, a removed glaze, while the list is open), none without matches. So
 * `aria-activedescendant` always names a real option.
 */
export function activeOption(active: number, total: number): number {
  return Math.min(active, total - 1);
}
