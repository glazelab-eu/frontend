import type { Combination, Glaze, ImageInfo, Snapshot, Step } from '../api/models';
import { emptyBuddies } from '../buddies/buddies';
import { emptyAvailability } from '../stock/buddy-shelf';
import { validPoint, type SyncPoint } from '../sync/sync';

/** Snapshots saved before manufacturers name the glaze's brand instead. */
type Legacy = { brand?: string };
function withManufacturer<T extends { manufacturer: string }>(item: T): T {
  const { brand, ...current } = item as T & Legacy;
  return { ...current, manufacturer: item.manufacturer ?? brand ?? '' } as T;
}

/** Snapshots saved before custom steps have only glaze steps, without a type or label. */
function withStepType(step: Step): Step {
  const { brand, ...current } = step as Step & Legacy;
  if (step.type === 'CUSTOM')
    return {
      ...current,
      label: step.label ?? '',
      glazeId: null,
      coats: null,
      manufacturer: null,
      name: null,
    };
  return {
    ...current,
    type: 'GLAZE',
    label: null,
    manufacturer: step.manufacturer ?? brand ?? '',
  };
}

/**
 * Pictures saved before owners could change visibility carry no owner flag or club, those
 * saved before uploaders were named keep NO `uploader` (undefined, not null: null means a deleted account), and those saved before card copies no card URL
 * (the API's card URL of a picture is its URL plus `/card`).
 */
function withImageOwner(image: ImageInfo): ImageInfo {
  return {
    ...image,
    cardUrl: image.cardUrl ?? `${image.url}/card`,
    own: image.own ?? false,
    clubId: image.clubId ?? null,
    caption: image.caption ?? null,
    firedOn: image.firedOn ?? null,
  };
}

// Serialize transactions so a sign-out deletion cannot be overtaken by an earlier save.
let pending: Promise<unknown> = Promise.resolve();
/** One transaction on the snapshot store: `run` issues its requests and answers how to read the result once it completed. */
function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => () => T): Promise<T> {
  const operation = pending.then(
    () =>
      new Promise<T>((resolve, reject) => {
        const opening = indexedDB.open('glazelab-offline', 1);
        let blocked = false;
        opening.onupgradeneeded = () => opening.result.createObjectStore('snapshots');
        opening.onerror = () => reject(opening.error);
        opening.onblocked = () => {
          blocked = true;
          reject(new Error('Offline storage is blocked'));
        };
        opening.onsuccess = () => {
          const db = opening.result;
          if (blocked) {
            db.close();
            return;
          }
          db.onversionchange = () => db.close();
          try {
            const tx = db.transaction('snapshots', mode);
            const result = run(tx.objectStore('snapshots'));
            tx.oncomplete = () => {
              db.close();
              resolve(result());
            };
            tx.onabort = () => {
              db.close();
              reject(tx.error ?? new Error('Offline storage transaction aborted'));
            };
          } catch (error) {
            db.close();
            reject(error);
          }
        };
      }),
  );
  pending = operation.catch(() => {});
  return operation;
}

/** Local form recovery shares the account's store and sign-out deletion order; it is never a queued API request. */
export function readStudioRecovery(owner: string, route: string): Promise<unknown> {
  return transaction('readonly', (store) => {
    const request = store.get(`${owner}/studio/${route}`);
    return () => request.result;
  });
}

export function saveStudioRecovery(owner: string, route: string, value: unknown): Promise<void> {
  return transaction('readwrite', (store) => {
    store.put(value, `${owner}/studio/${route}`);
    return () => undefined;
  });
}

/** A completed save must not erase a newer recovery written by another tab. */
export function deleteStudioRecovery(owner: string, route: string, revision: string): Promise<void> {
  return transaction('readwrite', (store) => {
    const key = `${owner}/studio/${route}`;
    const request = store.get(key);
    request.onsuccess = () => {
      if (request.result?.revision === revision) store.delete(key);
    };
    return () => undefined;
  });
}

/**
 * Keys of the store, per owner (an account ID or `guest`): the snapshot itself, its sync point beside it (written in
 * the snapshot's transaction, or alone when the listings did not change), and an unfinished paged full load: its
 * progress and one record per saved page. Everything of an owner sorts between `owner/` and `owner/￿`.
 */
