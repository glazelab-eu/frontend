/** Profile picture rules around the crop (31-2): which chosen files are tried, when the dialog may send, which URLs a picture has. */
import { looksHeic } from '../images/heic';

/** The largest file the dialog tries to read: the browser decodes it in memory and cuts a small square from it, so it may exceed the API's 12 MB photo limit. */
export const MAX_AVATAR_SOURCE_BYTES = 40_000_000;

export type AvatarFileProblem = 'empty' | 'notImage' | 'tooLarge';

/**
 * Why a chosen file is not offered for cropping, or null. An unreadable image (a format the browser cannot decode) is found when it
 * loads. A HEIC/HEIF photo counts as an image by its name too (iOS gives files from the Files app or AirDrop an empty type); the
 * dialog converts it (24-17, `lib/images/heic.ts`).
 */
export function avatarFileProblem(file: Pick<File, 'size' | 'type' | 'name'>): AvatarFileProblem | null {
  if (file.size === 0) return 'empty';
  if (!file.type.startsWith('image/') && !looksHeic(file)) return 'notImage';
  if (file.size > MAX_AVATAR_SOURCE_BYTES) return 'tooLarge';
  return null;
}

export interface SaveState {
  /** The privacy notice (who sees the picture, and the content rule) is on the screen of the dialog. */
  noticeShown: boolean;
  /** The chosen picture is decoded, so there is a crop to send. */
  ready: boolean;
  online: boolean;
  /** A send is running. */
  busy: boolean;
}

/** The one rule for the dialog's Save: nothing is sent before the notice is shown, and never twice, offline or without a picture. */
export function canSaveAvatar({ noticeShown, ready, online, busy }: SaveState): boolean {
  return noticeShown && ready && online && !busy;
}

/** The URLs of a profile picture's two sizes: 256 px (the account page) and 64 px (the header and lists). */
export function avatarUrls(id: string): { full: string; small: string } {
  return { full: `/api/avatars/${id}`, small: `/api/avatars/${id}/small` };
}

/**
 * Object URLs of profile pictures that were shown, kept for the session so a view that is created again (every page change builds
 * the header's avatar anew) starts with the picture instead of the initial letter and loads it no second time. Keyed by the account
 * that looks and the picture URL; revoked when the session's downloads are forgotten (sign-out, another account) or the picture is gone.
 */
const keptUrls = new Map<string, string>();
const keptKey = (viewerId: string | null | undefined, url: string) => `${viewerId || 'guest'}|${url}`;

/** The object URL kept for this picture, if it was shown before in this session. */
export function keptAvatarUrl(viewerId: string | null | undefined, url: string): string | undefined {
  return keptUrls.get(keptKey(viewerId, url));
}

/** Keeps `objectUrl` for later views of `url`; returns the one to use (an earlier kept URL wins and the new one is revoked). */
export function keepAvatarUrl(viewerId: string | null | undefined, url: string, objectUrl: string): string {
  const key = keptKey(viewerId, url);
  const existing = keptUrls.get(key);
  if (existing && existing !== objectUrl) {
    URL.revokeObjectURL(objectUrl);
    return existing;
  }
  keptUrls.set(key, objectUrl);
  return objectUrl;
}

/** Forgets the kept URLs of pictures for which `gone(url)` holds (all of them without an argument). */
export function forgetKeptAvatarUrls(gone?: (url: string) => boolean): void {
  for (const [key, objectUrl] of [...keptUrls]) {
    if (gone && !gone(key.slice(key.indexOf('|') + 1))) continue;
    URL.revokeObjectURL(objectUrl);
    keptUrls.delete(key);
  }
}
