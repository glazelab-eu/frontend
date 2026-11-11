import { describe, expect, it } from 'vitest';
import {
  MAX_COATS,
  MIN_COATS,
  METHOD_CHIPS,
  addedGlazeStep,
  customStepDraft,
  draftSteps,
  glazeStepDraft,
  initialSteps,
  isMethodChoice,
  methodAfterChoice,
  movedStep,
  removedStep,
  stepCoats,
  stepInputs,
  stepsStarted,
  withStepGlaze,
} from './step-draft';
import en from '../i18n/en.json';

describe('stepCoats', () => {
  it('steps by one within the limits', () => {
    expect(stepCoats(2, 1)).toBe(3);
    expect(stepCoats(2, -1)).toBe(1);
    expect(stepCoats(MIN_COATS, -1)).toBe(MIN_COATS);
    expect(stepCoats(MAX_COATS, 1)).toBe(MAX_COATS);
  });
  it('repairs a stale or fractional count', () => {
    expect(stepCoats(Number.NaN, 1)).toBe(2);
    expect(stepCoats(2.4, 1)).toBe(3);
    expect(stepCoats(99, -1)).toBe(MAX_COATS);
    expect(stepCoats(-5, 1)).toBe(MIN_COATS);
  });
});

describe('movedStep and removedStep', () => {
  const list = ['a', 'b', 'c'];
  it('moves a step up or down without touching the original', () => {
    expect(movedStep(list, 1, -1)).toEqual(['b', 'a', 'c']);
    expect(movedStep(list, 1, 1)).toEqual(['a', 'c', 'b']);
    expect(list).toEqual(['a', 'b', 'c']);
  });
  it('ignores moves off either end and unknown positions', () => {
    expect(movedStep(list, 0, -1)).toBe(list);
    expect(movedStep(list, 2, 1)).toBe(list);
    expect(movedStep(list, 5, -1)).toBe(list);
    expect(movedStep(list, -1, 1)).toBe(list);
  });
  it('removes any step, the last one included, and ignores unknown positions', () => {
    expect(removedStep(list, 1)).toEqual(['a', 'c']);
    expect(removedStep(['a'], 0)).toEqual([]);
    expect(removedStep(list, 3)).toBe(list);
    expect(removedStep(list, -1)).toBe(list);
    expect(removedStep([], 0)).toEqual([]);
    expect(list).toEqual(['a', 'b', 'c']);
  });
});

describe('method quick picks', () => {
  it('matches ignoring case and spaces', () => {
    expect(isMethodChoice(' dip ', 'Dip')).toBe(true);
    expect(isMethodChoice('Dip and wipe', 'Dip')).toBe(false);
    expect(isMethodChoice('', 'Dip')).toBe(false);
  });
  it('fills the label, or clears it when pressed again', () => {
    expect(methodAfterChoice('', 'Dip')).toBe('Dip');
    expect(methodAfterChoice('Brush', 'Dip')).toBe('Dip');
    expect(methodAfterChoice('Dip', 'Dip')).toBe('');
  });
  it('offers Dip, Brush, Pour, Spray, Sponge and Trail', () => {
    expect(METHOD_CHIPS.map((key) => en[key])).toEqual(['Dip', 'Brush', 'Pour', 'Spray', 'Sponge', 'Trail']);
  });
});

