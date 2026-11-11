import { describe, expect, it } from 'vitest';
import { combination, customStep, glaze, glazeStep } from '../../test/fixtures';
import { codeEditable, editChange, editFieldLabel, formatEditedAt, formatEditedOn, glazeCorrection, glazeEditDraft } from './glaze-edit';

describe('codeEditable', () => {
  const user = { siteAdmin: false };
  const admin = { siteAdmin: true };
  const using = combination({ steps: [glazeStep({ glazeId: 'g1' })] });

  it('lets nobody but signed-in users edit, and site admins always', () => {
    expect(codeEditable('g1', null, [])).toBe(false);
    expect(codeEditable('g1', user, [])).toBe(true);
    expect(codeEditable('g1', admin, [using])).toBe(true);
  });

  it('locks the code for others once a glaze step uses the glaze, drafts included, custom steps never', () => {
    expect(codeEditable('g1', user, [using])).toBe(false);
    expect(codeEditable('g1', user, [combination({ draft: true, steps: [glazeStep({ glazeId: 'g1' })] })])).toBe(false);
    expect(codeEditable('g1', user, [combination({ steps: [customStep(), glazeStep({ glazeId: 'g2' })] })])).toBe(true);
  });
});

describe('glazeCorrection', () => {
  const stored = glaze({ name: 'Blue', code: 'PC-20', notes: 'Glossy' });

  it('starts from the glaze and sends nothing while nothing differs', () => {
    const draft = glazeEditDraft(stored);
    expect(draft).toEqual({ name: 'Blue', code: 'PC-20', notes: 'Glossy' });
    expect(glazeCorrection(stored, draft)).toBeNull();
    expect(glazeCorrection(stored, { name: ' Blue ', code: 'pc 20', notes: 'Glossy  ' })).toBeNull();
    expect(glazeEditDraft(glaze({ notes: null })).notes).toBe('');
    expect(glazeCorrection(glaze({ notes: null }), { name: 'Blue', code: 'PC-20', notes: '  ' })).toBeNull();
  });

  it('sends only the changed fields, trimmed and normalized, and cleared notes as null', () => {
    expect(glazeCorrection(stored, { name: ' Navy ', code: 'PC-20', notes: 'Glossy' })).toEqual({ name: 'Navy' });
    expect(glazeCorrection(stored, { name: 'Blue', code: 'pc / 21', notes: 'Glossy' })).toEqual({ code: 'PC-21' });
    expect(glazeCorrection(stored, { name: 'Blue', code: 'PC-20', notes: ' ' })).toEqual({ notes: null });
    expect(glazeCorrection(stored, { name: 'Navy', code: 'PC-21', notes: 'Matte' })).toEqual({ name: 'Navy', code: 'PC-21', notes: 'Matte' });
  });

  it('never sends an untouched field whose stored value predates the current rules', () => {
    // Codes from before the normalizer and notes saved untrimmed: a name edit must not touch them (a used
    // glaze's code would answer 403 for a non-admin, and the log would gain a trim-only change).
    const legacy = glaze({ name: 'Blue', code: 'PC 20', notes: 'Glossy ' });
    expect(glazeCorrection(legacy, { ...glazeEditDraft(legacy), name: 'Navy' })).toEqual({ name: 'Navy' });
    expect(glazeCorrection(legacy, glazeEditDraft(legacy))).toBeNull();
    // Edited on purpose, they are sent normalized and trimmed.
    expect(glazeCorrection(legacy, { name: 'Blue', code: 'pc 20', notes: 'Glossy' })).toEqual({ code: 'PC-20', notes: 'Glossy' });
  });
});

describe('change log formatting', () => {
  it('labels each field', () => {
    expect(editFieldLabel('NAME')).toBe('glaze.history.name');
    expect(editFieldLabel('CODE')).toBe('glaze.history.code');
    expect(editFieldLabel('NOTES')).toBe('glaze.history.notes');
  });

  it('reads a change as set, cleared or changed', () => {
    expect(editChange({ oldValue: null, newValue: 'Glossy' })).toEqual({ key: 'glaze.history.set', values: { to: 'Glossy' } });
    expect(editChange({ oldValue: 'Glossy', newValue: null })).toEqual({ key: 'glaze.history.cleared', values: { from: 'Glossy' } });
    expect(editChange({ oldValue: 'Bleu', newValue: 'Blue' })).toEqual({ key: 'glaze.history.change', values: { from: 'Bleu', to: 'Blue' } });
  });

  it('formats times and days by locale, keeping unknown values readable', () => {
    const at = '2026-10-30T12:00:00Z';
    expect(formatEditedOn(at, 'en')).toBe(new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(at)));
    expect(formatEditedOn(at, 'de')).toBe(new Intl.DateTimeFormat('de', { dateStyle: 'medium' }).format(new Date(at)));
    expect(formatEditedAt(at, 'pt-PT')).toBe(new Intl.DateTimeFormat('pt-PT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(at)));
    expect(formatEditedOn('', 'en')).toBe('');
    expect(formatEditedAt('soon', 'en')).toBe('soon');
  });
});
