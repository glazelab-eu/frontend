import { normalize } from './scoring';

/**
 * The image embeddings of the similar looks (33-2): a photo becomes a vector of unit length, kept as 8-bit integers with one
 * scale per vector (`value = q * s`: about 0.4 % error at worst, far below what separates two looks) so 5,000 photos of 512
 * numbers take 2.6 MB on the device instead of 10 MB. The search is brute force over one contiguous float array: at this scale
 * (a hobby library holds hundreds to a few thousand photos) nothing smarter is needed; `docs/vision-check.md` has the timing.
 */
export interface Quantized {
  q: Int8Array;
  /** Multiplier that turns `q` back into the vector's values. */
  s: number;
}

/** The vector (any length, normalized first) as 8-bit integers and their scale; the zero vector keeps scale 0. */
export function quantize(vector: ArrayLike<number>): Quantized {
  const unit = normalize(vector);
  let largest = 0;
  for (let i = 0; i < unit.length; i++) largest = Math.max(largest, Math.abs(unit[i]));
  const q = new Int8Array(unit.length);
  if (largest > 0) for (let i = 0; i < unit.length; i++) q[i] = Math.round((unit[i] / largest) * 127);
  return { q, s: largest / 127 };
}

/** The unit vector a stored one stands for (normalized again, so the rounding never changes a length). */
export function dequantize({ q, s }: Quantized): Float32Array {
  const vector = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) vector[i] = q[i] * s;
  return normalize(vector);
}

export interface Neighbour {
  id: string;
  /** Cosine similarity, -1 to 1. */
  score: number;
}

/** A set of unit vectors by ID with nearest-neighbour search by cosine similarity (a dot product of unit vectors). */
export class VectorIndex {
  readonly dimension: number;
  private rows = new Float32Array(0);
  private ids: string[] = [];
  private position = new Map<string, number>();

  constructor(dimension: number) {
    if (!(dimension > 0)) throw new RangeError('dimension must be positive');
    this.dimension = dimension;
  }

  get size(): number {
    return this.ids.length;
  }

  has(id: string): boolean {
    return this.position.has(id);
  }

  idsOf(): string[] {
    return [...this.ids];
  }

  /** The unit vector stored for `id` (a copy), if any. */
  get(id: string): Float32Array | undefined {
    const row = this.position.get(id);
    return row === undefined ? undefined : this.rows.slice(row * this.dimension, (row + 1) * this.dimension);
  }

  /** Adds or replaces a vector (normalized here); a vector of another length is refused. */
  add(id: string, vector: ArrayLike<number>): void {
    if (vector.length !== this.dimension) throw new RangeError(`expected ${this.dimension} values, got ${vector.length}`);
    let row = this.position.get(id);
    if (row === undefined) {
      row = this.ids.length;
      if ((row + 1) * this.dimension > this.rows.length) {
        const grown = new Float32Array(Math.max(16, row * 2) * this.dimension);
        grown.set(this.rows);
        this.rows = grown;
      }
      this.ids.push(id);
      this.position.set(id, row);
    }
    this.rows.set(normalize(vector), row * this.dimension);
  }

  /** Removes a vector by moving the last row into its place; false when there was none. */
  remove(id: string): boolean {
    const row = this.position.get(id);
    if (row === undefined) return false;
    const last = this.ids.length - 1;
    if (row !== last) {
      this.rows.copyWithin(row * this.dimension, last * this.dimension, (last + 1) * this.dimension);
      this.ids[row] = this.ids[last];
      this.position.set(this.ids[row], row);
    }
    this.ids.pop();
    this.position.delete(id);
    return true;
  }

  /** The `limit` stored vectors most similar to `query`, best first; `accept` leaves out IDs (checked only for a candidate that would make the list). */
  nearest(query: ArrayLike<number>, limit: number, accept: (id: string) => boolean = () => true): Neighbour[] {
    if (query.length !== this.dimension || limit < 1) return [];
    const unit = normalize(query);
    const { rows, dimension } = this;
    const best: Neighbour[] = [];
    for (let row = 0; row < this.ids.length; row++) {
      let dot = 0;
      const base = row * dimension;
      for (let i = 0; i < dimension; i++) dot += unit[i] * rows[base + i];
      if (best.length === limit && dot <= best[limit - 1].score) continue;
      if (!accept(this.ids[row])) continue;
      let place = best.length;
      while (place > 0 && best[place - 1].score < dot) place--;
      best.splice(place, 0, { id: this.ids[row], score: dot });
      if (best.length > limit) best.pop();
    }
    return best;
  }
}