const ownerKey = (userId: string | null | undefined) => userId || 'guest';
const pointKey = (owner: string) => `${owner}/sync`;
const firstKey = (owner: string) => `${owner}/first`;
const pageKey = (owner: string, index: number) => `${firstKey(owner)}/${String(index).padStart(6, '0')}`;
const allOf = (owner: string) => IDBKeyRange.bound(`${owner}/`, `${owner}/￿`);
const firstSyncOf = (owner: string) => IDBKeyRange.bound(firstKey(owner), `${firstKey(owner)}￿`);
const pagesOf = (owner: string) => IDBKeyRange.bound(`${firstKey(owner)}/`, `${firstKey(owner)}/￿`);

/** A combination as saved by any earlier version, in today's shape. */
function normalizeCombination(combo: Combination): Combination {
  return {
    ...combo,
    steps: (combo.steps ?? []).map(withStepType),
    images: (combo.images ?? []).map(withImageOwner),
    tags: combo.tags ?? [],
    authorId: combo.authorId ?? null,
    own: combo.own ?? false,
    stepsLocked: combo.stepsLocked ?? false,
    // Saved before drafts: everything listed was published.
    draft: combo.draft ?? false,
    // Saved before publication dates: unknown, so the creation time stands in.
    publishedAt: combo.publishedAt ?? null,
    // Saved before variations remembered their source.
    basedOnId: combo.basedOnId ?? null,
    // Saved before the final firing was recorded: none.
    cone: combo.cone ?? null,
    temperatureC: combo.temperatureC ?? null,
    atmosphere: combo.atmosphere ?? null,
    clayBody: combo.clayBody ?? null,
    kiln: combo.kiln ?? null,
    firedOn: combo.firedOn ?? null,
  };
}

/** Normalize older snapshot formats, but never migrate localStorage snapshots. */
function normalize(saved: Snapshot): Snapshot {
  return {
    glazes: (saved.glazes ?? []).map((glaze) => {
      const { brand, ...current } = glaze as Glaze & Legacy;
      return {
        ...current,
        // Before manufacturers: a free-text brand and an optional code; the placeholder has no ID.
        manufacturer: glaze.manufacturer ?? { id: '', shortId: '', name: brand ?? '' },
        code: glaze.code ?? '',
        images: (glaze.images ?? []).map(withImageOwner),
        tags: glaze.tags ?? [],
        barcodes: glaze.barcodes ?? [],
        // Saved before glazes had dates: unknown (''), so such a glaze never counts as new.
        createdAt: glaze.createdAt ?? '',
        addedBy: glaze.addedBy ?? null,
        // Saved before glazes could be corrected: never edited.
        lastEditedAt: glaze.lastEditedAt ?? null,
        lastEditedBy: glaze.lastEditedBy ?? null,
      };
    }),
    combinations: (saved.combinations ?? []).map(normalizeCombination),
    // Saved before jar sizes: unknown. Saved before club entries named their adder: none, and only personal entries are
    // known to be removable (offline nothing is removed; the next load answers for the club's). Saved before buddies:
    // nothing kept private.
    stock: (saved.stock ?? []).map((item) => ({
      ...withManufacturer(item),
      jarSizeG: item.jarSizeG ?? null,
      addedById: item.addedById ?? null,
      canRemove: item.canRemove ?? !item.clubId,
      keepPrivate: item.keepPrivate ?? false,
    })),
    clubs: saved.clubs ?? [],
    // Saved before every member could read the member list: unknown.
    clubMembers: saved.clubMembers ?? {},
    // Saved before buddies: none known (the next load fetches them).
    buddies: saved.buddies ?? emptyBuddies(),
    // Saved before buddy availability: none known, and the next load reads it.
    buddyAvailability: saved.buddyAvailability ?? emptyAvailability(),
    // Saved before authors showed profile pictures: none known (the next load reads them).
    authorAvatars: saved.authorAvatars ?? {},
    favorites: saved.favorites ?? { glazeIds: [], combinationIds: [] },
    ...(saved.favoriteCounts && { favoriteCounts: saved.favoriteCounts }),
  };
}

/**
 * The saved snapshot of an account (or the guest) and the sync point it was saved at, read together so a concurrent
 * save never pairs one with the other's successor. The point is null when it is missing or of an older layout (the
 * snapshot from before the incremental sync shows, then loads in full).
 */
