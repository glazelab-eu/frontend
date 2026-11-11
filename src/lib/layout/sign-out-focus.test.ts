import { describe, expect, it } from 'vitest';
import { createSignOutRequest, focusSignInAfterSignOut } from './sign-out-focus';

describe('focusSignInAfterSignOut', () => {
  const body = { tag: 'body' } as unknown as Element;
  const control = { tag: 'button' } as unknown as Element;

  it('moves focus to Sign in when the person signed out and focus fell back to the page', () => {
    expect(focusSignInAfterSignOut(true, true, false, body, body)).toBe(true);
    expect(focusSignInAfterSignOut(true, true, false, null, body)).toBe(true);
  });
  it('moves focus from the wide header’s Sign out, which stays in the page but turns inert with the session', () => {
    const stranded = { tag: 'button', closest: (selector: string) => (selector === '[inert]' ? control : null) } as unknown as Element;
    expect(focusSignInAfterSignOut(true, true, false, stranded, body)).toBe(true);
    expect(focusSignInAfterSignOut(false, true, false, stranded, body)).toBe(false);
  });
  it('leaves focus on a control the person chose', () => {
    expect(focusSignInAfterSignOut(true, true, false, control, body)).toBe(false);
  });
  it('never moves focus when the session ended without a Sign out here (expired session, another tab)', () => {
    expect(focusSignInAfterSignOut(false, true, false, body, body)).toBe(false);
    expect(focusSignInAfterSignOut(false, true, false, null, body)).toBe(false);
  });
  it('does nothing without a sign-out: the first render, a sign-in or a stable session', () => {
    expect(focusSignInAfterSignOut(true, undefined, false, body, body)).toBe(false);
    expect(focusSignInAfterSignOut(true, undefined, true, body, body)).toBe(false);
    expect(focusSignInAfterSignOut(true, false, true, body, body)).toBe(false);
    expect(focusSignInAfterSignOut(true, true, true, body, body)).toBe(false);
    expect(focusSignInAfterSignOut(true, false, false, body, body)).toBe(false);
  });
});

describe('createSignOutRequest', () => {
  it('is read once: a later session end is not a Sign out of this person', () => {
    const request = createSignOutRequest();
    expect(request.consume()).toBe(false);
    request.press();
    expect(request.consume()).toBe(true);
    expect(request.consume()).toBe(false);
  });
});
