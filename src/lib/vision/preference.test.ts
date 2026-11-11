import { describe, expect, it } from 'vitest';
import { isMetered, isSlow, PREFERENCE_KEY, readPreference, SLOW_MS, writePreference } from './preference';

function storage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => void (data[key] = value),
  };
}

describe('the per-device preference', () => {
  it('is absent until the writer chose, and only on or off count', () => {
    expect(readPreference(storage())).toBeNull();
    expect(readPreference(storage({ [PREFERENCE_KEY]: 'on' }))).toBe('on');
    expect(readPreference(storage({ [PREFERENCE_KEY]: 'off' }))).toBe('off');
    expect(readPreference(storage({ [PREFERENCE_KEY]: '1' }))).toBeNull();
    expect(readPreference(storage({ [PREFERENCE_KEY]: 'yes' }))).toBeNull();
  });

  it('stores the choice under the documented key', () => {
    const store = storage();
    expect(writePreference('on', store)).toBe(true);
    expect(store.data).toEqual({ 'glazelab:photo-suggestions': 'on' });
    writePreference('off', store);
    expect(readPreference(store)).toBe('off');
  });

  it('survives a browser that refuses storage', () => {
    const refusing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(readPreference(refusing)).toBeNull();
    expect(writePreference('on', refusing)).toBe(false);
  });
});

describe('isMetered', () => {
  it('is Data Saver or a cellular connection', () => {
    expect(isMetered({ saveData: true })).toBe(true);
    expect(isMetered({ type: 'cellular' })).toBe(true);
    expect(isMetered({ saveData: false, type: 'wifi' })).toBe(false);
    expect(isMetered({})).toBe(false);
    expect(isMetered(undefined)).toBe(false);
  });
});

describe('isSlow', () => {
  it('is slower than the measured limit, not equal to it', () => {
    expect(isSlow(SLOW_MS)).toBe(false);
    expect(isSlow(SLOW_MS + 1)).toBe(true);
    expect(isSlow(0)).toBe(false);
  });
});
