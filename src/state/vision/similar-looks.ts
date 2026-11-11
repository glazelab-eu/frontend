import { get, writable, type Readable } from 'svelte/store';
import type { Combination, Glaze } from '../../lib/api/models';
import { pictureBlob, type PictureBlob } from '../../lib/offline/offline';
import { embeddingStore, type EmbeddingStore, type Meta } from '../../lib/vision/embedding-store';
import { dequantize, quantize, VectorIndex } from '../../lib/vision/embeddings';
import { pauseReason, pendingPhotos, staleIds, type PauseReason } from '../../lib/vision/indexing';
import { LOOK_KINDS, itemKey, libraryPhotos, type ItemType, type LibraryPhoto, type LookKind } from '../../lib/vision/library';
import { isMetered } from '../../lib/vision/preference';
import { rankSimilar, type SimilarHit } from '../../lib/vision/similar';
import type { PhotoSuggestions } from './photo-suggestions';

/**
 * The similar looks (33-2): this account's photos embedded on the device by the 33-1 model, kept in IndexedDB and searched by
 * cosine similarity. Everything is behind two consents: the model's (33-1, `PhotoSuggestions`) and this one, for indexing the whole
 * library ("Index N photos on this device?"). Nothing is read, requested or stored before the second; the choice is per account
 * and removed with the account's copy at sign-out.
 *
 * `off`: no model, no account, or storage unavailable (nothing is offered); `checking`: the stored choice is being read; `ask`:
 * never asked; `declined`: "Later" or stopped; `indexing`: working (also while the model starts); `paused`: waiting, see `paused`;
 * `ready`: every photo the library lists is indexed.
 */
export type SimilarStatus = 'off' | 'checking' | 'ask' | 'declined' | 'indexing' | 'paused' | 'ready';
export type Paused = PauseReason | 'model' | 'storage';

export interface SimilarState {
  status: SimilarStatus;
  paused: Paused | null;
  /** Photos of the library that are indexed, and photos it lists that can be (test tiles and finished pieces). */
  done: number;
  total: number;
  /** Counts every change of the stored vectors, so a result shown on a page can be computed again. */
  version: number;
}

/** What the controller needs of the app: the account, the listings, the connection and whether a load has settled (a partial listing prunes nothing). */
export interface LibraryInput {
  accountId: string | null;
  glazes: readonly Glaze[];
  combinations: readonly Combination[];
  online: boolean;
  settled: boolean;
}

export interface Environment {
  /** Where the browser says: the tab is hidden, the battery (Chromium only), a metered connection. */
  read(): { hidden: boolean; battery: { charging: boolean; level: number } | null; metered: boolean };
  /** Calls `onChange` when any of that may have changed; returns the cleanup. Only used while the indexing is switched on. */
  subscribe(onChange: () => void): () => void;
  /** Resolves when the browser has time to spare (low priority between two photos). */
  idle(): Promise<void>;
  /** Resolves after `ms`, when a photo that could not be fetched is worth trying again. */
  retry(ms: number): Promise<void>;
}

interface Options {
  photos: PhotoSuggestions;
  library: Readable<LibraryInput>;
  store?: EmbeddingStore;
  environment?: Environment;
  fetchPhoto?: (photo: LibraryPhoto, accountId: string) => Promise<PictureBlob>;
}

export interface SimilarLooks {
  state: Readable<SimilarState>;
  /** The person agreed ("Index now"): remembers it for this account and starts. */
  start(): Promise<void>;
  /** "Later" or Stop: remembers it, keeps what is indexed. */
  stop(): Promise<void>;
  /** Deletes this account's vectors and keeps the choice at "off" (the account page's remove). */
  forget(): Promise<void>;
  /** The person agreed to index over a metered connection (for this session). */
  allowMetered(): void;
  /** The library photos of an item the similar looks can use (test tiles and finished pieces). */
  photosOf(type: ItemType, id: string): LibraryPhoto[];
  /** The similar items for each kind of the item's photos (a kind without an indexed photo is left out). */
  forItem(type: ItemType, id: string): { kind: LookKind; hits: SimilarHit[] }[];
  /** Whether the photo has its embedding (a photo of the library that is not indexed yet has no results). */
  indexed(imageId: string): boolean;
  /** The items similar to one photo of the library (never its own item). */
  forPhoto(imageId: string): SimilarHit[];
  /** The items similar to a photo that is not in the library yet (a fresh upload). */
  forVector(vector: ArrayLike<number>, kind: LookKind): SimilarHit[];
  /** The embedding of a file by the model (a fresh upload); needs the model to run. */
  embed: PhotoSuggestions['embed'];
  /** Stops watching (tests). */
  destroy(): void;
}

