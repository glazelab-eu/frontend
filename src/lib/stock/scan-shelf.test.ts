import { describe, expect, it } from 'vitest';
import { forgetScanShelf, scanShelfKey } from './scan-shelf';

describe('the old scan shelf preference', () => {
  it('is removed per account at sign-out', () => {
    const data = new Map([
      [scanShelfKey('a'), 'club-1'],
      [scanShelfKey('b'), 'club-2'],
    ]);
    forgetScanShelf('a', { removeItem: (key: string) => void data.delete(key) });
    expect([...data.keys()]).toEqual([scanShelfKey('b')]);
  });

  it('survives unreadable storage', () => {
    const broken = {
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => forgetScanShelf('a', broken)).not.toThrow();
  });
});
