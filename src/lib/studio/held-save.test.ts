import { describe, expect, it } from 'vitest';
import { cancel, finish, hold, idle, isActive, release, studioLeaveQuestion, type HeldSave } from './held-save';

const request = { title: 'Blue', draft: true };
const held = hold<typeof request>(idle, request, 'u1');

describe('held save', () => {
  it('holds the request of a signed-in account only', () => {
    expect(held).toEqual({ phase: 'held', request, account: 'u1' });
    expect(hold(idle, request, undefined)).toBe(idle);
  });

  it('refuses a second request while one is held or sending', () => {
    const other = { title: 'Other', draft: false };
    expect(hold(held, other, 'u1')).toBe(held);
    const sending = release(held, 'u1', true).state;
    expect(hold(sending, other, 'u1')).toBe(sending);
  });

  it('holds again after done, failed and cancelled', () => {
    const terminal: HeldSave<typeof request>[] = [{ phase: 'done' }, { phase: 'failed' }, { phase: 'cancelled', reason: 'user' }];
    for (const state of terminal) expect(hold(state, request, 'u1').phase).toBe('held');
  });

  it('keeps waiting while not ready', () => {
    expect(release(held, 'u1', false)).toEqual({ state: held, send: null });
  });

  it('hands the request out once', () => {
    const first = release(held, 'u1', true);
    expect(first.send).toBe(request);
    expect(first.state).toEqual({ phase: 'sending', request, account: 'u1' });
    const second = release(first.state, 'u1', true);
    expect(second).toEqual({ state: first.state, send: null });
    expect(isActive(first.state)).toBe(true);
  });

  it('drops a request of another account, or of nobody, without sending it', () => {
    for (const account of ['u2', undefined]) {
      const result = release(held, account, true);
      expect(result.send).toBeNull();
      expect(result.state).toEqual({ phase: 'cancelled', reason: 'account' });
    }
  });

  it('drops a sending request when the account changes, so its answer changes nothing', () => {
    const sending = release(held, 'u1', true).state;
    const result = release(sending, undefined, true);
    expect(result).toEqual({ state: { phase: 'cancelled', reason: 'account' }, send: null });
    expect(finish(result.state, true)).toBe(result.state);
  });

  it('cancels a held save and then sends nothing', () => {
    const cancelled = cancel(held);
    expect(cancelled).toEqual({ phase: 'cancelled', reason: 'user' });
    expect(release(cancelled, 'u1', true).send).toBeNull();
  });

  it('cannot call back a save that is sending', () => {
    const sending = release(held, 'u1', true).state;
    expect(cancel(sending)).toBe(sending);
  });

  it('ends a send as done or failed, once', () => {
    const sending = release(held, 'u1', true).state;
    expect(finish(sending, true)).toEqual({ phase: 'done' });
    expect(finish(sending, false)).toEqual({ phase: 'failed' });
    expect(finish(held, true)).toBe(held);
    expect(finish(idle, false)).toBe(idle);
  });
});

describe('the leave question of Studio', () => {
  it('does not ask for an untouched form', () => {
    expect(studioLeaveQuestion({ dirty: false, phase: 'idle', saving: false }).dirty).toBe(false);
    expect(studioLeaveQuestion({ dirty: false, phase: 'done', saving: false }).dirty).toBe(false);
  });

  it('offers to discard unsaved input', () => {
    expect(studioLeaveQuestion({ dirty: true, phase: 'idle', saving: false })).toEqual({ dirty: true, message: 'drafts.discardCombination' });
  });

  it('says leaving drops the photos still on their way but keeps the save, and offers to discard photos that failed', () => {
    expect(studioLeaveQuestion({ dirty: false, phase: 'idle', saving: true, photos: 'sending' })).toEqual({
      dirty: true,
      message: 'studio.leave.saving',
      body: 'studio.leave.photosBody',
      leave: 'studio.leave.anyway',
    });
    expect(studioLeaveQuestion({ dirty: false, phase: 'idle', saving: false, photos: 'failed' })).toEqual({ dirty: true, message: 'drafts.discardUpload' });
  });

  it('offers to discard a save that still waits, since leaving drops it', () => {
    expect(studioLeaveQuestion({ dirty: false, phase: 'held', saving: false })).toEqual({ dirty: true, message: 'studio.held.discard' });
  });

  it.each([
    ['a held save that is sending', 'sending', false],
    ['an online save under way', 'idle', true],
    ['both', 'sending', true],
  ] as const)('never promises a discard for %s', (_name, phase, saving) => {
    expect(studioLeaveQuestion({ dirty: true, phase, saving })).toEqual({
      dirty: true,
      message: 'studio.leave.saving',
      body: 'studio.leave.savingBody',
      leave: 'studio.leave.anyway',
    });
    // The form can be pristine while the request is still out.
    expect(studioLeaveQuestion({ dirty: false, phase, saving }).dirty).toBe(true);
  });
});
