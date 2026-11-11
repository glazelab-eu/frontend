/** Studio's lists above the form (waiting for photos, drafts) fold behind a heading below 720 px and are always open on wider screens. */
export function foldExpanded(phone: boolean, open: boolean): boolean {
  return !phone || open;
}

/** The folded heading names the list and how many entries it holds, so the closed state still says what is inside. */
export function foldTitle(title: string, count: number): string {
  return `${title} (${count})`;
}
