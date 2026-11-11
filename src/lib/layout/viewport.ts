/** The one phone breakpoint: below 720 px; 720 px itself is the wide layout. CSS uses the same `(width < 45em)`. */
export const PHONE_QUERY = '(width < 45em)';

/** Whether the viewport is a phone now (false where `matchMedia` does not exist). */
export function isPhone(): boolean {
  return globalThis.matchMedia?.(PHONE_QUERY).matches ?? false;
}

/**
 * Reports the current phone state at once and on every change; returns the cleanup that removes the
 * listener, so `$effect(() => phoneMedia((phone) => (value = phone)))` and `onMount` can return it.
 */
export function phoneMedia(onChange: (phone: boolean) => void): () => void {
  const media = globalThis.matchMedia?.(PHONE_QUERY);
  if (!media) {
    onChange(false);
    return () => {};
  }
  const changed = () => onChange(media.matches);
  changed();
  media.addEventListener('change', changed);
  return () => media.removeEventListener('change', changed);
}
