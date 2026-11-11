import { describe, expect, it } from 'vitest';
import { dequantize, quantize, VectorIndex } from './embeddings';
import { cosine } from './scoring';

/** A reproducible pseudo-random vector (a linear congruential generator), so the tests never depend on Math.random. */
function vector(seed: number, dimension = 16): Float32Array {
  let state = seed * 2654435761 + 1;
  return Float32Array.from({ length: dimension }, () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296 - 0.5;
  });
}

describe('quantize', () => {
  it('keeps the direction of a vector to well under one percent', () => {
    for (let seed = 1; seed < 20; seed++) {
      const original = vector(seed, 512);
      expect(cosine(original, dequantize(quantize(original)))).toBeGreaterThan(0.9999);
    }
  });

  it('stores one byte per value and a scale, and the largest value is +-127', () => {
    const stored = quantize([0, 3, -4, 0]);
    expect(stored.q).toBeInstanceOf(Int8Array);
    expect([...stored.q]).toEqual([0, 95, -127, 0]);
    expect(stored.s).toBeGreaterThan(0);
  });

  it('normalizes first, so a vector and its multiples are one', () => {
    expect(quantize([1, 2, 3])).toEqual(quantize([10, 20, 30]));
  });

  it('keeps the zero vector at scale 0 and gives back zeros', () => {
    const stored = quantize([0, 0, 0]);
    expect(stored.s).toBe(0);
    expect([...dequantize(stored)]).toEqual([0, 0, 0]);
  });

  it('returns unit vectors', () => {
    const unit = dequantize(quantize(vector(3)));
    expect(Math.hypot(...unit)).toBeCloseTo(1, 5);
  });
});

describe('VectorIndex', () => {
  it('finds the nearest vectors best first', () => {
    const index = new VectorIndex(2);
    index.add('east', [1, 0]);
    index.add('north-east', [1, 1]);
    index.add('north', [0, 1]);
    index.add('west', [-1, 0]);
    expect(index.nearest([1, 0.1], 3).map((hit) => hit.id)).toEqual(['east', 'north-east', 'north']);
    expect(index.nearest([1, 0.1], 1)[0].score).toBeCloseTo(0.995, 3);
  });

  it('scores a vector against itself as 1 whatever its length', () => {
    const index = new VectorIndex(4);
    index.add('a', [3, 0, 4, 0]);
    expect(index.nearest([6, 0, 8, 0], 1)[0].score).toBeCloseTo(1, 6);
  });

  it('leaves out what `accept` refuses and still fills the list from the rest', () => {
    const index = new VectorIndex(2);
    index.add('a', [1, 0]);
    index.add('b', [0.9, 0.1]);
    index.add('c', [0, 1]);
    expect(index.nearest([1, 0], 2, (id) => id !== 'a').map((hit) => hit.id)).toEqual(['b', 'c']);
  });

  it('replaces a vector added again and keeps one row for it', () => {
    const index = new VectorIndex(2);
    index.add('a', [1, 0]);
    index.add('a', [0, 1]);
    expect(index.size).toBe(1);
    expect(index.nearest([0, 1], 1)[0].score).toBeCloseTo(1, 6);
  });

  it('removes a vector by moving the last row into its place', () => {
    const index = new VectorIndex(2);
    index.add('a', [1, 0]);
    index.add('b', [0, 1]);
    index.add('c', [-1, 0]);
    expect(index.remove('a')).toBe(true);
    expect(index.remove('a')).toBe(false);
    expect(index.size).toBe(2);
    expect(index.has('a')).toBe(false);
    expect(index.nearest([-1, 0], 1)[0].id).toBe('c');
    expect(index.nearest([0, 1], 1)[0].id).toBe('b');
    expect(index.idsOf().sort()).toEqual(['b', 'c']);
  });

  it('grows past its first allocation without losing rows', () => {
    const index = new VectorIndex(8);
    for (let i = 0; i < 100; i++) index.add(`p${i}`, vector(i, 8));
    expect(index.size).toBe(100);
    for (const i of [0, 17, 63, 99]) expect(index.nearest(vector(i, 8), 1)[0]).toMatchObject({ id: `p${i}` });
  });

  it('refuses a vector of another length and answers nothing for a query of another length', () => {
    const index = new VectorIndex(3);
    expect(() => index.add('a', [1, 0])).toThrow(RangeError);
    index.add('a', [1, 0, 0]);
    expect(index.nearest([1, 0], 1)).toEqual([]);
    expect(index.nearest([1, 0, 0], 0)).toEqual([]);
  });

  it('returns a copy of a stored vector', () => {
    const index = new VectorIndex(2);
    index.add('a', [3, 4]);
    const copy = index.get('a')!;
    expect(copy[0]).toBeCloseTo(0.6, 6);
    copy[0] = 9;
    expect(index.get('a')![0]).toBeCloseTo(0.6, 6);
    expect(index.get('missing')).toBeUndefined();
  });

  it('ranks like the exact cosine after quantization on random vectors', () => {
    const index = new VectorIndex(64);
    const exact: { id: string; vector: Float32Array }[] = [];
    for (let i = 0; i < 200; i++) {
      const original = vector(i, 64);
      exact.push({ id: `p${i}`, vector: original });
      index.add(`p${i}`, dequantize(quantize(original)));
    }
    const query = vector(500, 64);
    const truth = exact
      .map((item) => ({ id: item.id, score: cosine(query, item.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((item) => item.id);
    expect(index.nearest(query, 5).map((hit) => hit.id)).toEqual(truth);
  });
});
