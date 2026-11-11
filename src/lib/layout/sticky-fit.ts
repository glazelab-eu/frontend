import { headerHeight } from './headroom';

/**
 * Whether a column of `height` px may stick to the top of a `viewport` px window: only when all of it fits with a gap of `gap` px
 * above and below, below a sticky header of `header` px (counted even where the header slides away, so the column does not flip between
 * sticking and not as the header comes and goes), else its lower part (the photo buttons) would stay out of reach until the page ends.
 * Unmeasured is false.
 */
export function fitsSticky(height: number, viewport: number, gap: number, header = 0): boolean {
  return height > 0 && viewport > 0 && height + 2 * gap + header <= viewport;
}

/**
 * Keeps `onChange` told whether `node` fits the window to stick (`fitsSticky`, the gap being 1rem), as its height, the header's or the
 * window changes; answers the cleanup.
 */
export function watchStickyFit(node: HTMLElement, onChange: (fits: boolean) => void): () => void {
  const measure = () => {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    onChange(fitsSticky(node.offsetHeight, window.innerHeight, rem, headerHeight()));
  };
  const header = document.querySelector('.app-nav');
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
  observer?.observe(node);
  if (header) observer?.observe(header);
  window.addEventListener('resize', measure);
  measure();
  return () => {
    observer?.disconnect();
    window.removeEventListener('resize', measure);
  };
}
