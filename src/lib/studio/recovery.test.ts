import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { deleteSnapshot, deleteStudioRecovery, readStudioRecovery, saveStudioRecovery } from '../offline/snapshots';
import { firingDraft } from '../firing/firing';
import { customStepDraft, glazeStepDraft } from './step-draft';
import { parseRecovery, restoredContent, type StudioRecovery } from './recovery';

const saved = (): StudioRecovery => ({
  version: 1,
  revision: crypto.randomUUID(),
  content: {
    title: 'Unfinished',
    description: '',
    tags: ['blue'],
    tagText: 'pending',
    steps: [
      { ...glazeStepDraft(), method: 'Brush' },
      { ...customStepDraft(), notes: 'Still needs a label' },
    ],
    firing: { ...firingDraft(), clayBody: 'Stoneware' },
  },
});

describe('Studio recovery', () => {
  it('preserves incomplete fields and gives restored steps fresh keys', () => {
    const record = saved();
    expect(parseRecovery(record)).toEqual(record);
    const restored = restoredContent(record.content);
    expect(restored.tagText).toBe('pending');
    expect(restored.steps[0].glazeId).toBe('');
    expect(restored.steps[1].notes).toBe('Still needs a label');
    const keys = [...restored.steps.map((s) => s.key), glazeStepDraft().key];
    expect(new Set(keys).size).toBe(keys.length);
    expect(restored.steps.map((s) => s.key)).not.toEqual(record.content.steps.map((s) => s.key));
  });

  it("keeps an edit's starting tags with the content; records without them stay valid", () => {
    const record = { ...saved(), content: { ...saved().content, baseTags: ['blue', 'satin'] } };
    expect(parseRecovery(record)).toEqual(record);
    expect(restoredContent(record.content).baseTags).toEqual(['blue', 'satin']);
    expect(restoredContent(saved().content)).not.toHaveProperty('baseTags');
  });

  it("keeps an edit's starting title with the content; records without it stay valid", () => {
    const record = { ...saved(), content: { ...saved().content, baseTitle: 'Before the rename' } };
    expect(parseRecovery(record)).toEqual(record);
    expect(restoredContent(record.content).baseTitle).toBe('Before the rename');
  });

  it('keeps only how many photos were attached, never the photos; records without the count stay valid', () => {
    const record = { ...saved(), content: { ...saved().content, photos: 2 } };
    expect(parseRecovery(record)).toEqual(record);
    expect(restoredContent(record.content).photos).toBe(2);
    expect(parseRecovery(saved())?.content).not.toHaveProperty('photos');
  });

  it.each([
    null,
    {},
    { version: 2 },
    { ...saved(), content: { title: 3 } },
    { ...saved(), content: { ...saved().content, steps: [{}] } },
    { ...saved(), content: { ...saved().content, firing: {} } },
    { ...saved(), content: { ...saved().content, baseTags: 'blue' } },
    { ...saved(), content: { ...saved().content, baseTags: [3] } },
    { ...saved(), content: { ...saved().content, baseTitle: 3 } },
    { ...saved(), content: { ...saved().content, photos: -1 } },
    { ...saved(), content: { ...saved().content, photos: [{ name: 'tile.png' }] } },
  ])('ignores damaged or future records: %j', (value) => {
    expect(parseRecovery(value)).toBeUndefined();
  });

  it('keeps separate accounts and forms, clears only the saved revision, and removes all recoveries on sign-out', async () => {
    const first = saved();
    const newer = saved();
    await saveStudioRecovery('recovery-a', '#/studio', first);
    await saveStudioRecovery('recovery-a', '#/studio?from=c1', newer);
    await saveStudioRecovery('recovery-b', '#/studio', first);
    expect(await readStudioRecovery('recovery-a', '#/studio')).toEqual(first);
    await saveStudioRecovery('recovery-a', '#/studio', newer);
    await deleteStudioRecovery('recovery-a', '#/studio', first.revision);
    expect(await readStudioRecovery('recovery-a', '#/studio')).toEqual(newer);
    await deleteStudioRecovery('recovery-a', '#/studio', newer.revision);
    expect(await readStudioRecovery('recovery-a', '#/studio')).toBeUndefined();
    await deleteSnapshot('recovery-a');
    expect(await readStudioRecovery('recovery-a', '#/studio?from=c1')).toBeUndefined();
    expect(await readStudioRecovery('recovery-b', '#/studio')).toEqual(first);
    await deleteSnapshot('recovery-b');
  });
});
