import { get, writable } from 'svelte/store';
import { api, ApiError } from '../api/client';
import { isImageType } from '../api/answers';
import type { User } from '../api/models';
import { forgetKeptAvatarUrls } from '../avatars/avatar';
import { clearEmbeddingsOf } from '../vision/embedding-store';
import { deleteSnapshot } from './snapshots';
export { readSnapshot, saveSnapshot } from './snapshots';

const prefix = 'glazelab:v1:';
const legacyPrefix = 'glazebook:v1:';
const imageCachePrefix = 'glazelab-images-';
const legacyImageCachePrefix = 'glazebook-images-';

function stored(key: string): string | null {
  try {
    return localStorage.getItem(prefix + key) ?? localStorage.getItem(legacyPrefix + key);
  } catch {
    return null;
  }
}

export function logoutPending() {
  return stored('pendingLogout') === '1';
}
export function setLogoutPending(value: boolean): void {
  if (value) localStorage.setItem(prefix + 'pendingLogout', '1');
  else localStorage.removeItem(prefix + 'pendingLogout');
  localStorage.removeItem(legacyPrefix + 'pendingLogout');
}
export function readLastUser(): User | null {
  try {
    const user = JSON.parse(stored('lastUser') || 'null') as User | null;
    // Saved before site admins existed; only the server's answer ever grants the flag. Saved before profile pictures: no picture.
    // Saved before error reports: off, which only the server's answer turns on. Saved before the activity feed: no badge, both sources on
    // (the defaults the server answers until the account changes them).
    return (
      user && {
        ...user,
        siteAdmin: user.siteAdmin === true,
        avatarId: user.avatarId ?? null,
        diagnosticsOptIn: user.diagnosticsOptIn === true,
        feedUnread: typeof user.feedUnread === 'number' ? user.feedUnread : 0,
        feedBuddies: user.feedBuddies !== false,
        feedClubs: user.feedClubs !== false,
      }
    );
  } catch {
    return null;
  }
}
export function saveLastUser(user: User | null): void {
  if (user) localStorage.setItem(prefix + 'lastUser', JSON.stringify(user));
  else localStorage.removeItem(prefix + 'lastUser');
  localStorage.removeItem(legacyPrefix + 'lastUser');
}
/** Cache Storage exists only in a secure context (not on plain-HTTP LAN development): there is nothing to delete without it. */
async function deleteCache(name: string): Promise<void> {
  if (typeof caches !== 'undefined') await caches.delete(name);
}
export async function clearPrivateCache(userId: string | null | undefined): Promise<void> {
  forgetLoadedImages();
  if (userId) {
    // Snapshots from before IndexedDB are never imported, but they hold private data too.
    try {
      localStorage.removeItem(prefix + userId);
      localStorage.removeItem(legacyPrefix + userId);
    } catch {
      /* Unavailable storage holds no snapshot. */
    }
    // The similar looks' vectors (33-2) are derived from this account's photos: they go with the copy.
    await Promise.all([
      deleteSnapshot(userId),
      deleteCache(imageCachePrefix + userId),
      deleteCache(legacyImageCachePrefix + userId),
      clearEmbeddingsOf(userId),
    ]);
  }
}
function imageCacheNames(userId: string | null | undefined): string[] {
  const owner = userId || 'guest';
  return [imageCachePrefix + owner, legacyImageCachePrefix + owner];
}

/**
 * A photo (`/api/images/<id>`, its card copy `/card`) or a profile picture (`/api/avatars/<id>`, its small copy `/small`, 31-2):
 * the same download, session and saved-copy rules for both, one Cache Storage per account.
 */
const pictureUrl = /^\/api\/(images|avatars)\/([^/?]+)(\/card|\/small)?$/;

/** What a picture URL asks for: the kind, the ID, and whether it is the smaller copy. */
interface Source {
  avatar: boolean;
  id: string;
  reduced: boolean;
}

/**
 * The picture a URL shows, as its full-size URL: the card size (`/api/images/<id>/card`, covers and
 * thumbnails) and the full size (`/api/images/<id>`, the detail gallery) are one picture, so dropping
 * or pruning a picture by its `url` takes both saved sizes. The same for a profile picture's small size.
 */
function pictureOf(url: string): string {
  return url.replace(/\/(card|small)$/, '');
}

/** Profile pictures are dropped by their ID when replaced or removed (`dropCachedImages`), never pruned by a listing of photos. */
const isPhoto = (path: string) => path.startsWith('/api/images/');

/**
 * Removes saved copies of pictures (both sizes), e.g. after their visibility changed. Best effort: an
 * unavailable cache holds nothing to remove.
 */
