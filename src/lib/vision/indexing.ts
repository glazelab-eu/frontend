import type { LibraryPhoto } from './library';

/** Why the background indexing waits: the tab is hidden, the battery is low and not charging, there is no connection, or the connection is metered. */
export type PauseReason = 'offline' | 'hidden' | 'battery' | 'metered';

/** Below this charge, and not charging, the indexing waits (where the browser tells: Chromium's Battery Status API). */
export const LOW_BATTERY = 0.2;

export interface Conditions {
  online: boolean;
  hidden: boolean;
  /** Null where the browser does not say (Firefox, Safari): then it never pauses for the battery. */
  battery: { charging: boolean; level: number } | null;
  metered: boolean;
  /** The person agreed to use a metered connection (pressing "Index now" on one, or "Continue"). */
  meteredAllowed: boolean;
}

/** The reason the indexing must wait now, or null; the first that applies. */
export function pauseReason({ online, hidden, battery, metered, meteredAllowed }: Conditions): PauseReason | null {
  if (!online) return 'offline';
  if (hidden) return 'hidden';
  if (battery && !battery.charging && battery.level < LOW_BATTERY) return 'battery';
  if (metered && !meteredAllowed) return 'metered';
  return null;
}

/** The photos still to embed, in listing order: not stored yet and not skipped this session (gone, or unavailable just now). */
export function pendingPhotos(photos: ReadonlyMap<string, LibraryPhoto>, has: (id: string) => boolean, skipped: ReadonlySet<string>): LibraryPhoto[] {
  return [...photos.values()].filter((photo) => !has(photo.id) && !skipped.has(photo.id));
}

/** Stored IDs the library no longer lists: those photos were deleted, made private for someone else or moved to a new ID, so their vectors go. */
export function staleIds(stored: Iterable<string>, photos: ReadonlyMap<string, LibraryPhoto>): string[] {
  return [...stored].filter((id) => !photos.has(id));
}
