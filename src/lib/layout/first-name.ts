/** The first word of a display name (usually the first name), for places too narrow for the whole name; one long word stays whole, a blank name is empty. */
export function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/u)[0] ?? '';
}
