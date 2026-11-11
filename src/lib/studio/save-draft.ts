import { draftSteps, type StepDraft } from './step-draft';

/** What a draft would keep: text, a step with input (finished or not; blank steps are left out) or a started final firing. */
export function draftWorthSaving(draft: { hasText: boolean; steps: StepDraft[]; firingStarted: boolean }): boolean {
  return draft.hasText || draft.firingStarted || draftSteps(draft.steps).steps.length > 0;
}

/** Why Save draft does nothing: a new combination with nothing a draft would keep (an edit saves as it is). */
export function saveDraftReason(state: { editing: boolean; worthSaving: boolean }): 'nothing' | undefined {
  return !state.editing && !state.worthSaving ? 'nothing' : undefined;
}