describe('step drafts', () => {
  it('starts without steps, a fresh list each time', () => {
    expect(initialSteps()).toEqual([]);
    expect(initialSteps()).not.toBe(initialSteps());
  });
  it('gives each draft its own key', () => {
    const keys = [glazeStepDraft(), customStepDraft(), addedGlazeStep([])].map((step) => step.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('starts the first glaze step with two coats and later ones, or one after a custom step, with the first', () => {
    const glaze = { ...glazeStepDraft(), glazeId: 'g1' };
    const custom = customStepDraft();
    expect(addedGlazeStep([])).toMatchObject({ type: 'GLAZE', coats: 2, method: '', glazeId: '' });
    expect(addedGlazeStep([custom])).toMatchObject({ type: 'GLAZE', coats: 2 });
    expect(addedGlazeStep([glaze])).toMatchObject({ type: 'GLAZE', coats: 1 });
    expect(addedGlazeStep([custom, glaze])).toMatchObject({ coats: 1 });
  });
  it('is untouched only while there is no step', () => {
    expect(stepsStarted(initialSteps())).toBe(false);
    expect(stepsStarted([glazeStepDraft()])).toBe(true);
    expect(stepsStarted([customStepDraft()])).toBe(true);
    expect(stepsStarted([addedGlazeStep([]), glazeStepDraft()])).toBe(true);
    // Adding a step and removing it again returns to the untouched form.
    expect(stepsStarted(removedStep([glazeStepDraft()], 0))).toBe(false);
  });
  it('builds request steps by type; an empty method is sent as none', () => {
    expect(
      stepInputs([
        { ...glazeStepDraft(3), glazeId: 'g1', method: ' Dip ', notes: 'rim' },
        { ...glazeStepDraft(), glazeId: 'g2' },
        { ...customStepDraft(), label: ' Bisque firing ', notes: 'cone 04' },
      ]),
    ).toEqual([
      { type: 'GLAZE', glazeId: 'g1', coats: 3, method: 'Dip', notes: 'rim' },
      { type: 'GLAZE', glazeId: 'g2', coats: 1, method: null, notes: '' },
      { type: 'CUSTOM', label: 'Bisque firing', notes: 'cone 04' },
    ]);
  });
});

describe('draftSteps', () => {
  it('leaves out empty steps and keeps the order of the rest', () => {
    const empty = glazeStepDraft(3);
    const glaze = { ...glazeStepDraft(), glazeId: 'g1' };
    const custom = { ...customStepDraft(), label: 'Bisque' };
    const blankCustom = customStepDraft();
    expect(draftSteps([empty, custom, blankCustom, glaze])).toEqual({
      steps: [custom, glaze],
      unfinished: undefined,
    });
    expect(draftSteps(initialSteps())).toEqual({ steps: [], unfinished: undefined });
    expect(draftSteps([glazeStepDraft(2)])).toEqual({ steps: [], unfinished: undefined });
  });
  it('names the first step with input that lacks its glaze or label', () => {
    const noted = { ...glazeStepDraft(), notes: 'Thin' };
    const details = { ...customStepDraft(), notes: 'Cone 04' };
    const glaze = { ...glazeStepDraft(), glazeId: 'g1' };
    expect(draftSteps([glaze, noted, details]).unfinished).toBe(noted);
    expect(draftSteps([glaze, details]).unfinished).toBe(details);
    expect(draftSteps([{ ...glazeStepDraft(), method: 'Dip' }]).unfinished?.method).toBe('Dip');
  });
});

describe('selecting the added glaze in a Studio step', () => {
  type Step = { type: 'GLAZE' | 'CUSTOM'; glazeId: string; label?: string };
  const library = [{ id: 'g1' }, { id: 'g2' }];
  const draft: Step[] = [
    { type: 'GLAZE', glazeId: 'g1' },
    { type: 'CUSTOM', glazeId: '', label: 'Bisque' },
    { type: 'GLAZE', glazeId: '' },
  ];

  it('sets the glaze of the asking glaze step and nothing else', () => {
    const next = withStepGlaze(draft, 2, 'g2', library);
    expect(next.map((step) => step.glazeId)).toEqual(['g1', '', 'g2']);
    expect(next[1]).toBe(draft[1]);
    expect(draft[2].glazeId).toBe('');
  });

  it('ignores custom steps, missing steps and glazes the library does not hold', () => {
    expect(withStepGlaze(draft, 1, 'g2', library)).toBe(draft);
    expect(withStepGlaze(draft, 7, 'g2', library)).toBe(draft);
    expect(withStepGlaze(draft, 2, 'gone', library)).toBe(draft);
  });
});
