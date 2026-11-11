import { describe, expect, it } from 'vitest';
import { glaze } from '../../test/fixtures';
import { customStepDraft, glazeStepDraft } from './step-draft';
import { collapsedForNewStep, isCollapsed, isFinished, stepSummary, toggledCollapse, type SummaryLabels } from './step-summary';

const labels: SummaryLabels = {
  coats: (count) => `${count} ${count === 1 ? 'coat' : 'coats'}`,
  noGlaze: 'No glaze chosen yet',
  noLabel: 'Unnamed step',
};
const rutile = glaze({ name: 'Blue Rutile' });
const glazes = new Map([['g1', rutile]]);

function glazeStep(coats: number, method = '', glazeId = 'g1') {
  return { ...glazeStepDraft(coats), glazeId, method };
}
function customStep(label: string) {
  return { ...customStepDraft(), label };
}

describe('stepSummary', () => {
  it.each([
    ['names the glaze, coats and method of a glaze step', glazeStep(2, 'Dip'), 1, '1 · Amaco PC-20 Blue Rutile · 2 coats · Dip'],
    ['leaves the method out when it is empty', glazeStep(1), 2, '2 · Amaco PC-20 Blue Rutile · 1 coat'],
    ['leaves the method out when it is blank', glazeStep(3, '  '), 2, '2 · Amaco PC-20 Blue Rutile · 3 coats'],
    ['shows a custom step as its trimmed label only', customStep(' Bisque firing '), 3, '3 · Bisque firing'],
    ['says so when no glaze is chosen', glazeStep(1, '', ''), 1, '1 · No glaze chosen yet · 1 coat'],
    ['says so when the glaze is not loaded', glazeStep(1, '', 'gone'), 1, '1 · No glaze chosen yet · 1 coat'],
    ['says so when a custom step has no label', customStep('  '), 2, '2 · Unnamed step'],
  ])('%s', (_case, step, position, summary) => {
    expect(stepSummary(step, position, glazes, labels)).toBe(summary);
  });
});

describe('isFinished', () => {
  it('needs a glaze for a glaze step and a label for a custom step', () => {
    expect(isFinished(glazeStep(1))).toBe(true);
    expect(isFinished(glazeStep(1, '', ''))).toBe(false);
    expect(isFinished(customStep('Bisque'))).toBe(true);
    expect(isFinished(customStep('   '))).toBe(false);
  });
});

describe('collapse state', () => {
  it('collapses a finished step and opens it again', () => {
    const step = glazeStep(2);
    const collapsed = toggledCollapse(step, new Set());
    expect(isCollapsed(step, collapsed)).toBe(true);
    expect(isCollapsed(step, toggledCollapse(step, collapsed))).toBe(false);
  });

  it('never collapses an unfinished step', () => {
    const open = glazeStep(1, '', '');
    expect(toggledCollapse(open, new Set()).size).toBe(0);
    // Even a stale entry (the glaze was cleared) shows the step open.
    expect(isCollapsed(open, new Set([open.key]))).toBe(false);
  });

  it('does not change the set it is given', () => {
    const step = glazeStep(1);
    const before = new Set<number>();
    toggledCollapse(step, before);
    expect(before.size).toBe(0);
  });

  it('folds every finished step when a step is added, and keeps the opened ones apart', () => {
    const first = glazeStep(2);
    const second = customStep('Bisque firing');
    const unfinished = glazeStep(1, '', '');
    const collapsed = collapsedForNewStep([first, second, unfinished], new Set());
    expect([...collapsed].sort()).toEqual([first.key, second.key].sort());
    // Tapping one open and adding again folds it again.
    const reopened = toggledCollapse(first, collapsed);
    expect(isCollapsed(first, reopened)).toBe(false);
    expect(isCollapsed(first, collapsedForNewStep([first, second], reopened))).toBe(true);
  });
});
