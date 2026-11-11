import { describe, expect, it } from 'vitest';
import { combination, customStep, glaze, glazeStep } from '../../test/fixtures';
import { firingDraft } from '../firing/firing';
import { studioDraft, studioFingerprint, studioInput, studioSourceStatus, studioView } from './studio-draft';
import { glazeStepDraft, removedStep, stepInputs, stepsStarted } from './step-draft';
import { INITIAL_SYNC, type SyncState } from '../sync/lifecycle';

const blue = glaze({ createdAt: '2026-10-29T10:00:00Z', addedBy: 'Ana' });
const source = combination({
  title: 'Blue with firing',
  description: 'Stoneware test',
  tags: ['blue', 'cone-6'],
  author: 'Ana',
  authorId: 'u1',
  createdAt: '2026-10-29T10:00:00Z',
  cone: '6',
  temperatureC: 1222,
  atmosphere: 'OXIDATION',
  clayBody: 'Speckled stoneware',
  kiln: 'Club electric',
  firedOn: '2026-10-12',
  steps: [
    customStep({ position: 0, label: 'Bisque', notes: 'Cone 04' }),
    glazeStep({ position: 1, notes: 'Outside only', glazeId: 'g1', coats: 3, method: 'Dip' }),
    customStep({ position: 2, label: 'Final firing' }),
  ],
});
describe('studioDraft', () => {
  it('copies ordered glaze and custom steps, tags, notes and variation title into independent drafts', () => {
    const draft = studioDraft({ name: 'studio', from: 'c1' }, [blue], [source], ' (variation)');
    expect(draft.title).toBe('Blue with firing (variation)');
    expect(draft.description).toBe('Stoneware test');
    expect(draft.tags).toEqual(source.tags);
    expect(draft.tags).not.toBe(source.tags);
    expect(stepInputs(draft.steps)).toEqual([
      { type: 'CUSTOM', label: 'Bisque', notes: 'Cone 04' },
      { type: 'GLAZE', glazeId: 'g1', coats: 3, method: 'Dip', notes: 'Outside only' },
      { type: 'CUSTOM', label: 'Final firing', notes: '' },
    ]);
    expect(new Set(draft.steps.map((s) => s.key)).size).toBe(3);
    expect(studioDraft({ name: 'studio', from: 'c1' }, [blue], [source], ' (variation)').steps[0].key).not.toBe(draft.steps[0].key);
    expect(draft.firing).toEqual({
      cone: '6',
      temperatureC: 1222,
      atmosphere: 'OXIDATION',
      clayBody: 'Speckled stoneware',
      kiln: 'Club electric',
      firedOn: '2026-10-12',
    });
    draft.steps[0].label = 'Changed';
    draft.tags.push('extra');
    expect(source.steps[0].label).toBe('Bisque');
    expect(source.tags).toEqual(['blue', 'cone-6']);
  });
  it('copies custom-only combinations and normalizes absent optional fields', () => {
    const draft = studioDraft({ name: 'studio', from: 'c1' }, [], [{ ...source, description: null, steps: [source.steps[0]] }], ' (Variation)');
    expect(draft.description).toBe('');
    expect(draft.steps).toHaveLength(1);
    expect(draft.steps[0].type).toBe('CUSTOM');
  });
  it('starts without a final firing when the source has none', () => {
    const plain = combination({ id: 'c2' });
    expect(studioDraft({ name: 'studio', from: 'c2' }, [], [plain], ' (v)').firing).toEqual(firingDraft());
    expect(studioDraft({ name: 'studio' }, [], [], ' (v)').firing).toEqual(firingDraft());
  });
  it('keeps the variation suffix within the title limit', () => {
    const draft = studioDraft({ name: 'studio', from: 'c1' }, [], [{ ...source, title: 'x'.repeat(160) }], ' (variation)');
    expect(draft.title).toHaveLength(160);
    expect(draft.title.endsWith(' (variation)')).toBe(true);
  });
  it('keeps complete Unicode characters when a variation title reaches the limit', () => {
    const title = 'x'.repeat(147) + '😊' + 'x'.repeat(11);
    expect(title).toHaveLength(160);
    const draft = studioDraft({ name: 'studio', from: 'c1' }, [], [{ ...source, title }], ' (variation)');
    expect(draft.title).toBe('x'.repeat(147) + ' (variation)');
  });
  it('retains an emoji that fits exactly before the full suffix', () => {
    const title = 'x'.repeat(146) + '😊' + 'x'.repeat(12);
    expect(title).toHaveLength(160);
    const original = { ...source, title };
    const draft = studioDraft({ name: 'studio', from: 'c1' }, [], [original], ' (variation)');
    expect(draft.title).toBe('x'.repeat(146) + '😊 (variation)');
    expect(draft.title).toHaveLength(160);
    expect(original.title).toBe(title);
  });
  it('starts with the selected glaze and normal first-step coat count', () => {
    const draft = studioDraft({ name: 'studio', glaze: 'g1' }, [blue], [], ' (variation)');
    expect(draft.steps).toHaveLength(1);
    expect(draft.steps[0]).toMatchObject({ type: 'GLAZE', glazeId: 'g1', coats: 2 });
    expect(stepsStarted(draft.steps)).toBe(true);
    expect(draft.title).toBe('');
    expect(draft.missing).toBe(false);
  });
  it.each([
    { name: 'studio', from: 'missing' },
    { name: 'studio', glaze: 'missing' },
  ] as const)('uses an empty draft with a notice for the missing or invisible source %j', (route) => {
    const draft = studioDraft(route, [], [], ' (variation)');
    expect(draft).toMatchObject({ title: '', description: '', tags: [], missing: true });
    expect(draft.steps).toEqual([]);
  });
  it('starts a bare Studio, and the untouched fingerprint, without steps', () => {
    const draft = studioDraft({ name: 'studio' }, [blue], [], ' (variation)');
    expect(draft.steps).toEqual([]);
    expect(stepsStarted(draft.steps)).toBe(false);
    expect(stepInputs(draft.steps)).toEqual([]);
  });
  it('copies a source without steps as an empty list', () => {
    const empty = { ...source, own: true, steps: [] };
    expect(studioDraft({ name: 'studio', from: 'c1' }, [], [empty], ' (variation)').steps).toEqual([]);
    expect(studioDraft({ name: 'studio', id: 'c1' }, [], [empty], ' (variation)').steps).toEqual([]);
  });
  it('starts a bare Studio without a missing-source notice', () => {
    expect(studioDraft({ name: 'studio' }, [], [], ' (variation)')).toMatchObject({
      title: '',
      missing: false,
    });
  });
});

