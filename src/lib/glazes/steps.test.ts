import { describe, expect, it } from 'vitest';
import { customStep, glazeStep } from '../../test/fixtures';
import { glazeIdsOf, glazeStepsOf, isGlazeStep, usesGlaze } from './steps';

describe('step helpers', () => {
  const mixed = {
    steps: [customStep({ label: 'Bisque firing' }), glazeStep({ glazeId: 'g1', position: 2 }), glazeStep({ glazeId: 'g2', position: 3 })],
  };

  it('tells glaze applications from custom steps, also in older data without a type', () => {
    expect(isGlazeStep(glazeStep({ glazeId: 'g1' }))).toBe(true);
    expect(isGlazeStep(customStep({ label: 'Glaze firing' }))).toBe(false);
    expect(isGlazeStep({ glazeId: 'g1' })).toBe(true);
    expect(isGlazeStep({ glazeId: null })).toBe(false);
  });

  it('looks only at glaze steps for the glazes a combination uses', () => {
    expect(glazeStepsOf(mixed).map((step) => step.glazeId)).toEqual(['g1', 'g2']);
    expect(glazeIdsOf(mixed)).toEqual(new Set(['g1', 'g2']));
    expect(usesGlaze(mixed, 'g2')).toBe(true);
    expect(usesGlaze(mixed, 'g3')).toBe(false);
    expect(glazeIdsOf({ steps: [customStep({ label: 'Bisque firing' })] }).size).toBe(0);
  });
});

describe('glazeIdsOf', () => {
  it('makes the set once per combination: an item is replaced, never edited', () => {
    const item = { steps: [glazeStep({ glazeId: 'g1' })] };
    expect(glazeIdsOf(item)).toBe(glazeIdsOf(item));
    expect(glazeIdsOf({ ...item, steps: [glazeStep({ glazeId: 'g2' })] })).toEqual(new Set(['g2']));
  });
});
