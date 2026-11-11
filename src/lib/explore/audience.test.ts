import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetIntroDismissal, introDone, introSteps, readIntroDismissal, rememberIntroDismissal } from './audience';

afterEach(() => vi.unstubAllGlobals());

const fresh = { avatarId: null, diagnosticsOptIn: false };

describe('audience checklist', () => {
  it('offers all five linked steps for an empty account', () => {
    expect(introSteps([], [], [], fresh)).toEqual([
      { kind: 'shelf', complete: false, route: { name: 'stock' } },
      { kind: 'combination', complete: false, route: { name: 'studio' } },
      { kind: 'club', complete: false, route: { name: 'clubs' } },
      { kind: 'picture', complete: false, route: { name: 'account', section: 'picture' } },
      { kind: 'diagnostics', complete: false, route: { name: 'account', section: 'diagnostics' } },
    ]);
  });
  it('ticks the picture step for a picture and the error-report step only while reports are on', () => {
    const done = (account: { avatarId: string | null; diagnosticsOptIn: boolean }) =>
      introSteps([], [], [], account)
        .filter((step) => step.complete)
        .map((step) => step.kind);
    expect(done({ avatarId: 'a1', diagnosticsOptIn: false })).toEqual(['picture']);
    expect(done({ avatarId: null, diagnosticsOptIn: true })).toEqual(['diagnostics']);
    expect(done({ avatarId: 'a1', diagnosticsOptIn: true })).toEqual(['picture', 'diagnostics']);
  });
  it('ticks each step from the current account data, including partial and complete progress', () => {
    expect(introSteps([{ quantityG: 10, clubId: null }], [], [], fresh).map((step) => step.complete)).toEqual([true, false, false, false, false]);
    expect(introSteps([], [{ own: true }], ['club'], fresh).map((step) => step.complete)).toEqual([false, true, true, false, false]);
    expect(
      introSteps([{ quantityG: 1, clubId: null }], [{ own: true }], ['club'], { avatarId: 'a1', diagnosticsOptIn: true }).every((step) => step.complete),
    ).toBe(true);
  });
  it('is done once every step but the optional error reports is: leaving reports off never keeps the card', () => {
    const othersDone = (account: { avatarId: string | null; diagnosticsOptIn: boolean }) =>
      introDone(introSteps([{ quantityG: 1, clubId: null }], [{ own: true }], ['club'], account));
    expect(othersDone({ avatarId: 'a1', diagnosticsOptIn: false })).toBe(true);
    expect(othersDone({ avatarId: 'a1', diagnosticsOptIn: true })).toBe(true);
    expect(othersDone({ avatarId: null, diagnosticsOptIn: true })).toBe(false);
    expect(introDone(introSteps([], [{ own: true }], ['club'], { avatarId: 'a1', diagnosticsOptIn: true }))).toBe(false);
    expect(introDone(introSteps([], [], [], fresh))).toBe(false);
  });
  it('does not tick the combination step for a draft alone, only for a published own combination', () => {
    expect(introSteps([], [{ own: true, draft: true }], [], fresh).map((step) => step.complete)).toEqual([false, false, false, false, false]);
    expect(
      introSteps(
        [],
        [
          { own: true, draft: true },
          { own: true, draft: false },
        ],
        [],
        fresh,
      ).map((step) => step.complete),
    ).toEqual([false, true, false, false, false]);
  });
  it('does not count other makers, club stock or used-up personal stock as personal activity', () => {
    expect(
      introSteps(
        [
          { quantityG: 20, clubId: 'club' },
          { quantityG: 0, clubId: null },
        ],
        [{ own: false }],
        [],
        fresh,
      ).map((step) => step.complete),
    ).toEqual([false, false, false, false, false]);
  });
});

describe('account-specific device dismissal', () => {
  function storage() {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
  }
  it('remembers only this account, with no checklist or personal data persisted', () => {
    const device = storage();
    expect(readIntroDismissal('u1', device)).toBe(false);
    rememberIntroDismissal('u1', device);
    expect(readIntroDismissal('u1', device)).toBe(true);
    expect(readIntroDismissal('u2', device)).toBe(false);
    expect(readIntroDismissal('u1', storage())).toBe(false);
  });
  it('treats unavailable or throwing storage as an optional preference', () => {
    const blocked = {
      getItem() {
        throw Error('blocked');
      },
      setItem() {
        throw Error('quota');
      },
    };
    expect(readIntroDismissal('u1', blocked)).toBe(false);
    expect(() => rememberIntroDismissal('u1', blocked)).not.toThrow();
    vi.stubGlobal('localStorage', undefined);
    expect(readIntroDismissal('u1')).toBe(false);
    expect(() => rememberIntroDismissal('u1')).not.toThrow();
  });
  it("forgets one account's dismissal and survives throwing storage", () => {
    const device = storage();
    rememberIntroDismissal('u1', device);
    rememberIntroDismissal('u2', device);
    forgetIntroDismissal('u1', device);
    expect([readIntroDismissal('u1', device), readIntroDismissal('u2', device)]).toEqual([false, true]);
    const blocked = {
      getItem: () => null,
      setItem() {},
      removeItem() {
        throw Error('blocked');
      },
    };
    expect(() => forgetIntroDismissal('u1', blocked)).not.toThrow();
  });
  it('accepts only the explicit dismissal value', () => {
    const device = storage();
    device.setItem('glazelab:intro-dismissed:u1', 'false');
    expect(readIntroDismissal('u1', device)).toBe(false);
  });
});
