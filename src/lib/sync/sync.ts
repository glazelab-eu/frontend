import type { Combination, Glaze } from '../api/models';
import type { SyncView } from '../generated/types.gen';
import { newestFirst } from '../explore/listing';
import { isGlazeStep } from '../glazes/steps';

/**
 * The layout of the sync point and the listings this client stores. A saved sync point of another layout is
 * dropped (the snapshot still shows, then loads in full); bump it when a stored shape changes on the client side (2: pictures carry their uploader's name, so a snapshot without them loads in full).
 */
export const CLIENT_FORMAT = 2;

/** Combinations per request of a paged full load (the API's maximum). */
export const PAGE_SIZE = 1000;

export type ResyncReason = NonNullable<SyncView['resync']>;

/**
 * Where the stored listings stand in the server's change log: `cursor` and `epoch` exactly as the server sent them
 * (opaque), `format` the server's view format they were read in, `client` this client's `CLIENT_FORMAT`.
 */
export interface SyncPoint {
  cursor: string;
  epoch: string;
  format: number;
  client: number;
}

export interface Listings {
  glazes: Glaze[];
  combinations: Combination[];
}

/** What a sync answer means for listings at `point`. */
export type DeltaOutcome =
  | { kind: 'applied'; listings: Listings; point: SyncPoint; changed: boolean }
  /** Load in full, starting at `start` (the answer's own cursor: it was taken before anything a later listing read sees). */
  | { kind: 'resync'; reason: ResyncReason | 'COUNTS'; start: SyncPoint };

/** The sync point an answer starts (a full load from a resync answer, or after a delta). */
export function pointOf(answer: Pick<SyncView, 'cursor' | 'epoch' | 'format'>): SyncPoint {
  return { cursor: answer.cursor, epoch: answer.epoch, format: answer.format, client: CLIENT_FORMAT };
}

/** A stored sync point, or null when it is missing, incomplete or written by another client layout (load in full). */
export function validPoint(saved: unknown): SyncPoint | null {
  const point = saved as Partial<SyncPoint> | null | undefined;
  if (!point || typeof point.cursor !== 'string' || !point.cursor || typeof point.epoch !== 'string' || typeof point.format !== 'number') return null;
  return point.client === CLIENT_FORMAT ? { cursor: point.cursor, epoch: point.epoch, format: point.format, client: point.client } : null;
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });
const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The glaze listing's order: manufacturer, then name (the API's order). */
export function glazeOrder(a: Glaze, b: Glaze): number {
  return byName(a.manufacturer.name, b.manufacturer.name) || byName(a.name, b.name);
}

/** The combination listing's order: newest first by publication (a draft by creation), then by ID. */
export function combinationOrder(a: Combination, b: Combination): number {
  return newestFirst(a, b) || byId(a.id, b.id);
}

/** A combination listing read in pages by ID, in listing order. */
export function listingOf(combinations: Combination[]): Combination[] {
  return [...combinations].sort(combinationOrder);
}

/** Both lists in `order`: `kept` keeps its own order, each of `added` (sorted) goes before the first kept item after it. */
function merge<T>(kept: T[], added: T[], order: (a: T, b: T) => number): T[] {
  const merged: T[] = [];
  let i = 0;
  let j = 0;
  while (i < kept.length || j < added.length) {
    if (j < added.length && (i >= kept.length || order(added[j], kept[i]) < 0)) merged.push(added[j++]);
    else merged.push(kept[i++]);
  }
  return merged;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * `items` with `changed` upserted and `removed` gone. An upsert equal to the listed item keeps the listed object (a
 * repeat of the overlap window changes nothing, so lists do not rebuild); a changed one leaves its place and goes where
 * `order` puts it. Answers `items` itself when nothing changed.
 */
function upsert<T extends { id: string }>(items: T[], changed: T[], removed: string[], order: (a: T, b: T) => number): T[] {
  if (!changed.length && !removed.length) return items;
  const listed = new Map(items.map((item) => [item.id, item]));
  const gone = new Set(removed.filter((id) => listed.has(id)));
  const incoming = new Map<string, T>();
  for (const item of changed) {
    const current = listed.get(item.id);
    if (current && !gone.has(item.id) && same(current, item)) continue;
    incoming.set(item.id, item);
    gone.add(item.id);
  }
  if (!gone.size) return items;
  return merge(
    items.filter((item) => !gone.has(item.id)),
    [...incoming.values()].sort(order),
    order,
  );
}

/**
 * The combinations with the manufacturer and name of `glazes` copied into the glaze steps that use them: a glaze
 * correction re-sends only the glaze (guide topic "Contract"). Unchanged combinations keep their
 * objects; the list itself is returned when nothing differs.
 */
export function withGlazeNames(combinations: Combination[], glazes: Pick<Glaze, 'id' | 'name' | 'manufacturer'>[]): Combination[] {
  if (!glazes.length) return combinations;
  const names = new Map(glazes.map((glaze) => [glaze.id, { manufacturer: glaze.manufacturer.name, name: glaze.name }]));
  const stale = (step: Combination['steps'][number]) => {
    const named = isGlazeStep(step) ? names.get(step.glazeId!) : undefined;
    return !!named && (step.manufacturer !== named.manufacturer || step.name !== named.name);
  };
  let renamed = false;
  const result = combinations.map((combination) => {
    if (!combination.steps.some(stale)) return combination;
    renamed = true;
    return { ...combination, steps: combination.steps.map((step) => (stale(step) ? { ...step, ...names.get(step.glazeId!) } : step)) };
  });
  return renamed ? result : combinations;
}

/**
 * Applies a sync answer to the listings stored at `point`. Upserts replace items by ID and tombstones remove them,
 * both idempotently (the server repeats the last two minutes in every answer); glaze corrections reach the steps that
 * use the glaze. Anything that cannot be applied asks for a full load: a `resync` answer, a format or epoch other than
 * the point's (the server answers `resync` for those itself), and listings whose sizes after applying differ from the
 * server's integrity counts.
 */
export function applyDelta(local: Listings & { point: SyncPoint }, delta: SyncView): DeltaOutcome {
  const start = pointOf(delta);
  if (delta.resync) return { kind: 'resync', reason: delta.resync, start };
  if (delta.format !== local.point.format) return { kind: 'resync', reason: 'FORMAT', start };
  if (delta.epoch !== local.point.epoch) return { kind: 'resync', reason: 'EPOCH', start };
  const glazes = upsert(local.glazes, delta.glazes, delta.removedGlazeIds, glazeOrder);
  const combinations = withGlazeNames(upsert(local.combinations, delta.combinations, delta.removedCombinationIds, combinationOrder), delta.glazes);
  if (glazes.length !== delta.visibleGlazes || combinations.length !== delta.visibleCombinations) return { kind: 'resync', reason: 'COUNTS', start };
  return {
    kind: 'applied',
    listings: { glazes, combinations },
    point: start,
    changed: glazes !== local.glazes || combinations !== local.combinations,
  };
}

/** Returning to the app refreshes by delta once the last finished load is at least this old. */
export const RESUME_SYNC_MS = 30_000;