export async function readSaved(userId: string | null | undefined): Promise<{ snapshot: Snapshot; point: SyncPoint | null } | null> {
  const owner = ownerKey(userId);
  const saved = await transaction('readonly', (store) => {
    const snapshot = store.get(owner);
    const point = store.get(pointKey(owner));
    return () => ({ snapshot: snapshot.result as Snapshot | undefined, point: point.result as unknown });
  });
  if (!saved.snapshot) return null;
  return { snapshot: normalize(saved.snapshot), point: validPoint(saved.point) };
}

export async function readSnapshot(userId: string | null | undefined): Promise<Snapshot | null> {
  return (await readSaved(userId))?.snapshot ?? null;
}

/**
 * Saves the snapshot with the sync point its listings are at (none: the next load is a full one). `firstSyncDone`
 * also drops the pages of the paged full load that produced it, in the same transaction.
 */
export async function saveSnapshot(
  userId: string | null | undefined,
  snapshot: Snapshot,
  point: SyncPoint | null = null,
  firstSyncDone = false,
): Promise<void> {
  const owner = ownerKey(userId);
  await transaction('readwrite', (store) => {
    store.put(snapshot, owner);
    if (point) store.put(point, pointKey(owner));
    else store.delete(pointKey(owner));
    if (firstSyncDone) store.delete(firstSyncOf(owner));
    return () => undefined;
  });
}

/**
 * Moves the sync point of a saved snapshot whose listings a delta did not change, without writing them again, but only
 * while the device still holds the snapshot saved at `from`: another tab may have saved its own listings since, at an
 * older point, and moving the point over them would skip changes for good. Otherwise `snapshot` is saved with the point.
 * `firstSyncDone` also drops the pages of an unfinished paged load, in the same transaction.
 */
export async function saveSyncPoint(
  userId: string | null | undefined,
  from: SyncPoint,
  point: SyncPoint,
  snapshot: Snapshot,
  firstSyncDone = false,
): Promise<void> {
  const owner = ownerKey(userId);
  await transaction('readwrite', (store) => {
    const stored = store.get(pointKey(owner));
    stored.onsuccess = () => {
      const saved = validPoint(stored.result);
      const same = !!saved && saved.cursor === from.cursor && saved.epoch === from.epoch && saved.format === from.format;
      if (!same) store.put(snapshot, owner);
      store.put(point, pointKey(owner));
      if (firstSyncDone) store.delete(firstSyncOf(owner));
    };
    return () => undefined;
  });
}

/**
 * A paged full load in progress: the sync point taken before its first page (the cursor the finished listing starts
 * from), the number of combinations the listing had then (`total`, the "m" of "n of m"), the next page's `after`
 * (null once the last page arrived) and how many pages are saved.
 */
export interface FirstSync {
  point: SyncPoint;
  total: number;
  next: string | null;
  pages: number;
}

/**
 * The unfinished paged full load of an owner with the combinations of its saved pages, or null: none, of another
 * client layout, or with pages missing (it then starts again).
 */
export async function readFirstSync(userId: string | null | undefined): Promise<{ progress: FirstSync; combinations: Combination[] } | null> {
  const owner = ownerKey(userId);
  const saved = await transaction('readonly', (store) => {
    const progress = store.get(firstKey(owner));
    const pages = store.getAll(pagesOf(owner));
    return () => ({ progress: progress.result as Partial<FirstSync> | undefined, pages: pages.result as Combination[][] });
  });
  const progress = saved.progress;
  const point = validPoint(progress?.point);
  if (!progress || !point || typeof progress.total !== 'number' || typeof progress.pages !== 'number' || progress.next === undefined) return null;
  if (saved.pages.length !== progress.pages) return null;
  return { progress: { point, total: progress.total, next: progress.next, pages: progress.pages }, combinations: saved.pages.flat().map(normalizeCombination) };
}

/**
 * Saves one page of a paged full load with the progress after it, in one transaction; the first page (index 0)
 * replaces whatever an earlier, abandoned load left.
 */
export async function saveFirstSyncPage(userId: string | null | undefined, progress: FirstSync, index: number, combinations: Combination[]): Promise<void> {
  const owner = ownerKey(userId);
  await transaction('readwrite', (store) => {
    if (index === 0) store.delete(firstSyncOf(owner));
    store.put(combinations, pageKey(owner, index));
    store.put(progress, firstKey(owner));
    return () => undefined;
  });
}

/** Removes an account's snapshot with its sync point and any unfinished paged load. */
export async function deleteSnapshot(userId: string): Promise<void> {
  await transaction('readwrite', (store) => {
    store.delete(userId);
    store.delete(allOf(userId));
    return () => undefined;
  });
}