/** The most items a result lists. */
export const RESULT_LIMIT = 6;
/** A pause between two photos on top of the idle wait, so a long run never holds the processor. */
const GAP_MS = 40;
/** How long a photo fetched without a connection waits before it is tried again (the app's own health poll is slower). */
const OFFLINE_RETRY_MS = 3000;
/** The longest wait after failed requests: each failure in a row doubles the wait from `OFFLINE_RETRY_MS` up to this. */
const MAX_RETRY_MS = 60_000;
/** Photos gone in a row after which the listing is likely stale: the run waits for the next settled load (FE-3, the tarpit counts 404s). */
const GONE_IN_A_ROW = 3;

export function browserEnvironment(): Environment {
  type Battery = EventTarget & { charging: boolean; level: number };
  let battery: Battery | null = null;
  const connection = () => (navigator as Navigator & { connection?: EventTarget & { saveData?: boolean; type?: string } }).connection;
  return {
    read: () => ({
      hidden: typeof document !== 'undefined' && document.visibilityState === 'hidden',
      battery: battery ? { charging: battery.charging, level: battery.level } : null,
      metered: isMetered(connection()),
    }),
    subscribe(onChange) {
      let active = true;
      const events = ['chargingchange', 'levelchange'];
      document.addEventListener('visibilitychange', onChange);
      connection()?.addEventListener?.('change', onChange);
      const getBattery = (navigator as Navigator & { getBattery?: () => Promise<Battery> }).getBattery;
      void getBattery
        ?.call(navigator)
        .then((manager) => {
          if (!active) return;
          battery = manager;
          for (const name of events) manager.addEventListener(name, onChange);
          onChange();
        })
        .catch(() => undefined);
      return () => {
        active = false;
        document.removeEventListener('visibilitychange', onChange);
        connection()?.removeEventListener?.('change', onChange);
        for (const name of events) battery?.removeEventListener(name, onChange);
        battery = null;
      };
    },
    idle: () =>
      new Promise((resolve) => {
        const done = () => setTimeout(resolve, GAP_MS);
        if (typeof requestIdleCallback === 'function') requestIdleCallback(done, { timeout: 2000 });
        else setTimeout(done, 50);
      }),
    retry: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

export function createSimilarLooks(options: Options): SimilarLooks {
  const { photos: model, library } = options;
  const store = options.store ?? embeddingStore;
  const env = options.environment ?? browserEnvironment();
  const fetchPhoto = options.fetchPhoto ?? ((photo, account) => pictureBlob(photo.image.cardUrl, account));
  const state = writable<SimilarState>({ status: 'off', paused: null, done: 0, total: 0, version: 0 });

  let owner: string | null = null;
  let online = true;
  let settled = false;
  let listed: { glazes: readonly Glaze[]; combinations: readonly Combination[] } | null = null;
  let photos = new Map<string, LibraryPhoto>();
  let meta: Meta | null = null;
  let metaRead = false;
  let index: VectorIndex | null = null;
  let version = 0;
  let meteredAllowed = false;
  /** A write failed (storage full): the indexing waits and says so. */
  let storageFailed = false;
  /** The stored choice could not be read (no IndexedDB, a private mode): nothing is offered. */
  let unavailable = false;
  /** The listings (the `listed` record) the stored vectors were last pruned to. */
  let pruned: object | null = null;
  /** Photos given up on in this session (gone, undecodable), so one bad photo never holds the rest and is never asked for again. */
  const skipped = new Set<string>();
  /** A photo found no connection, which the app may not know yet: the indexing waits as while offline, never gives it up. */
  let unreachable = false;
  /** Failed requests in a row (server problems, rate limits, no connection): each one doubles the wait before the next. */
  let failures = 0;
  /** Photos gone in a row (`GONE_IN_A_ROW`). */
  let goneInARow = 0;
  /** A 401 or `GONE_IN_A_ROW` gone photos: no request until the next load of the account settled (the app decides the session). */
  let halted = false;
  /** Bumped by an account change or the model going off: every asynchronous step of the older one drops its result. */
  let generation = 0;
  /** The generation of the loop that runs now, if any (an older loop that ends late never clears a newer one). */
  let running: number | null = null;
  let again = false;
  let unwatch: (() => void) | null = null;
  let modelPreference = get(model.state).preference;
  let modelStatus = get(model.state).status;

  const consentOn = () => meta?.consent === 'on';

  function recompute() {
    const total = photos.size;
    let done = 0;
    if (index) for (const id of photos.keys()) if (index.has(id)) done++;
    let status: SimilarStatus;
    let paused: Paused | null = null;
    if (modelPreference !== 'on' || !owner || unavailable) status = 'off';
    else if (!metaRead) status = 'checking';
    else if (!meta) status = 'ask';
    else if (meta.consent === 'off') status = 'declined';
    else if (done >= total - [...skipped].filter((id) => photos.has(id)).length) status = 'ready';
    else if (storageFailed) [status, paused] = ['paused', 'storage'];
    else {
      const reason = pauseReason({ online: online && !unreachable, ...env.read(), meteredAllowed });
      if (reason) [status, paused] = ['paused', reason];
      else if (modelStatus === 'confirm' || modelStatus === 'offline' || modelStatus === 'failed') [status, paused] = ['paused', 'model'];
      else status = 'indexing';
    }
    state.update((value) =>
      value.status === status && value.paused === paused && value.done === done && value.total === total && value.version === version
        ? value
        : { status, paused, done, total, version },
    );
  }

  function watch(on: boolean) {
    if (on && !unwatch) unwatch = env.subscribe(() => schedule());
    if (!on && unwatch) {
      unwatch();
      unwatch = null;
    }
  }

  function schedule() {
    if (running === generation) {
      again = true;
      recompute();
      return;
    }
    void loop(generation);
  }

  /** Makes sure the model runs for the indexing: true when it can embed now. */
  async function modelReady(mine: number): Promise<boolean> {
    const status = get(model.state).status;
    if (status === 'idle' || (status === 'offline' && online)) await model.resume();
    if (mine !== generation) return false;
    const info = model.modelInfo();
    if (!info) return false;
    // Vectors of another model (or length) are useless: start over under the new one.
    if (owner && (!index || index.dimension !== info.dimension || meta?.model !== info.id)) {
      if (index || meta?.model) await store.clearVectors(owner);
      if (mine !== generation) return false;
      index = new VectorIndex(info.dimension);
      version++;
      meta = { consent: meta?.consent ?? 'on', model: info.id, dimension: info.dimension };
      await store.writeMeta(owner, meta);
    }
    return mine === generation;
  }

  async function loop(mine: number) {
    running = mine;
    try {
      while (mine === generation && owner && consentOn() && modelPreference === 'on') {
        const pending = pendingPhotos(photos, (id) => !!index?.has(id), skipped);
        recompute();
        if (!pending.length) return;
        // Before a settled load the listings may be the snapshot's, which can still name removed photos.
        if (!settled || halted) return;
        if (pauseReason({ online, ...env.read(), meteredAllowed })) return;
        if (!(await modelReady(mine))) return;
        const account = owner;
        const photo = pending[0];
        await env.idle();
        if (mine !== generation || !consentOn()) return;
        const picture = await fetchPhoto(photo, account);
        if (mine !== generation || !consentOn()) return;
        if (!picture.ok && picture.reason === 'signed-out') {
          // Never a request burst against an ended session, and nothing is given up: the app's next load decides.
          halted = true;
          return;
        }
        if (!picture.ok && picture.reason === 'gone') {
          skipped.add(photo.id);
          goneInARow++;
          if (goneInARow >= GONE_IN_A_ROW) halted = true;
          continue;
        }
        if (!picture.ok) {
          // Waits after every failure, longer each time in a row, and never gives the photo up (E2E-similar-1, FE-3).
          const ms =
            picture.reason === 'offline'
              ? OFFLINE_RETRY_MS
              : Math.max(Math.min(OFFLINE_RETRY_MS * 2 ** failures++, MAX_RETRY_MS), picture.reason === 'unavailable' ? (picture.retryAfterMs ?? 0) : 0);
          unreachable = picture.reason !== 'unavailable';
          recompute();
          await env.retry(ms);
          unreachable = false;
          if (mine !== generation) return;
          continue;
        }
        failures = 0;
        goneInARow = 0;
        const outcome = await model.embed(picture.blob);
        if (mine !== generation || !consentOn()) return;
        if (!outcome.ok) {
          // The model went away (failed, turned off): wait for it. One photo the model cannot read is given up on.
          const status = get(model.state).status;
          if (status !== 'ready' && status !== 'slow') return;
          skipped.add(photo.id);
          continue;
        }
        // The listings may have dropped the photo (and pruned its vectors) while it was fetched and embedded.
        if (!photos.has(photo.id)) continue;
        try {
          await store.put(account, photo.id, quantize(outcome.embedding));
        } catch {
          if (mine === generation) storageFailed = true;
          return;
        }
        if (mine !== generation) return;
        if (!photos.has(photo.id)) {
          void store.prune(account, new Set(photos.keys())).catch(() => undefined);
          continue;
        }
        index?.add(photo.id, outcome.embedding);
        version++;
      }
    } finally {
      if (running === mine) running = null;
      if (mine === generation) {
        recompute();
        if (again) {
          again = false;
          schedule();
        }
      }
    }
  }

  /** Reads the account's stored choice and vectors; nothing exists before the person agreed to the indexing. */
  async function attach(account: string, mine: number) {
    try {
      const stored = await store.readMeta(account);
      if (mine !== generation) return;
      let loaded: VectorIndex | null = null;
      if (stored?.dimension) {
        loaded = new VectorIndex(stored.dimension);
        for (const [id, vector] of await store.readAll(account)) {
          const values = dequantize(vector);
          if (values.length === stored.dimension) loaded.add(id, values);
        }
        if (mine !== generation) return;
      }
      meta = stored;
      index = loaded;
      version++;
      metaRead = true;
      pruned = null;
      watch(consentOn());
      pruneStale();
    } catch {
      if (mine !== generation) return;
      unavailable = true;
    }
    recompute();
    schedule();
  }

  /** Drops the vectors of photos the (settled) listings no longer show. */
  function pruneStale() {
    if (!settled || !owner || !metaRead || !meta || !listed || pruned === listed) return;
    pruned = listed;
    const stale = staleIds(index?.idsOf() ?? [], photos);
    for (const id of stale) index?.remove(id);
    for (const id of [...skipped]) if (!photos.has(id)) skipped.delete(id);
    if (stale.length) version++;
    const account = owner;
    const mine = generation;
    void store
      .prune(account, new Set(photos.keys()))
      .catch(() => undefined)
      .then(() => mine === generation && recompute());
  }

  function reset() {
    generation++;
    unreachable = false;
    failures = 0;
    goneInARow = 0;
    halted = false;
    meta = null;
    metaRead = false;
    index = null;
    version++;
    meteredAllowed = false;
    storageFailed = false;
    unavailable = false;
    pruned = null;
    skipped.clear();
    again = false;
    watch(false);
  }

  /** A pass over the library, so only while the model is on: a store update of the listings costs nothing otherwise. */
  const photosOf = ({ glazes, combinations }: NonNullable<typeof listed>) =>
    owner && modelPreference === 'on' ? libraryPhotos(glazes, combinations) : new Map<string, LibraryPhoto>();

  let last: LibraryInput | null = null;
  const unsubscribeLibrary = library.subscribe((input) => {
    // The app's store changes for many reasons: only the account, the listings, the connection and the settled flag matter here.
    if (
      last &&
      last.accountId === input.accountId &&
      last.glazes === input.glazes &&
      last.combinations === input.combinations &&
      last.online === input.online &&
      last.settled === input.settled
    )
      return;
    const loadSettled = input.settled && !settled;
    last = input;
    online = input.online;
    settled = input.settled;
    if (loadSettled) {
      halted = false;
      goneInARow = 0;
    }
    const account = input.accountId;
    if (account !== owner) {
      reset();
      owner = account;
      listed = null;
      photos = new Map();
      if (owner && modelPreference === 'on') void attach(owner, generation);
    }
    if (!listed || listed.glazes !== input.glazes || listed.combinations !== input.combinations) {
      listed = { glazes: input.glazes, combinations: input.combinations };
      photos = photosOf(listed);
      version++;
    }
    pruneStale();
    recompute();
    schedule();
  });

  const unsubscribeModel = model.state.subscribe((value) => {
    const was = modelPreference;
    modelPreference = value.preference;
    modelStatus = value.status;
    if (was === 'on' && modelPreference !== 'on') {
      // The model was turned off: the vectors and the choice go with it, for every account on this device.
      reset();
      void store.clearAll().catch(() => undefined);
      photos = new Map();
    } else if (was !== 'on' && modelPreference === 'on' && owner) {
      if (listed) photos = photosOf(listed);
      void attach(owner, generation);
    }
    recompute();
    if (modelStatus === 'ready' || modelStatus === 'slow') schedule();
  });

  async function remember(next: Meta) {
    if (!owner) return;
    const previous = meta;
    meta = next;
    try {
      await store.writeMeta(owner, next);
    } catch {
      meta = previous;
      recompute();
    }
  }

  const requestsOf = (type: ItemType, id: string) => [...photos.values()].filter((photo) => photo.type === type && photo.itemId === id);

  return {
    state: { subscribe: state.subscribe },
    async start() {
      if (!owner || modelPreference !== 'on' || !metaRead) return;
      meteredAllowed = true;
      storageFailed = false;
      await remember({ consent: 'on', model: meta?.model ?? null, dimension: meta?.dimension ?? null });
      watch(consentOn());
      recompute();
      schedule();
    },
    async stop() {
      if (!owner || modelPreference !== 'on' || !metaRead) return;
      await remember({ consent: 'off', model: meta?.model ?? null, dimension: meta?.dimension ?? null });
      watch(false);
      recompute();
    },
    async forget() {
      if (!owner || modelPreference !== 'on') return;
      const account = owner;
      // An indexing step in flight must not write a vector after the deletion.
      generation++;
      try {
        await store.clearOwner(account);
      } catch {
        // Nothing readable is nothing kept.
      }
      if (account !== owner) return;
      index = null;
      version++;
      meta = null;
      await remember({ consent: 'off', model: null, dimension: null });
      watch(false);
      recompute();
    },
    allowMetered() {
      meteredAllowed = true;
      schedule();
    },
    photosOf: requestsOf,
    indexed: (imageId) => !!index?.has(imageId),
    forItem(type, id) {
      const current = index;
      if (!current) return [];
      const own = requestsOf(type, id);
      return LOOK_KINDS.map((kind) => {
        const queries = own.flatMap((photo) => {
          const vector = photo.kind === kind ? current.get(photo.id) : undefined;
          return vector ? [{ vector, kind }] : [];
        });
        return { kind, hits: queries.length ? rankSimilar(current, queries, photos, { exclude: itemKey(type, id), limit: RESULT_LIMIT }) : [] };
      }).filter((group) => group.hits.length);
    },
    forPhoto(imageId) {
      const photo = photos.get(imageId);
      const vector = photo && index?.get(imageId);
      if (!photo || !vector || !index) return [];
      return rankSimilar(index, [{ vector, kind: photo.kind }], photos, { exclude: itemKey(photo.type, photo.itemId), limit: RESULT_LIMIT });
    },
    forVector(vector, kind) {
      if (!index || vector.length !== index.dimension) return [];
      return rankSimilar(index, [{ vector, kind }], photos, { limit: RESULT_LIMIT });
    },
    embed: (file, signal) => model.embed(file, signal),
    destroy() {
      unsubscribeLibrary();
      unsubscribeModel();
      watch(false);
      generation++;
    },
  };
}
