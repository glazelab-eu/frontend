import { beforeEach, describe, expect, it, vi } from 'vitest';

let destroy: (() => void) | undefined;
vi.mock('svelte', () => ({
  onDestroy: (callback: () => void) => {
    destroy = callback;
  },
}));

const { lifetime } = await import('./lifetime');

beforeEach(() => {
  destroy = undefined;
});

describe('lifetime', () => {
  it('is mounted until the component is destroyed', () => {
    const life = lifetime();
    expect(life.mounted()).toBe(true);
    destroy?.();
    expect(life.mounted()).toBe(false);
  });

  it('is current only for the account read before the await, while mounted', () => {
    let account: string | null | undefined = 'u1';
    const life = lifetime(() => account);
    const actor = account;
    expect(life.current(actor)).toBe(true);
    account = 'u2';
    expect(life.current(actor)).toBe(false);
    account = 'u1';
    expect(life.current(actor)).toBe(true);
    destroy?.();
    expect(life.current(actor)).toBe(false);
  });

  it('treats no account as no account', () => {
    const life = lifetime();
    expect(life.current(undefined)).toBe(true);
    expect(life.current('u1')).toBe(false);
  });
});