export async function dropCachedImages(userId: string | null | undefined, urls: string[]): Promise<void> {
  const gone = new Set(urls.map(pictureOf));
  forgetLoaded(userId, (path) => gone.has(pictureOf(path)));
  await pruneCache(userId, (path) => gone.has(pictureOf(path)));
}

/**
 * Keeps only the saved pictures (either size) a fresh listing still shows, so a picture that was removed,
 * moved to a new URL or is no longer shared with this account is not shown offline again.
 */
export async function pruneImageCache(userId: string | null | undefined, shown: Iterable<string>): Promise<void> {
  const keep = new Set([...shown].map(pictureOf));
  forgetLoaded(userId, (path) => isPhoto(path) && !keep.has(pictureOf(path)));
  await pruneCache(userId, (path) => isPhoto(path) && !keep.has(pictureOf(path)));
}

async function pruneCache(userId: string | null | undefined, remove: (path: string) => boolean): Promise<void> {
  for (const name of imageCacheNames(userId)) {
    try {
      if (!(await caches.has(name))) continue;
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        if (remove(new URL(request.url).pathname)) await cache.delete(request);
      }
    } catch {
      // Storage is optional; a later prune or a 4xx download removes what is left.
    }
  }
}

/**
 * Pictures downloaded in this session, by URL, for one account at a time, so card mounts and tab
 * switches neither fetch nor read the browser's HTTP cache again (which keeps club and private
 * pictures for a week, public ones for a year).
 * Each caller gets its own object URL of the shared Blob and revokes it itself, so no mounted view
 * loses its picture when another unmounts. Only fresh downloads are kept (never saved copies or
 * failures); the oldest entries go beyond `maxLoadedImages`, and pictures leave with their URL
 * (`dropCachedImages`, `pruneImageCache` after each load) or with the account (`clearPrivateCache`
 * or another user), so nobody keeps seeing a picture the listings no longer offer them.
 */
const maxLoadedImages = 200;
let loaded = { owner: '', blobs: new Map<string, Promise<Blob>>() };
/** Bumped whenever the session's pictures are forgotten; a download started before that never saves its copy. */
let generation = 0;

function loadedImages(userId: string | null | undefined): Map<string, Promise<Blob>> {
  const owner = userId || 'guest';
  if (loaded.owner !== owner) loaded = { owner, blobs: new Map() };
  return loaded.blobs;
}

/** Forgets every picture downloaded in this session, e.g. on sign-out or account change. */
export function forgetLoadedImages(): void {
  generation++;
  loaded = { owner: '', blobs: new Map() };
  forgetKeptAvatarUrls();
  goneAvatars = new Set();
  recentAvatar404s = [];
}

/**
 * Profile pictures (31-3). A picture ID the server answered 404 is never asked for again in this session (it was replaced or removed:
 * its ID does not come back, and the API's tarpit counts a picture 404 like any unknown image, 20 in 5 minutes means 15 minutes of
 * decoys for that address and account). Views of the same ID then show the initial without a request; the IDs of the lists are
 * refreshed through `onAvatarGone` instead. A burst of 404s (`AVATAR_404_LIMIT` IDs within `AVATAR_404_WINDOW_MS`, each may cost two requests
 * for its two sizes: well under the tarpit's 20) also stops new downloads for a while, whatever the cause. Saved copies and this
 * session's downloads are unaffected.
 */
let goneAvatars = new Set<string>();
export const AVATAR_404_LIMIT = 6;
export const AVATAR_404_WINDOW_MS = 5 * 60 * 1000;
let recentAvatar404s: number[] = [];
let avatarGone: (() => void) | undefined;

/** Registers what runs after a profile picture answered 404: the app reads the lists that name pictures again (throttled there). */
export function onAvatarGone(handler: (() => void) | undefined): void {
  avatarGone = handler;
}

/** Whether the burst limit is reached, so no new picture is downloaded for now. */
function avatar404sExhausted(): boolean {
  const since = Date.now() - AVATAR_404_WINDOW_MS;
  recentAvatar404s = recentAvatar404s.filter((time) => time > since);
  return recentAvatar404s.length >= AVATAR_404_LIMIT;
}

/**
 * Whether the profile picture IDs the views hold come from this session's answers. False while the saved snapshot of the account is
 * shown before the refresh finished (its IDs may name pictures replaced elsewhere: they show from saved copies only and are not
 * downloaded), true once a load finished. `Avatar` asks again for a missing picture when it turns true.
 */
export const avatarIdsConfirmed = writable(true);

