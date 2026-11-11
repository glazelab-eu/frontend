import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { createOfflineToast, OFFLINE_TOAST_MS } from './offline-toast';

describe('the offline toast', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is hidden until the person opens it, and never shows by itself', () => {
    const toast = createOfflineToast();
    expect(get(toast.state)).toBe(false);
    vi.advanceTimersByTime(10 * OFFLINE_TOAST_MS);
    expect(get(toast.state)).toBe(false);
  });

  it('shows on open and goes away after its time', () => {
    const toast = createOfflineToast();
    toast.open();
    expect(get(toast.state)).toBe(true);
    vi.advanceTimersByTime(OFFLINE_TOAST_MS - 1);
    expect(get(toast.state)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(get(toast.state)).toBe(false);
  });

  it('opening it again restarts the clock and keeps it one toast', () => {
    const toast = createOfflineToast();
    const seen: boolean[] = [];
    toast.state.subscribe((value) => seen.push(value));
    toast.open();
    vi.advanceTimersByTime(OFFLINE_TOAST_MS - 100);
    toast.open();
    vi.advanceTimersByTime(OFFLINE_TOAST_MS - 100);
    expect(get(toast.state)).toBe(true);
    vi.advanceTimersByTime(100);
    expect(get(toast.state)).toBe(false);
    expect(seen.filter((value) => !value)).toHaveLength(2);
  });

  it('close hides it at once and cancels the clock', () => {
    const toast = createOfflineToast();
    toast.open();
    toast.close();
    expect(get(toast.state)).toBe(false);
    toast.open();
    vi.advanceTimersByTime(OFFLINE_TOAST_MS - 1);
    expect(get(toast.state)).toBe(true);
  });

  it('stays while it is held and gets its full time again on release', () => {
    const toast = createOfflineToast();
    toast.open();
    toast.hold();
    vi.advanceTimersByTime(10 * OFFLINE_TOAST_MS);
    expect(get(toast.state)).toBe(true);
    toast.release();
    vi.advanceTimersByTime(OFFLINE_TOAST_MS - 1);
    expect(get(toast.state)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(get(toast.state)).toBe(false);
  });

  it('release on a hidden toast starts nothing', () => {
    const toast = createOfflineToast();
    toast.release();
    expect(vi.getTimerCount()).toBe(0);
    expect(get(toast.state)).toBe(false);
  });
});
