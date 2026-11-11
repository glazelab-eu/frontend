import type { CombinationInput } from '../api/inputs';
import type { Combination, Glaze } from '../api/models';
import { firingDraft, firingInput, type FiringDraft } from '../firing/firing';
import { findItem, type Route } from '../routing/routes';
import { addedGlazeStep, customStepDraft, glazeStepDraft, initialSteps, stepInputs, type StepDraft } from './step-draft';
import type { SyncState } from '../sync/lifecycle';

/**
 * One initial copy from the current account's authorised listings; later refreshes never replace it.
 * An edit and a variation both copy the final firing (a different firing is recorded as a variation).
 */
export function studioDraft(
  route: Extract<Route, { name: 'studio' }>,
  glazes: readonly Glaze[],
  combinations: readonly Combination[],
  variationSuffix: string,
) {
  const empty = () => ({
    title: '',
    description: '',
    tags: [] as string[],
    steps: initialSteps(),
    firing: firingDraft(),
    missing: false,
  });
  if (route.id || route.from) {
    const source = combinations.find((combination) => combination.id === (route.id ?? route.from));
    if (!source || (route.id && !source.own)) return { ...empty(), missing: true };
    const titleLimit = Math.max(0, 160 - variationSuffix.length);
    let prefix = '';
    // Iterate full code points while counting UTF-16 units, as Java's title validation does.
    for (const character of source.title) {
      if (prefix.length + character.length > titleLimit) break;
      prefix += character;
    }
    return {
      title: route.id ? source.title : prefix + variationSuffix,
      description: source.description ?? '',
      tags: [...source.tags],
      steps: source.steps.map((step) =>
        step.type === 'CUSTOM'
          ? { ...customStepDraft(), label: step.label ?? '', notes: step.notes ?? '' }
          : {
              ...glazeStepDraft(step.coats ?? 1),
              glazeId: step.glazeId ?? '',
              method: step.method ?? '',
              notes: step.notes ?? '',
            },
      ),
      firing: firingDraft(source),
      missing: false,
    };
  }
  const draft = empty();
  if (route.glaze) {
    if (glazes.some((glaze) => glaze.id === route.glaze)) draft.steps.push({ ...addedGlazeStep(draft.steps), glazeId: route.glaze });
    else draft.missing = true;
  }
  return draft;
}

/** Compare editable content, ignoring UI keys and tag order; opening an unchanged edit is clean. */
export function studioFingerprint(title: string, description: string, tags: string[], steps: StepDraft[], firing: FiringDraft): string {
  return JSON.stringify({
    title,
    description,
    tags: [...tags].sort(),
    steps: stepInputs(steps),
    firing: firingInput(firing),
  });
}

/**
 * The request of a save as the form holds it at the click (a held save keeps this snapshot): the
 * final firing is always sent in full (null clears a field; the API keeps one left out). An edit sends
 * `baseTags`, the tags its form opened with: the API then applies only the tags added or removed in the
 * form, so tags another account set meanwhile stay.
 */
export function studioInput(form: {
  title: string;
  description: string;
  tags: readonly string[];
  steps: StepDraft[];
  firing: FiringDraft;
  basedOnId?: string;
  baseTags?: readonly string[];
}): CombinationInput {
  return {
    title: form.title,
    description: form.description,
    tags: [...form.tags],
    ...(form.baseTags ? { baseTags: [...form.baseTags] } : {}),
    steps: stepInputs(form.steps),
    ...firingInput(form.firing),
    basedOnId: form.basedOnId,
  };
}

/**
 * What Studio shows: the sign-in prompt, the source's loading or failure status until the draft is
 * initialized, "not found" for an edit whose combination is gone (also after a later reload), else the form.
 */
export function studioView(
  signedIn: boolean,
  initialized: boolean,
  route: Extract<Route, { name: 'studio' }>,
  sourceStatus: ReturnType<typeof studioSourceStatus>,
): 'sign-in' | 'status' | 'missing' | 'form' {
  if (!signedIn) return 'sign-in';
  if (!initialized) return 'status';
  return route.id && sourceStatus === 'missing' ? 'missing' : 'form';
}

/** A failed lookup cannot consume the one initial copy; real unknown prefill sources start empty. */
export function studioSourceStatus(
  route: Extract<Route, { name: 'studio' }>,
  glazes: readonly Glaze[],
  combinations: readonly Combination[],
  load: SyncState,
): 'ready' | 'loading' | 'unavailable' | 'missing' {
  if (route.id) {
    const result = findItem(combinations, route.id, load);
    return result.status === 'found' ? (result.item.own ? 'ready' : 'missing') : result.status;
  }
  const result = route.from ? findItem(combinations, route.from, load) : route.glaze ? findItem(glazes, route.glaze, load) : undefined;
  return result?.status === 'loading' || result?.status === 'unavailable' ? result.status : 'ready';
}
