import { describe, expect, it } from 'vitest';
import { failureVerdict, GRACE_MS, MAX_SILENT_RETRIES } from './grace';

describe('failureVerdict', () => {
  it('waits and retries for an early failure on a device that thinks it is online', () => {
    expect(failureVerdict({ onLine: true, sinceMs: 0, retries: 0 })).toBe('retry');
    expect(failureVerdict({ onLine: undefined, sinceMs: GRACE_MS - 1, retries: 0 })).toBe('retry');
  });

  it('warns once the grace window is over', () => {
    expect(failureVerdict({ onLine: true, sinceMs: GRACE_MS, retries: 0 })).toBe('warn');
    expect(failureVerdict({ onLine: true, sinceMs: 60_000, retries: 0 })).toBe('warn');
  });

  it('warns after the silent retries failed too', () => {
    expect(MAX_SILENT_RETRIES).toBe(1);
    expect(failureVerdict({ onLine: true, sinceMs: 100, retries: MAX_SILENT_RETRIES })).toBe('warn');
  });

  it('warns at once on a device that reports itself offline', () => {
    expect(failureVerdict({ onLine: false, sinceMs: 0, retries: 0 })).toBe('warn');
  });
});
