import type { Quantized } from './embeddings';

/**
 * The embeddings kept on the device (33-2): IndexedDB `glazelab-embeddings`, one object store with out-of-line keys per account:
 * `<account>/meta` (the person's choice about indexing and the model the vectors belong to) and `<account>/p/<image ID>` (one
 * quantized vector per photo; image bytes never change for an ID, so a vector never goes stale). They are derived from photos the
 * account can see, so they are treated like the offline copy: removed at sign-out, at account deletion and with the model, and
 * pruned to the photos the listings still show. The database is never created before the person agrees to the indexing: reading
 * the choice opens it only if it exists (`openExisting`).
 */
export const DATABASE = 'glazelab-embeddings';
const STORE = 'embeddings';

export interface Meta {
  /** `on`: index this account's library while the app is open; `off`: the person said "Later" or stopped it. */
  consent: 'on' | 'off';
  /** The model the stored vectors come from (a different model makes them useless) and their length. */
  model: string | null;
  dimension: number | null;
}

export interface EmbeddingStore {
  /** The account's meta, or null when it never agreed (nothing was written; the database may not exist). */
  readMeta(owner: string): Promise<Meta | null>;
  writeMeta(owner: string, meta: Meta): Promise<void>;
  /** Every stored vector of the account by image ID. */
  readAll(owner: string): Promise<Map<string, Quantized>>;
  put(owner: string, imageId: string, vector: Quantized): Promise<void>;
  /** Deletes the account's vectors that are not in `keep`; answers the IDs removed. */
  prune(owner: string, keep: ReadonlySet<string>): Promise<string[]>;
  /** Deletes the account's vectors but keeps its meta (a new model). */
  clearVectors(owner: string): Promise<void>;
  /** Deletes everything of the account (meta included). */
  clearOwner(owner: string): Promise<void>;
  /** Deletes the whole database (every account): the model was turned off. */
  clearAll(): Promise<void>;
}

const metaKey = (owner: string) => `${owner}/meta`;
const vectorsOf = (owner: string) => IDBKeyRange.bound(`${owner}/p/`, `${owner}/p/￿`);
const vectorKey = (owner: string, imageId: string) => `${owner}/p/${imageId}`;

const done = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export function createEmbeddingStore(factory: () => IDBFactory | undefined = () => globalThis.indexedDB): EmbeddingStore {
  let connection: { factory: IDBFactory; db: Promise<IDBDatabase | null> } | null = null;
  // Operations run one after the other, so a sign-out deletion always follows the writes that were already queued.
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work, work);
    tail = result.catch(() => undefined);
    return result;
  };

  /** Opens the database; with `create` false an absent one stays absent (the upgrade is aborted) and the answer is null. */
  function open(create: boolean): Promise<IDBDatabase | null> {
    const idb = factory();
    if (!idb) return Promise.resolve(null);
    if (connection && connection.factory !== idb) connection = null;
    if (connection) {
      const current = connection.db;
      return current.then((db) => (db || !create ? db : openFresh(idb, true)));
    }
    return openFresh(idb, create);
  }

  function openFresh(idb: IDBFactory, create: boolean): Promise<IDBDatabase | null> {
    const db = new Promise<IDBDatabase | null>((resolve, reject) => {
      const request = idb.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        if (!create) request.transaction?.abort();
        else request.result.createObjectStore(STORE);
      };
      request.onblocked = () => reject(new Error('Embedding storage is blocked'));
      request.onerror = () => {
        // An aborted upgrade of a database that did not exist: there is none.
        if (!create && request.error?.name === 'AbortError') {
          resolve(null);
        } else reject(request.error);
      };
      request.onsuccess = () => {
        const opened = request.result;
        opened.onversionchange = () => {
          opened.close();
          connection = null;
        };
        opened.onclose = () => {
          connection = null;
        };
        resolve(opened);
      };
    });
    connection = { factory: idb, db };
    // A failed open is not remembered: the next operation tries again.
    db.then(
      (opened) => {
        if (!opened && connection?.db === db) connection = null;
      },
      () => {
        if (connection?.db === db) connection = null;
      },
    );
    return db;
  }

  async function run<T>(create: boolean, mode: IDBTransactionMode, work: (store: IDBObjectStore) => Promise<T>, absent: T): Promise<T> {
    const db = await open(create);
    if (!db) return absent;
    const tx = db.transaction(STORE, mode);
    const finished = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Embedding storage transaction aborted'));
    });
    const result = await work(tx.objectStore(STORE));
    await finished;
    return result;
  }

  return {
    readMeta: (owner) =>
      serial(() => run<Meta | null>(false, 'readonly', async (store) => ((await done(store.get(metaKey(owner)))) as Meta | undefined) ?? null, null)),
    writeMeta: (owner, meta) =>
      serial(() =>
        run(
          true,
          'readwrite',
          async (store) => {
            await done(store.put(meta, metaKey(owner)));
          },
          undefined,
        ),
      ),
    readAll: (owner) =>
      serial(() =>
        run(
          false,
          'readonly',
          async (store) => {
            const range = vectorsOf(owner);
            const [keys, values] = await Promise.all([done(store.getAllKeys(range)), done(store.getAll(range))]);
            const prefix = `${owner}/p/`;
            return new Map(keys.map((key, position) => [String(key).slice(prefix.length), values[position] as Quantized]));
          },
          new Map<string, Quantized>(),
        ),
      ),
    put: (owner, imageId, vector) =>
      serial(() =>
        run(
          true,
          'readwrite',
          async (store) => {
            await done(store.put(vector, vectorKey(owner, imageId)));
          },
          undefined,
        ),
      ),
    prune: (owner, keep) =>
      serial(() =>
        run(
          false,
          'readwrite',
          async (store) => {
            const prefix = `${owner}/p/`;
            const removed: string[] = [];
            for (const key of await done(store.getAllKeys(vectorsOf(owner)))) {
              const id = String(key).slice(prefix.length);
              if (keep.has(id)) continue;
              await done(store.delete(key));
              removed.push(id);
            }
            return removed;
          },
          [] as string[],
        ),
      ),
    clearVectors: (owner) =>
      serial(() =>
        run(
          false,
          'readwrite',
          async (store) => {
            await done(store.delete(vectorsOf(owner)));
          },
          undefined,
        ),
      ),
    clearOwner: (owner) =>
      serial(() =>
        run(
          false,
          'readwrite',
          async (store) => {
            await done(store.delete(IDBKeyRange.bound(`${owner}/`, `${owner}/￿`)));
          },
          undefined,
        ),
      ),
    clearAll: () =>
      serial(async () => {
        const idb = factory();
        if (!idb) return;
        const current = connection;
        connection = null;
        (await current?.db.catch(() => null))?.close();
        await new Promise<void>((resolve) => {
          const request = idb.deleteDatabase(DATABASE);
          request.onsuccess = () => resolve();
          request.onerror = () => resolve();
          // Another tab holding it open closes on the version change; wait for it rather than give up.
        });
      }),
  };
}

/** The device's one store (tests inject their own). */
export const embeddingStore = createEmbeddingStore();

/** Removes what the account has here (sign-out, account change, deletion). Never throws. */
export async function clearEmbeddingsOf(owner: string | null | undefined): Promise<void> {
  if (!owner) return;
  try {
    await embeddingStore.clearOwner(owner);
  } catch {
    // Storage is optional: nothing readable means nothing to remove.
  }
}
