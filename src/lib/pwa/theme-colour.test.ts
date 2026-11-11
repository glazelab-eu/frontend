import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setThemeColor } from './theme-colour';

let tag: { content: string } | null;
const content = () => tag?.content;

beforeEach(() => {
  tag = { content: '#fafaf5' };
  vi.stubGlobal('document', { querySelector: () => tag });
});
afterEach(() => vi.unstubAllGlobals());

describe('setThemeColor', () => {
  it('sets the colour and restores the original content', () => {
    const restore = setThemeColor('#101a16');
    expect(content()).toBe('#101a16');
    restore();
    expect(content()).toBe('#fafaf5');
  });

  it('restores only once and ignores a second call', () => {
    const restore = setThemeColor('#101a16');
    restore();
    tag!.content = '#123456';
    restore();
    expect(content()).toBe('#123456');
  });

  it('keeps the original through nested users, in either order', () => {
    const first = setThemeColor('#111111');
    const second = setThemeColor('#222222');
    expect(content()).toBe('#222222');
    second();
    expect(content()).toBe('#111111');
    first();
    expect(content()).toBe('#fafaf5');

    const a = setThemeColor('#111111');
    const b = setThemeColor('#222222');
    a();
    expect(content()).toBe('#222222');
    b();
    expect(content()).toBe('#fafaf5');
  });

  it('does nothing without a meta tag or a colour', () => {
    expect(setThemeColor('')()).toBeUndefined();
    tag = null;
    expect(() => setThemeColor('#101a16')()).not.toThrow();
  });
});