function forgetLoaded(userId: string | null | undefined, remove: (path: string) => boolean) {
  forgetKeptAvatarUrls(remove);
  if (loaded.owner !== (userId || 'guest')) return;
  for (const url of [...loaded.blobs.keys()]) if (remove(url)) loaded.blobs.delete(url);
}

/** The session's download of `url`, shared by concurrent and later callers until forgotten. */
function loadedImage(url: string, source: Source, userId: string | null | undefined, timeout?: number): Promise<Blob> {
  const blobs = loadedImages(userId);
  const known = blobs.get(url);
  if (known) {
    // Most recently used last, so the bound drops the longest unused pictures.
    blobs.delete(url);
    blobs.set(url, known);
    return known;
  }
  const download = downloadImage(url, source, userId, timeout);
  blobs.set(url, download);
  if (blobs.size > maxLoadedImages) blobs.delete(blobs.keys().next().value!);
  // A failed download is retried by the next caller.
  download.catch(() => {
    if (blobs.get(url) === download) blobs.delete(url);
  });
  return download;
}

/** Only a picture's media type may be saved or shown: a proxy's page or the API's tarpit decoy answers 200 too. */
const isPicture = (response: Response) => isImageType(response.headers.get('Content-Type') ?? '');

async function downloadImage(url: string, source: Source, userId: string | null | undefined, timeout?: number) {
  const started = generation;
  // A download that has a saved copy to fall back on gives up after `timeout` without an answer, on a connection that neither
  // answers nor fails. Only the answer is timed: a slow but working connection may take longer for the body (a full size).
  const abort = new AbortController();
  const timer = timeout === undefined ? undefined : setTimeout(() => abort.abort(), timeout);
  try {
    const signal = timeout === undefined ? undefined : abort.signal;
    const response = source.avatar
      ? await api.avatar(source.id, source.reduced ? 'small' : 'full', signal)
      : await api.image(source.id, source.reduced ? 'card' : 'full', signal);
    clearTimeout(timer);
    if (!response.ok) {
      throw Object.assign(new Error('Image unavailable'), { status: response.status });
    }
    if (!isPicture(response)) {
      // A decoy or a portal page is never saved or shown: like a server failure, the saved other size shows.
      void response.body?.cancel().catch(() => {});
      throw Object.assign(new Error('Image unavailable'), { status: 502 });
    }
    try {
      // A cleared account's cache must not come back with a picture that was still downloading.
      if (started === generation) {
        const cache = await caches.open(imageCachePrefix + (userId || 'guest'));
        await cache.put(url, response.clone());
        if (started !== generation) await cache.delete(url);
      }
    } catch {
      // Storage is optional, and quota or private-mode restrictions must not discard the download.
    }
    return await response.blob();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether the app thinks the network is there: the app state's `online` (set by the controller, which is false after an
 * unreachable answer even when the browser still reports online) and the browser's own `navigator.onLine`. Pictures that
 * are not saved are not requested while this is false; views retry a missing picture when it turns true.
 */
export const networkReachable = writable(true);
const networkUp = () => globalThis.navigator?.onLine !== false && get(networkReachable);

/** How long a download waits when the app has a saved copy of the picture (the other size) to show instead. */
export const SAVED_DOWNLOAD_TIMEOUT_MS = 4000;

/**
 * An object URL for a picture URL of either size (`ImageInfo.url` or `cardUrl`). Image bytes never change for an ID
 * (a new visibility makes a new ID) and the listings prune the saved copies of pictures that are gone or no longer
 * shared, so: this session's download if there is one, else the saved copy of that size straight away (no network, so
 * a dead connection that neither answers nor fails costs nothing), else, unless the app knows it is offline, a fresh
 * download (saved for offline use under that URL; limited to `SAVED_DOWNLOAD_TIMEOUT_MS` when the other size is
 * saved), whose failure shows the saved copy of the other size of the same picture (a card shows a saved full size, a
 * gallery a saved card). A download answered 4xx drops both saved sizes (gone or no longer shared) and shows nothing.
 */
export async function imageUrl(url: string, userId: string | null | undefined): Promise<string | null> {
  const match = pictureUrl.exec(url);
  if (!match) return null;
  const [, kind, id, copy] = match;
  const source: Source = { avatar: kind === 'avatars', id, reduced: !!copy };
  if (source.avatar && goneAvatars.has(id)) return null;
  const started = generation;
  /** An object URL of a saved copy, unless the saved copies were cleared (another account) meanwhile. */
  const show = (blob: Blob | undefined) => (blob && started === generation ? URL.createObjectURL(blob) : null);
  let other: Promise<Blob | undefined> | undefined;
  const otherSize = () => (other ??= savedBlob(source.reduced ? pictureOf(url) : `${url}/${source.avatar ? 'small' : 'card'}`, userId));
  const inSession = loadedImages(userId).has(url);
  if (!inSession) {
    const saved = await savedBlob(url, userId);
    if (saved) return show(saved);
    if (!networkUp()) return show(await otherSize());
    // A profile picture ID that may be stale, or too many 404s lately: no new request (a saved size of it shows).
    if (source.avatar && (!get(avatarIdsConfirmed) || avatar404sExhausted())) return show(await otherSize());
  }
  try {
    const timeout = inSession || !(await otherSize()) ? undefined : SAVED_DOWNLOAD_TIMEOUT_MS;
    return URL.createObjectURL(await loadedImage(url, source, userId, timeout));
  } catch (error) {
    if (
      error instanceof Error &&
      'status' in error &&
      typeof error.status === 'number' &&
      // Status 0 means unreachable (offline): show the saved copy.
      error.status > 0 &&
      error.status < 500 &&
      // Rate limited: show the saved copy, as when the server fails.
      error.status !== 429
    ) {
      // Gone or no longer shared: never show the saved copy again, not even offline.
      // Counted once per ID: views that shared the download all see the same answer.
      if (source.avatar && error.status === 404 && !goneAvatars.has(id)) {
        goneAvatars.add(id);
        recentAvatar404s.push(Date.now());
        avatarGone?.();
      }
      await dropCachedImages(userId, [url]);
      return null;
    }
    return show(await otherSize());
  }
}

/** The saved copy of a picture URL, or nothing when there is none or storage is unavailable. */
async function savedBlob(url: string, userId: string | null | undefined): Promise<Blob | undefined> {
  try {
    return await (await savedImage(url, userId))?.blob();
  } catch {
    return undefined;
  }
}

async function savedImage(url: string, userId: string | null | undefined): Promise<Response | undefined> {
  const owner = userId || 'guest';
  return (
    (await (await caches.open(imageCachePrefix + owner)).match(url)) ||
    ((await caches.has(legacyImageCachePrefix + owner)) ? await (await caches.open(legacyImageCachePrefix + owner)).match(url) : undefined)
  );
}

/**
 * What `pictureBlob` found: the bytes, or why there are none. `gone`: refused for this account (a 4xx but 401 and 429), its
 * saved copies dropped; `signed-out`: a 401, the session ended, the saved copies stay; `unavailable`: a rate limit or a server
 * problem with the API's message (`retryAfterMs`: the 429's `Retry-After`); `unreachable`: a request that found no server (a
 * network failure, a proxy's 5xx page, a 200 that is no picture); `offline`: no request, as the app has no connection just now.
 */
export type PictureBlob =
  | { ok: true; blob: Blob }
  | { ok: false; reason: 'gone' | 'signed-out' | 'unreachable' | 'offline' }
  | { ok: false; reason: 'unavailable'; retryAfterMs?: number };

/**
 * The bytes of a picture for the indexing of the similar looks (33-2), without showing it: the saved copy if there is one, else
 * one download when the network is up. A downloaded copy is NOT saved (indexing a library of thousands would fill the offline
 * cache with pictures nobody opened) and not kept in the session's pictures; the browser's HTTP cache still holds it as for any
 * picture. A refusal (`gone`) drops the saved copies like `imageUrl` does; a 401 does not (FE-3).
 */
export async function pictureBlob(url: string, userId: string | null | undefined): Promise<PictureBlob> {
  const match = pictureUrl.exec(url);
  if (!match || match[1] !== 'images') return { ok: false, reason: 'gone' };
  const saved = await savedBlob(url, userId);
  if (saved) return { ok: true, blob: saved };
  if (!networkUp()) return { ok: false, reason: 'offline' };
  try {
    const response = await api.image(match[2], match[3] ? 'card' : 'full');
    if (response.ok && isPicture(response)) return { ok: true, blob: await response.blob() };
    void response.body?.cancel().catch(() => {});
  } catch (error) {
    // The client throws an `ApiError` for every error answer (status 0: no answer from the API itself).
    const status = error instanceof ApiError ? error.status : 0;
    if (status === 401) return { ok: false, reason: 'signed-out' };
    if (status === 429 || status >= 500) return { ok: false, reason: 'unavailable', retryAfterMs: (error as ApiError).retryAfterMs };
    if (status > 0) {
      await dropCachedImages(userId, [url]);
      return { ok: false, reason: 'gone' };
    }
  }
  return { ok: false, reason: 'unreachable' };
}