describe('Studio editing', () => {
  it('copies an owned combination without changing its title or applying a suffix', () => {
    const owned = { ...source, own: true, stepsLocked: true };
    const draft = studioDraft({ name: 'studio', id: 'c1' }, [blue], [owned], ' (variation)');
    expect(draft.title).toBe(source.title);
    expect(draft.missing).toBe(false);
    expect(stepInputs(draft.steps)).toHaveLength(3);
    expect(draft.firing.clayBody).toBe('Speckled stoneware');
    expect(owned.stepsLocked).toBe(true);
  });
  it('does not prefill another author or an unknown edit target', () => {
    for (const id of ['c1', 'missing'])
      expect(studioDraft({ name: 'studio', id }, [blue], [source], ' (variation)')).toMatchObject({
        title: '',
        tags: [],
        missing: true,
      });
  });
  it('tells an edit of an empty draft from one with a step, and removing the last step changes the fingerprint', () => {
    const route = { name: 'studio', id: 'c1' } as const;
    const fingerprint = (draft: ReturnType<typeof studioDraft>) => studioFingerprint(draft.title, draft.description, draft.tags, draft.steps, draft.firing);
    const emptyDraft = studioDraft(route, [blue], [{ ...source, own: true, steps: [] }], ' (variation)');
    const clean = fingerprint(emptyDraft);
    expect(fingerprint(studioDraft(route, [blue], [{ ...source, own: true, steps: [] }], ' (variation)'))).toBe(clean);
    emptyDraft.steps.push(glazeStepDraft());
    expect(fingerprint(emptyDraft)).not.toBe(clean);
    const one = studioDraft(route, [blue], [{ ...source, own: true, steps: [source.steps[0]] }], ' (variation)');
    const before = fingerprint(one);
    one.steps = removedStep(one.steps, 0);
    expect(fingerprint(one)).not.toBe(before);
    expect(fingerprint(one)).toBe(clean);
  });
  it('treats an untouched edit as clean, ignoring fresh keys and tag ordering', () => {
    const route = { name: 'studio', id: 'c1' } as const,
      owned = { ...source, own: true };
    const first = studioDraft(route, [blue], [owned], ' (variation)'),
      second = studioDraft(route, [blue], [owned], ' (variation)');
    const fingerprint = (draft: typeof first) => studioFingerprint(draft.title, draft.description, draft.tags, draft.steps, draft.firing);
    expect(fingerprint(first)).toBe(fingerprint(second));
    second.tags.reverse();
    expect(fingerprint(first)).toBe(fingerprint(second));
    second.steps.reverse();
    expect(fingerprint(first)).not.toBe(fingerprint(second));
    second.steps.reverse();
    second.firing.kiln = ' Club electric ';
    expect(fingerprint(first)).toBe(fingerprint(second));
    second.firing.cone = '04';
    expect(fingerprint(first)).not.toBe(fingerprint(second));
    second.firing.cone = '6';
    second.description = 'Edited notes';
    expect(fingerprint(first)).not.toBe(fingerprint(second));
  });
});

