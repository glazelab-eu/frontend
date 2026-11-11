import type { CombinationInput } from '../api/inputs';
import type { Glaze } from '../api/models';

/** A glaze application, or a custom step such as a firing (its details are the notes). */
export interface StepDraft {
  /** Identifies the step while its place in the list changes. */
  key: number;
  type: 'GLAZE' | 'CUSTOM';
  glazeId: string;
  coats: number;
  method: string;
  notes: string;
  label: string;
}

export const MIN_COATS = 1;
export const MAX_COATS = 20;
/** Coats the first glaze step of a combination starts with; later glaze steps start with one. */
const FIRST_COATS = 2;

/** Translation keys of the method quick picks. The saved method is the free text shown, in the writer's language. */
export const METHOD_CHIPS = [
  'studio.step.method.dip',
  'studio.step.method.brush',
  'studio.step.method.pour',
  'studio.step.method.spray',
  'studio.step.method.sponge',
  'studio.step.method.trail',
] as const;

let nextKey = 0;

export function glazeStepDraft(coats = MIN_COATS): StepDraft {
  return { key: nextKey++, type: 'GLAZE', glazeId: '', coats, method: '', notes: '', label: '' };
}

export function customStepDraft(): StepDraft {
  return {
    key: nextKey++,
    type: 'CUSTOM',
    glazeId: '',
    coats: MIN_COATS,
    method: '',
    notes: '',
    label: '',
  };
}

/** The Studio form starts without steps: the writer chooses the first one (a glaze or a custom step). */
export function initialSteps(): StepDraft[] {
  return [];
}

/** A glaze step for the end of the list: the first glaze step of the combination starts with two coats, later ones with one. */
export function addedGlazeStep(steps: readonly StepDraft[]): StepDraft {
  return glazeStepDraft(steps.some((step) => step.type === 'GLAZE') ? MIN_COATS : FIRST_COATS);
}

/** The coat count after pressing - or +, kept within the limits (a stale or fractional value is repaired). */
export function stepCoats(coats: number, delta: number): number {
  const current = Number.isFinite(coats) ? Math.round(coats) : MIN_COATS;
  return Math.min(MAX_COATS, Math.max(MIN_COATS, current + delta));
}

/** The steps with one moved by `delta` places; out-of-range moves return the same list. */
export function movedStep<T>(steps: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (index < 0 || index >= steps.length || target < 0 || target >= steps.length) return steps;
  const next = [...steps];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** The steps without one, the last included (a draft may have none; publishing needs one); an unknown position returns the same list. */
export function removedStep<T>(steps: T[], index: number): T[] {
  if (index < 0 || index >= steps.length) return steps;
  return steps.filter((_, position) => position !== index);
}

/** Whether the method text is the quick pick with this label (case does not matter). */
export function isMethodChoice(method: string, label: string): boolean {
  return method.trim().toLowerCase() === label.trim().toLowerCase();
}

/** The method after pressing a quick pick: the label, or empty when it was already chosen. */
export function methodAfterChoice(method: string, label: string): string {
  return isMethodChoice(method, label) ? '' : label;
}

/** Any step added: the untouched form has none, and a blank step still makes the form started (sticky bar); leaving asks only for `draftWorthSaving`. */
export function stepsStarted(steps: readonly StepDraft[]): boolean {
  return steps.length > 0;
}

/** Nothing typed or chosen that a saved step would keep (coats mean nothing without a glaze). */
function stepEmpty(step: StepDraft): boolean {
  return !step.glazeId && !step.label.trim() && !step.method.trim() && !step.notes.trim();
}

/**
 * The steps a draft saves: empty steps are left out, and a step with input but without its glaze
 * (or a custom step without its label) is `unfinished`, since every saved step satisfies its type.
 */
export function draftSteps(steps: StepDraft[]): { steps: StepDraft[]; unfinished?: StepDraft } {
  const kept = steps.filter((step) => !stepEmpty(step));
  const unfinished = kept.find((step) => (step.type === 'CUSTOM' ? !step.label.trim() : !step.glazeId));
  return { steps: kept, unfinished };
}

/** The request steps: a custom step carries a label and details only, a glaze step no label. */
export function stepInputs(steps: StepDraft[]): CombinationInput['steps'] {
  return steps.map((step) =>
    step.type === 'CUSTOM'
      ? { type: 'CUSTOM', label: step.label.trim(), notes: step.notes }
      : {
          type: 'GLAZE',
          glazeId: step.glazeId,
          coats: step.coats,
          method: step.method.trim() || null,
          notes: step.notes,
        },
  );
}

/**
 * The steps after the add-glaze dialog (or its duplicate hint) chose a glaze for step `index`:
 * only a glaze step takes it, and only a glaze the loaded library holds, so a stale or foreign id
 * leaves the draft untouched.
 */
export function withStepGlaze<T extends { type: 'GLAZE' | 'CUSTOM'; glazeId: string }>(
  steps: T[],
  index: number,
  glazeId: string,
  glazes: Pick<Glaze, 'id'>[],
): T[] {
  if (steps[index]?.type !== 'GLAZE' || !glazes.some((glaze) => glaze.id === glazeId)) return steps;
  return steps.map((step, position) => (position === index ? { ...step, glazeId } : step));
}
