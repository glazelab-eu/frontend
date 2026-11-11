import type { VectorIndex } from './embeddings';
import type { LibraryPhoto, LookKind } from './library';
import { itemKey } from './library';

/** One item that has a photo that looks like the query, with the best of its photos. */
export interface SimilarHit {
  photo: LibraryPhoto;
  /** Cosine similarity of the query and that photo, -1 to 1. */
  score: number;
}

export interface Query {
  vector: ArrayLike<number>;
  kind: LookKind;
}

export interface RankOptions {
  /** The item the query belongs to: it never answers itself. */
  exclude?: string;
  /** The most items answered. */
  limit: number;
}

/** The candidates examined per query before the items are merged (an item with more photos than this cannot crowd the answer out). */
const CANDIDATES = 40;

/**
 * The items whose photos look most like the queries: for each query the nearest photos of THE SAME KIND (a finished piece is
 * compared with finished pieces, a test tile with test tiles, work in progress with work in progress; the kind is read from the listings, so an edited kind counts),
 * each item once with its best photo, the best score over the queries, best first. Only photos the library still lists answer.
 */
export function rankSimilar(
  index: VectorIndex,
  queries: readonly Query[],
  photos: ReadonlyMap<string, LibraryPhoto>,
  { exclude, limit }: RankOptions,
): SimilarHit[] {
  const best = new Map<string, SimilarHit>();
  for (const query of queries) {
    const accept = (id: string) => {
      const photo = photos.get(id);
      return !!photo && photo.kind === query.kind && itemKey(photo.type, photo.itemId) !== exclude;
    };
    for (const { id, score } of index.nearest(query.vector, CANDIDATES, accept)) {
      const photo = photos.get(id)!;
      const key = itemKey(photo.type, photo.itemId);
      if (score > (best.get(key)?.score ?? -Infinity)) best.set(key, { photo, score });
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