describe('studioInput', () => {
  it('sends the whole final firing with the steps, trimmed and blank as null', () => {
    const steps = [{ ...glazeStepDraft(2), glazeId: 'g1' }];
    const firing = { ...firingDraft(), cone: ' 04 ', temperatureC: 1060, clayBody: '  ' };
    const input = studioInput({
      title: 'Test',
      description: '',
      tags: ['blue'],
      steps,
      firing,
      basedOnId: 'c1',
    });
    expect(input).toEqual({
      title: 'Test',
      description: '',
      tags: ['blue'],
      steps: stepInputs(steps),
      cone: '04',
      temperatureC: 1060,
      atmosphere: null,
      clayBody: null,
      kiln: null,
      firedOn: null,
      basedOnId: 'c1',
    });
    // A snapshot: later edits of the form do not reach a held request.
    firing.cone = '6';
    steps[0].coats = 5;
    expect(input.cone).toBe('04');
    expect(input.steps[0].coats).toBe(2);
    expect(input).not.toHaveProperty('baseTags');
  });

  it("sends an edit's starting tags, so the API applies only the form's own tag changes (BE-9)", () => {
    const base = ['blue', 'satin'];
    const input = studioInput({ title: 'Test', description: '', tags: ['blue', 'glossy'], steps: [], firing: firingDraft(), baseTags: base });
    expect(input).toMatchObject({ tags: ['blue', 'glossy'], baseTags: ['blue', 'satin'] });
    base.push('later');
    expect(input.baseTags).toEqual(['blue', 'satin']);
  });
});

describe('Studio source lookup recovery', () => {
  const failed: SyncState = { phase: 'idle', failure: 'server' };
  const settled: SyncState = { phase: 'idle', failure: null };
  it.each([
    { name: 'studio', id: 'c1' },
    { name: 'studio', from: 'c1' },
    { name: 'studio', glaze: 'g1' },
  ] as const)('defers an unavailable source instead of consuming an empty initial draft: %j', (route) => {
    expect(studioSourceStatus(route, [], [], INITIAL_SYNC)).toBe('loading');
    expect(studioSourceStatus(route, [], [], failed)).toBe('unavailable');
    expect(studioSourceStatus(route, [blue], [{ ...source, own: true }], settled)).toBe('ready');
    const recovered = studioDraft(route, [blue], [{ ...source, own: true }], ' (variation)');
    expect(recovered.missing).toBe(false);
    if ('glaze' in route) expect(recovered.steps[0].glazeId).toBe('g1');
    else expect(recovered.title).toBe('id' in route ? source.title : source.title + ' (variation)');
  });
  it('can read a known owned snapshot despite a failed load', () => {
    expect(studioSourceStatus({ name: 'studio', id: 'c1' }, [], [{ ...source, own: true }], failed)).toBe('ready');
    expect(studioSourceStatus({ name: 'studio', from: 'c1' }, [], [source], failed)).toBe('ready');
    expect(studioSourceStatus({ name: 'studio', glaze: 'g1' }, [blue], [], failed)).toBe('ready');
  });
  it('keeps unknown or unauthorized edits missing, while true unknown prefill sources start empty', () => {
    expect(studioSourceStatus({ name: 'studio', id: 'c1' }, [], [], settled)).toBe('missing');
    expect(studioSourceStatus({ name: 'studio', id: 'c1' }, [], [source], failed)).toBe('missing');
    expect(studioSourceStatus({ name: 'studio', from: 'c1' }, [], [], settled)).toBe('ready');
    expect(studioSourceStatus({ name: 'studio', glaze: 'g1' }, [], [], settled)).toBe('ready');
    expect(studioSourceStatus({ name: 'studio' }, [], [], failed)).toBe('ready');
  });
});

describe('studioView', () => {
  it('asks a guest to sign in, waits until the draft is initialized, then shows the form', () => {
    expect(studioView(false, false, { name: 'studio' }, 'ready')).toBe('sign-in');
    expect(studioView(true, false, { name: 'studio' }, 'ready')).toBe('status');
    expect(studioView(true, true, { name: 'studio' }, 'ready')).toBe('form');
    expect(studioView(true, true, { name: 'studio', from: 'c1' }, 'missing')).toBe('form');
  });
  it('drops the form of an edit whose combination is gone after a later reload, even with input', () => {
    expect(studioView(true, true, { name: 'studio', id: 'c1' }, 'missing')).toBe('missing');
    expect(studioView(true, false, { name: 'studio', id: 'c1' }, 'missing')).toBe('status');
    expect(studioView(true, true, { name: 'studio', id: 'c1' }, 'unavailable')).toBe('form');
  });
});
