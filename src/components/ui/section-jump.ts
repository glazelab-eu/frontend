/**
 * Brings a page section into view and puts the focus on its heading (an `h2` with `tabindex="-1"`, as `PanelTitle` renders). `reveal`
 * names an element inside it that must be on the screen too (its controls): it is scrolled in with `nearest`, which keeps the heading
 * in view where it fits and respects the root's scroll padding (the sticky header, the phone's bottom navigation).
 */
export function jumpToSection(id: string, reveal?: string): boolean {
  const section = document.getElementById(id);
  if (!section) return false;
  section.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  section.scrollIntoView({ block: 'start' });
  if (reveal) document.getElementById(reveal)?.scrollIntoView({ block: 'nearest' });
  return true;
}

/**
 * Decides when a page opened at a section (`?section=…`) jumps there: once per arrival, so the page reading its data again does not
 * move it twice, and again after it was shown without a section (the bare address or Back to it) or with another one. `ready` is
 * whether the section is rendered; the answer is the section to jump to now, if any.
 */
export function createJumpGuard<T extends string>() {
  let jumped: T | undefined;
  return (ready: boolean, target: T | undefined): T | undefined => {
    if (!target) {
      jumped = undefined;
      return undefined;
    }
    if (!ready || jumped === target) return undefined;
    jumped = target;
    return target;
  };
}
