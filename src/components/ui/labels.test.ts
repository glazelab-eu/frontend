import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import en from '../../lib/i18n/en.json';
import { DEFAULT_LABELS, labels } from './labels';

describe('ui labels', () => {
  it('start in English, the same text the app sets for English', () => {
    expect(get(labels)).toEqual(DEFAULT_LABELS);
    expect(DEFAULT_LABELS.close).toBe(en['common.close']);
  });
});
