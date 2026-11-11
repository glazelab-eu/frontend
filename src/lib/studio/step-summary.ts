import type { Glaze } from '../api/models';
import { glazeTitle } from '../glazes/glazes';
import type { StepDraft } from './step-draft';

/** The translated words a summary line needs, so the logic stays pure. */
export interface SummaryLabels {
  /** "2 coats". */
  coats: (count: number) => string;
  /** A glaze step without a glaze yet. */
  noGlaze: string;
  /** A custom step without a label yet. */
  noLabel: string;
}

const SEPARATOR = ' · ';

/** A step is finished once it has what it needs to be saved: a glaze, or a label. */
export function isFinished(step: StepDraft): boolean {
  return step.type === 'CUSTOM' ? !!step.label.trim() : !!step.glazeId;
}

/** What the step names: its glaze (as everywhere, "Amaco PC-20 Blue Rutile") or its label; empty while there is none. */
export function stepName(step: StepDraft, glazesById: ReadonlyMap<string, Glaze>): string {
  if (step.type === 'CUSTOM') return step.label.trim();
  const glaze = glazesById.get(step.glazeId);
  return glaze ? glazeTitle(glaze) : '';
}

/**
 * The one-line summary of a collapsed step: "1 · Amaco PC-20 Blue Rutile · 2 coats · Dip" for a
 * glaze step (the method only when set), "3 · Bisque firing" for a custom step.
 */
export function stepSummary(step: StepDraft, number: number, glazesById: ReadonlyMap<string, Glaze>, labels: SummaryLabels): string {
  const missing = step.type === 'CUSTOM' ? labels.noLabel : labels.noGlaze;
  const parts = [String(number), stepName(step, glazesById) || missing];
  if (step.type === 'GLAZE') {
    parts.push(labels.coats(step.coats));
    if (step.method.trim()) parts.push(step.method.trim());
  }
  return parts.join(SEPARATOR);
}

/** Whether a step shows as its summary line: collapsed by the writer, and finished (an unfinished step stays open). */
export function isCollapsed(step: StepDraft, collapsed: ReadonlySet<number>): boolean {
  return collapsed.has(step.key) && isFinished(step);
}

/** The collapse state after tapping a step's header: a collapsed step opens, a finished open one collapses. */
export function toggledCollapse(step: StepDraft, collapsed: ReadonlySet<number>): Set<number> {
  const next = new Set(collapsed);
  if (isCollapsed(step, collapsed)) next.delete(step.key);
  else if (isFinished(step)) next.add(step.key);
  return next;
}

/** Adding a step folds every finished one away, so the new step has the screen to itself. */
export function collapsedForNewStep(steps: readonly StepDraft[], collapsed: ReadonlySet<number>): Set<number> {
  const next = new Set(collapsed);
  for (const step of steps) if (isFinished(step)) next.add(step.key);
  return next;
}
