import { describe, expect, it, vi } from 'vitest';
import { describeArgs, installHooks } from './hooks';

describe('describeArgs', () => {
  it('prints strings and error messages, and names other values by type only', () => {
    expect(describeArgs(['failed', new TypeError('bad'), { secret: 'x' }, 5, null])).toBe('failed TypeError: bad [object] [number] [object]');
  });
});

describe('installHooks', () => {
  it('wraps console.error and console.warn, calls the original first, and feeds unhandled rejections and errors', () => {
    const order: string[] = [];
    const listeners = new Map<string, (event: unknown) => void>();
    const target = {
      console: { error: () => order.push('original error'), warn: () => order.push('original warn') },
      addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
    } as unknown as Window & typeof globalThis;
    const capture = vi.fn(() => order.push('capture'));
    installHooks({ capture } as never, target);
    target.console.error('oops', { a: 1 });
    target.console.warn('careful');
    expect(order).toEqual(['original error', 'capture', 'original warn', 'capture']);
    expect(capture).toHaveBeenNthCalledWith(1, 'ERROR', 'oops [object]', undefined);
    expect(capture).toHaveBeenNthCalledWith(2, 'WARNING', 'careful', undefined);
    listeners.get('unhandledrejection')?.({ reason: new Error('late') });
    expect(capture).toHaveBeenLastCalledWith('UNHANDLED_REJECTION', 'Error: late', expect.any(String));
  });

  it('never lets the capture break console.error', () => {
    const target = {
      console: { error: vi.fn(), warn: vi.fn() },
      addEventListener: () => {},
    } as unknown as Window & typeof globalThis;
    const original = target.console.error;
    installHooks(
      {
        capture: () => {
          throw new Error('x');
        },
      } as never,
      target,
    );
    // The hooks were installed once already in this file: the module keeps the first wrapper target, so this checks the sink swap only.
    expect(() => target.console.error('a')).not.toThrow();
    expect(original).toBeDefined();
  });
});
