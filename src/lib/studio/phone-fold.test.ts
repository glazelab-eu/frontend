import { describe, expect, it } from 'vitest';
import { foldExpanded, foldTitle } from './phone-fold';

describe('foldExpanded', () => {
  it('is always open on wide screens, whatever was chosen on a phone', () => {
    expect(foldExpanded(false, false)).toBe(true);
    expect(foldExpanded(false, true)).toBe(true);
  });

  it('follows the choice on a phone, closed until opened', () => {
    expect(foldExpanded(true, false)).toBe(false);
    expect(foldExpanded(true, true)).toBe(true);
  });

  it('keeps an opened choice across a resize to a wide screen and back', () => {
    let open = false;
    open = !open;
    expect(foldExpanded(true, open)).toBe(true);
    expect(foldExpanded(false, open)).toBe(true);
    expect(foldExpanded(true, open)).toBe(true);
  });
});

describe('foldTitle', () => {
  it('appends the count in brackets', () => {
    expect(foldTitle('Waiting for photos', 14)).toBe('Waiting for photos (14)');
  });
});
