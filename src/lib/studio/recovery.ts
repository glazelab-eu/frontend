import type { FiringDraft } from '../firing/firing';
import { customStepDraft, glazeStepDraft, type StepDraft } from './step-draft';

/** Raw fields, including incomplete steps and the tag still being typed. No pending save is restored. */
export interface StudioContent {
  title: string;
  description: string;
  tags: string[];
  tagText: string;
  steps: StepDraft[];
  firing: FiringDraft;
  /** An edit's tags when its form opened (the PUT applies only the difference, so tags others set meanwhile stay); older records lack it. */
  baseTags?: string[];
  /** An edit's title when its form opened: an untouched title is not restored over a rename saved meanwhile; older records lack it. */
  baseTitle?: string;
  /** How many photos were attached when it was written: photos themselves are never kept, so a restore can say so. */
  photos?: number;
}

export interface StudioRecovery {
  version: 1;
  revision: string;
  content: StudioContent;
}

/** Treat damaged or future records as unavailable rather than replacing a working form. */
export function parseRecovery(value: unknown): StudioRecovery | undefined {
  if (!value || typeof value !== 'object') return;
  const record = value as StudioRecovery;
  const content = record.content;
  if (record.version !== 1 || typeof record.revision !== 'string' || !content) return;
  const strings = (values: unknown[]) => values.every((entry) => typeof entry === 'string');
  if (!strings([content.title, content.description, content.tagText]) || !Array.isArray(content.tags) || !strings(content.tags)) return;
  if (content.baseTags !== undefined && (!Array.isArray(content.baseTags) || !strings(content.baseTags))) return;
  if (content.baseTitle !== undefined && typeof content.baseTitle !== 'string') return;
  if (content.photos !== undefined && !(Number.isInteger(content.photos) && content.photos >= 0)) return;
  if (
    !Array.isArray(content.steps) ||
    !content.steps.every(
      (step) =>
        step &&
        ['GLAZE', 'CUSTOM'].includes(step.type) &&
        strings([step.glazeId, step.label, step.method, step.notes]) &&
        (step.coats === null || Number.isFinite(step.coats)),
    )
  )
    return;
  const firing = content.firing;
  if (
    !firing ||
    !strings([firing.cone, firing.atmosphere, firing.clayBody, firing.kiln, firing.firedOn]) ||
    !['', 'OXIDATION', 'REDUCTION', 'OTHER'].includes(firing.atmosphere) ||
    (firing.temperatureC !== null && !Number.isFinite(firing.temperatureC))
  )
    return;
  return record;
}

/** UI keys are allocated afresh so a restored step and the next added step can never collide. */
export function restoredContent(content: StudioContent): StudioContent {
  return {
    ...content,
    tags: [...content.tags],
    ...(content.baseTags ? { baseTags: [...content.baseTags] } : {}),
    firing: { ...content.firing },
    steps: content.steps.map((step) => ({ ...step, key: (step.type === 'CUSTOM' ? customStepDraft() : glazeStepDraft()).key })),
  };
}
