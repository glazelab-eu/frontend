import { describe, expect, it } from 'vitest';
import { customStepDraft, glazeStepDraft } from './step-draft';
import { draftWorthSaving, saveDraftReason } from './save-draft';

const blank = { hasText: false, steps: [], firingStarted: false };

describe('draftWorthSaving', () => {
  it('is false for an untouched form and for blank steps alone', () => {
    expect(draftWorthSaving(blank)).toBe(false);
    expect(draftWorthSaving({ ...blank, steps: [glazeStepDraft(2), customStepDraft()] })).toBe(false);
    expect(draftWorthSaving({ ...blank, steps: [{ ...glazeStepDraft(5) }] })).toBe(false);
  });

  it('is true for text, the final firing or any step with input, finished or not', () => {
    expect(draftWorthSaving({ ...blank, hasText: true })).toBe(true);
    expect(draftWorthSaving({ ...blank, firingStarted: true })).toBe(true);
    expect(draftWorthSaving({ ...blank, steps: [{ ...glazeStepDraft(), glazeId: 'g1' }] })).toBe(true);
    expect(draftWorthSaving({ ...blank, steps: [{ ...customStepDraft(), label: 'Bisque' }] })).toBe(true);
    expect(draftWorthSaving({ ...blank, steps: [{ ...glazeStepDraft(), notes: 'thick' }] })).toBe(true);
  });
});

describe('saveDraftReason', () => {
  it('names the missing content of a new combination only', () => {
    expect(saveDraftReason({ editing: false, worthSaving: false })).toBe('nothing');
    expect(saveDraftReason({ editing: false, worthSaving: true })).toBeUndefined();
    expect(saveDraftReason({ editing: true, worthSaving: false })).toBeUndefined();
  });
});
