import { describe, expect, it } from 'vitest';
import { createJumpGuard } from './section-jump';

describe('createJumpGuard', () => {
  it('jumps once per arrival: a reload of the same page leaves it where it is', () => {
    const jump = createJumpGuard<'a' | 'b'>();
    expect(jump(false, 'a')).toBeUndefined();
    expect(jump(true, 'a')).toBe('a');
    expect(jump(true, 'a')).toBeUndefined();
  });

  it('jumps again after the page was shown without a section (the bare address, or Back to it)', () => {
    const jump = createJumpGuard<'a' | 'b'>();
    expect(jump(true, 'a')).toBe('a');
    expect(jump(true, undefined)).toBeUndefined();
    expect(jump(true, 'a')).toBe('a');
  });

  it('jumps to another section at once', () => {
    const jump = createJumpGuard<'a' | 'b'>();
    expect(jump(true, 'a')).toBe('a');
    expect(jump(true, 'b')).toBe('b');
    expect(jump(true, 'a')).toBe('a');
  });
});
