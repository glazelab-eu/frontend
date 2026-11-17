import type { Combination } from '../api/models';
import { glazeStepsOf } from '../glazes/steps';
import type { StepDraft } from './step-draft';

/** How many combinations with the same glazes Studio names; the note counts the rest. */
export const SAME_GLAZES_LIMIT = 3;

type Listed = Pick<Combination, 'id' | 'own' | 'steps'>;

export interface SameGlazes<T extends Listed> {
  /** The first `limit` matches: the account's own first, each group in the listing's order. */
  items: T[];
  /** All matches, named or not. */
  total: number;
}

/** The glazes of a step list in order, as one string; coats, methods and custom steps do not count. */
const sequence = (glazeIds: readonly string[]) => glazeIds.join(' ');

const keys = new WeakMap<object, string>();

/** A combination's glaze order, made once per combination: a listing change replaces its items, it never edits them. */
function keyOf(combination: Pick<Combination, 'steps'>): string {
  let key = keys.get(combination);
  if (key === undefined) keys.set(combination, (key = sequence(glazeStepsOf(combination).map((step) => step.glazeId))));
  return key;
}

/**
 * The form's glaze order, or null while there is nothing to compare: no glaze step yet, or a glaze step whose glaze is
 * not chosen (the writer is still building it, so a shorter order would match too early).
 */
export function draftGlazeKey(steps: readonly Pick<StepDraft, 'type' | 'glazeId'>[]): string | null {
  const glazeSteps = steps.filter((step) => step.type === 'GLAZE');
  if (!glazeSteps.length || glazeSteps.some((step) => !step.glazeId)) return null;
  return sequence(glazeSteps.map((step) => step.glazeId));
}

/**
 * The combinations the account can see that apply the same glazes in the same order as the form (`draftGlazeKey`),
 * leaving out `exclude` (the form's own combination and the one it is a variation of). Only the loaded listing is
 * searched, so nothing the account cannot see is ever named.
 */
export function sameGlazes<T extends Listed>(
  key: string | null,
  combinations: readonly T[],
  exclude: readonly (string | null | undefined)[],
  limit = SAME_GLAZES_LIMIT,
): SameGlazes<T> {
  if (key === null) return { items: [], total: 0 };
  const skipped = new Set(exclude.filter((id): id is string => !!id));
  const matches = combinations.filter((combination) => !skipped.has(combination.id) && keyOf(combination) === key);
  const ordered = [...matches.filter((combination) => combination.own), ...matches.filter((combination) => !combination.own)];
  return { items: ordered.slice(0, limit), total: matches.length };
}
