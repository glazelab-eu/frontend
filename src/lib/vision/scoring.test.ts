import { describe, expect, it } from 'vitest';
import { cosine, normalize, pickSuggestions, scoreLabels, softmax, type Scored } from './scoring';

describe('normalize and cosine', () => {
  it('scales to length 1 and keeps a zero vector zero', () => {
    expect([...normalize([3, 4])]).toEqual([Math.fround(0.6), Math.fround(0.8)]);
    expect([...normalize([0, 0, 0])]).toEqual([0, 0, 0]);
  });

  it('is the angle, not the length', () => {
    expect(cosine([1, 0], [5, 0])).toBeCloseTo(1, 6);
    expect(cosine([1, 0], [0, 7])).toBeCloseTo(0, 6);
    expect(cosine([1, 1], [-2, -2])).toBeCloseTo(-1, 6);
    expect(cosine([1, 2, 3], [0, 0, 0])).toBe(0);
  });

  it('refuses vectors of different lengths', () => {
    expect(() => cosine([1, 2], [1, 2, 3])).toThrow(RangeError);
  });
});

describe('softmax', () => {
  it('sums to 1 and orders like the logits', () => {
    const p = softmax([1, 2, 3]);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(p[2]).toBeGreaterThan(p[1]);
    expect(p[1]).toBeGreaterThan(p[0]);
    expect(p[0]).toBeCloseTo(0.0900306, 6);
    expect(p[2]).toBeCloseTo(0.665241, 6);
  });

  it('does not overflow on large logits and handles no logits', () => {
    expect(softmax([1000, 1000])).toEqual([0.5, 0.5]);
    expect(softmax([])).toEqual([]);
  });
});

describe('scoreLabels', () => {
  const labels = [
    { id: 'mug', embedding: [1, 0] },
    { id: 'vase', embedding: [0, 1] },
    { id: 'plate', embedding: [-1, 0] },
  ];

  it('scores every label, best first, with the logit scale applied to the cosine', () => {
    const scored = scoreLabels([1, 0.2], labels, 10);
    expect(scored.map((item) => item.id)).toEqual(['mug', 'vase', 'plate']);
    const cos = 1 / Math.hypot(1, 0.2);
    expect(scored[0].cosine).toBeCloseTo(cos, 6);
    expect(scored[2].cosine).toBeCloseTo(-cos, 6);
    expect(scored.reduce((sum, item) => sum + item.probability, 0)).toBeCloseTo(1, 10);
    const expected = Math.exp(10 * cos) / (Math.exp(10 * cos) + Math.exp(10 * (0.2 * cos)) + Math.exp(-10 * cos));
    expect(scored[0].probability).toBeCloseTo(expected, 8);
  });

  it('a larger scale makes the best label more certain', () => {
    expect(scoreLabels([1, 0.2], labels, 50)[0].probability).toBeGreaterThan(scoreLabels([1, 0.2], labels, 5)[0].probability);
  });
});

describe('pickSuggestions', () => {
  const thresholds = { minProbability: 0.3, minCosine: 0.25, maxSuggestions: 2 };
  const scored: Scored[] = [
    { id: 'mug', probability: 0.5, cosine: 0.4 },
    { id: 'cup', probability: 0.3, cosine: 0.25 },
    { id: 'jug', probability: 0.29, cosine: 0.4 },
    { id: 'bowl', probability: 0.4, cosine: 0.24 },
  ];

  it('needs both the probability and the cosine, each inclusive at its threshold', () => {
    expect(pickSuggestions(scored, { ...thresholds, maxSuggestions: 9 }).map((item) => item.id)).toEqual(['mug', 'cup']);
  });

  it('keeps the best few only', () => {
    expect(pickSuggestions(scored, { ...thresholds, minProbability: 0, minCosine: 0 }).map((item) => item.id)).toEqual(['mug', 'cup']);
    expect(pickSuggestions(scored, { ...thresholds, maxSuggestions: 1 }).map((item) => item.id)).toEqual(['mug']);
  });

  it('suggests nothing when every score is low', () => {
    expect(pickSuggestions(scored, { minProbability: 0.9, minCosine: 0, maxSuggestions: 3 })).toEqual([]);
    expect(pickSuggestions(scored, { minProbability: 0, minCosine: 0.9, maxSuggestions: 3 })).toEqual([]);
    expect(pickSuggestions([], thresholds)).toEqual([]);
  });

  it('leaves out labels that are never suggested before counting', () => {
    const only = (id: string) => id !== 'mug';
    expect(pickSuggestions(scored, { ...thresholds, maxSuggestions: 1 }, only).map((item) => item.id)).toEqual(['cup']);
  });
});
