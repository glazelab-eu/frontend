import type { Combination, Step } from '../api/models';

/**
 * A combination is an ordered list of steps: glaze applications, and custom steps such as firings.
 * Everything about glazes (usage counts, stock matching, the glaze filter, removal checks) looks at
 * glaze steps only.
 */
export type GlazeStep = Step & { glazeId: string };

/**
 * A glaze application. Snapshots and fixtures from before custom steps carry no type, so a step with
 * a glaze counts as one unless it says it is custom.
 */
export function isGlazeStep(step: { type?: Step['type']; glazeId?: string | null }): boolean {
  return step.type !== 'CUSTOM' && !!step.glazeId;
}

/** The glaze applications of a combination, in order. */
export function glazeStepsOf(combination: Pick<Combination, 'steps'>): GlazeStep[] {
  return combination.steps.filter((step): step is GlazeStep => isGlazeStep(step));
}

const glazeIds = new WeakMap<object, ReadonlySet<string>>();

/** The glazes a combination applies, once each. Made once per combination: a listing change replaces its items, it never edits them. */
export function glazeIdsOf(combination: Pick<Combination, 'steps'>): ReadonlySet<string> {
  let ids = glazeIds.get(combination);
  if (!ids) glazeIds.set(combination, (ids = new Set(glazeStepsOf(combination).map((step) => step.glazeId))));
  return ids;
}

/** Whether a glaze step applies the glaze; custom steps never do. */
export function usesGlaze(combination: Pick<Combination, 'steps'>, glazeId: string): boolean {
  return glazeStepsOf(combination).some((step) => step.glazeId === glazeId);
}
