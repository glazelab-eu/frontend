/** Where a chip sits in a horizontally scrolling row: its edges in the row's content, the row's own scroll state. */
export interface ChipScroll {
  chipLeft: number;
  chipRight: number;
  scrollLeft: number;
  viewWidth: number;
  scrollWidth: number;
  /** The width the row fades at each end while more chips lie beyond it; the chip must clear it. */
  fade: number;
}

/**
 * The scroll offset that shows a chip clear of the row's fades: the current one when the chip is
 * already there, else the one that puts it at the start edge behind the left fade (the row's
 * `scroll-padding`, so the scroll snap agrees), clamped to the content.
 */
export function chipScrollLeft({ chipLeft, chipRight, scrollLeft, viewWidth, scrollWidth, fade }: ChipScroll): number {
  // A chip under a fade at the very start or end (where no fade shows) gets the offset it already has from the clamp.
  if (chipLeft >= scrollLeft + fade && chipRight <= scrollLeft + viewWidth - fade) return scrollLeft;
  return Math.min(Math.max(0, scrollWidth - viewWidth), Math.max(0, chipLeft - fade));
}

/** Whether chips lie beyond the row's start and end edges (the fades show there). */
export function scrollEdges(scrollLeft: number, viewWidth: number, scrollWidth: number): { start: boolean; end: boolean } {
  // Half a pixel of rounding slack: fractional scroll positions never leave a fade over nothing.
  return { start: scrollLeft > 0.5, end: scrollLeft + viewWidth < scrollWidth - 0.5 };
}
