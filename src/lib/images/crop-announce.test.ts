import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANNOUNCE_WAIT_MS, createAnnouncer } from './crop-announce';

describe('throttled announcements', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = () => {
    const said: string[] = [];
    return { said, announcer: createAnnouncer((text) => said.push(text)) };
  };

  it('says the first message at once', () => {
    const { said, announcer } = make();
    announcer.say('a');
    expect(said).toEqual(['a']);
  });

  it('says only the latest of a burst once the wait is over, never more often than once per wait', () => {
    const { said, announcer } = make();
    announcer.say('a');
    for (const text of ['b', 'c', 'd']) {
      vi.advanceTimersByTime(100);
      announcer.say(text);
    }
    expect(said).toEqual(['a']);
    vi.advanceTimersByTime(ANNOUNCE_WAIT_MS);
    expect(said).toEqual(['a', 'd']);
    // Nothing more is queued: a long quiet time says nothing.
    vi.advanceTimersByTime(10 * ANNOUNCE_WAIT_MS);
    expect(said).toEqual(['a', 'd']);
  });

  it('keeps pace while keys keep coming', () => {
    const { said, announcer } = make();
    for (let step = 0; step < 100; step++) {
      announcer.say(String(step));
      vi.advanceTimersByTime(50);
    }
    vi.advanceTimersByTime(ANNOUNCE_WAIT_MS);
    // 5 s of key repeat: about one message per wait, and the last position is among them.
    expect(said.length).toBeLessThanOrEqual(Math.ceil(5000 / ANNOUNCE_WAIT_MS) + 2);
    expect(said.length).toBeGreaterThan(3);
    expect(said.at(-1)).toBe('99');
  });

  it('speaks at once again after a quiet time', () => {
    const { said, announcer } = make();
    announcer.say('a');
    vi.advanceTimersByTime(ANNOUNCE_WAIT_MS * 2);
    announcer.say('b');
    expect(said).toEqual(['a', 'b']);
  });

  it('drops a pending message when cancelled', () => {
    const { said, announcer } = make();
    announcer.say('a');
    announcer.say('b');
    announcer.cancel();
    vi.advanceTimersByTime(ANNOUNCE_WAIT_MS * 3);
    expect(said).toEqual(['a']);
  });
});
