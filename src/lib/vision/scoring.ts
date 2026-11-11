/** The scoring of the photo suggestions (33-1), as pure functions: cosine similarity to the label embeddings, softmax with the model's logit scale, a threshold and the top few. */

/** The vector scaled to length 1 (a zero vector stays zero, so it scores 0 against everything). */
export function normalize(vector: ArrayLike<number>): Float32Array {
  let sum = 0;
  for (let i = 0; i < vector.length; i++) sum += vector[i] * vector[i];
  const length = Math.sqrt(sum);
  const result = new Float32Array(vector.length);
  if (length > 0) for (let i = 0; i < vector.length; i++) result[i] = vector[i] / length;
  return result;
}

/** The cosine similarity of two vectors of one length. */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) throw new RangeError(`vectors of different length: ${a.length} and ${b.length}`);
  const x = normalize(a);
  const y = normalize(b);
  let dot = 0;
  for (let i = 0; i < x.length; i++) dot += x[i] * y[i];
  return dot;
}

/** Probabilities that sum to 1 (numerically stable). */
export function softmax(logits: readonly number[]): number[] {
  if (!logits.length) return [];
  const max = Math.max(...logits);
  const exponentials = logits.map((logit) => Math.exp(logit - max));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => value / total);
}

export interface Scored {
  id: string;
  /** Share of the softmax over all labels, 0 to 1. */
  probability: number;
  /** Cosine similarity of the photo and the label's prompts, -1 to 1. */
  cosine: number;
}

export interface Thresholds {
  /** A suggestion needs at least this share of the probability. */
  minProbability: number;
  /** ... and at least this cosine similarity (a photo of nothing known is far from every label). */
  minCosine: number;
  /** At most this many suggestions. */
  maxSuggestions: number;
}

/** Every label scored against the photo's embedding, best first. `scale` is the model's logit scale (the logit is the cosine times it). */
export function scoreLabels(embedding: ArrayLike<number>, labels: readonly { id: string; embedding: ArrayLike<number> }[], scale: number): Scored[] {
  const cosines = labels.map((label) => cosine(embedding, label.embedding));
  const probabilities = softmax(cosines.map((value) => value * scale));
  return labels
    .map((label, index) => ({ id: label.id, probability: probabilities[index], cosine: cosines[index] }))
    .sort((a, b) => b.probability - a.probability);
}

/** The scored labels worth suggesting: those that pass both thresholds, best first, at most `maxSuggestions`. `eligible` leaves out labels that are never suggested. */
export function pickSuggestions(scored: readonly Scored[], thresholds: Thresholds, eligible: (id: string) => boolean = () => true): Scored[] {
  return scored
    .filter((item) => eligible(item.id) && item.probability >= thresholds.minProbability && item.cosine >= thresholds.minCosine)
    .slice(0, thresholds.maxSuggestions);
}
