import { describe, expect, it } from 'vitest';
import { combination, customStep, glazeStep } from '../../test/fixtures';
import { SAME_GLAZES_LIMIT, draftGlazeKey, sameGlazes } from './same-glazes';
import { customStepDraft, glazeStepDraft } from './step-draft';

const glazed = (...glazeIds: string[]) => glazeIds.map((glazeId) => ({ ...glazeStepDraft(), glazeId }));
const recipe = (...glazeIds: string[]) => glazeIds.map((glazeId, index) => glazeStep({ glazeId, position: index + 1 }));
const ids = (list: { items: { id: string }[] }) => list.items.map((item) => item.id);

describe('draftGlazeKey', () => {
  it('is null without a glaze step or while a glaze step has no glaze chosen', () => {
    expect(draftGlazeKey([])).toBeNull();
    expect(draftGlazeKey([customStepDraft()])).toBeNull();
    expect(draftGlazeKey([...glazed('a'), glazeStepDraft()])).toBeNull();
  });

  it('keeps the order of the glazes and leaves custom steps, coats and methods out', () => {
    const steps = [{ ...customStepDraft(), label: 'Wax' }, ...glazed('a'), { ...glazeStepDraft(5), glazeId: 'b', method: 'Dip' }];
    expect(draftGlazeKey(steps)).toBe(draftGlazeKey(glazed('a', 'b')));
    expect(draftGlazeKey(glazed('a', 'b'))).not.toBe(draftGlazeKey(glazed('b', 'a')));
  });
});

describe('sameGlazes', () => {
  it('finds combinations with the same glazes in the same order, whatever their coats, methods and custom steps', () => {
    const same = combination({ id: 'same', steps: [customStep(), glazeStep({ glazeId: 'a', coats: 3, method: 'Spray' }), glazeStep({ glazeId: 'b' })] });
    const list = [
      same,
      combination({ id: 'reversed', steps: recipe('b', 'a') }),
      combination({ id: 'shorter', steps: recipe('a') }),
      combination({ id: 'longer', steps: recipe('a', 'b', 'c') }),
      combination({ id: 'twice', steps: recipe('a', 'b', 'b') }),
      combination({ id: 'no glaze', steps: [customStep()] }),
    ];
    expect(ids(sameGlazes(draftGlazeKey(glazed('a', 'b')), list, []))).toEqual(['same']);
    expect(ids(sameGlazes(draftGlazeKey(glazed('a')), list, []))).toEqual(['shorter']);
  });

  it('finds nothing while the form has no complete glaze order', () => {
    const list = [combination({ id: 'any', steps: [customStep()] }), combination({ id: 'a', steps: recipe('a') })];
    expect(sameGlazes(draftGlazeKey([]), list, [])).toEqual({ items: [], total: 0 });
    expect(sameGlazes(draftGlazeKey([...glazed('a'), glazeStepDraft()]), list, [])).toEqual({ items: [], total: 0 });
  });

  it('leaves out the form’s own combination and the one it is a variation of', () => {
    const list = ['self', 'source', 'other'].map((id) => combination({ id, steps: recipe('a') }));
    expect(ids(sameGlazes(draftGlazeKey(glazed('a')), list, ['self', 'source', null, undefined]))).toEqual(['other']);
  });

  it('names the account’s own first, keeps the listing order within each group and counts every match', () => {
    const list = ['theirs-new', 'own-new', 'theirs-old', 'own-draft', 'theirs-older'].map((id) =>
      combination({ id, own: id.startsWith('own'), draft: id === 'own-draft', steps: recipe('a') }),
    );
    const found = sameGlazes(draftGlazeKey(glazed('a')), list, []);
    expect(ids(found)).toEqual(['own-new', 'own-draft', 'theirs-new'].slice(0, SAME_GLAZES_LIMIT));
    expect(found.total).toBe(5);
  });

  it('compares a replaced combination by its new steps', () => {
    const before = combination({ id: 'edited', steps: recipe('a') });
    const key = draftGlazeKey(glazed('a'));
    expect(sameGlazes(key, [before], []).total).toBe(1);
    expect(sameGlazes(key, [{ ...before, steps: recipe('b') }], []).total).toBe(0);
  });
});
