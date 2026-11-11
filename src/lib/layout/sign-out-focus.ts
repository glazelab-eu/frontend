/**
 * Whether focus moves to the Sign in button: the person signed out here and focus fell back to the page, because the Sign out button (or
 * the account menu that held it) left with the session. A session that ends otherwise (expired, signed out in another tab) moves nothing,
 * and focus that already sits on a control stays where the person put it. The wide header keeps its Sign out button in the page, hidden
 * and `inert` once signed out (so the header keeps its width), and the browser leaves focus on it: focus there counts as fallen back too.
 */
export function focusSignInAfterSignOut(requested: boolean, hadUser: boolean | undefined, hasUser: boolean, active: Element | null, body: Element): boolean {
  return requested && hadUser === true && !hasUser && (!active || active === body || !!active.closest?.('[inert]'));
}

/**
 * Whether the person pressed a Sign out button: every Sign out control of the app presses it (`App` hands them one wrapper), and
 * `HeaderAccount` reads it once the session has ended (`focusSignInAfterSignOut`'s `requested`). `consume` answers and clears it.
 */
export interface SignOutRequest {
  press(): void;
  consume(): boolean;
}

export function createSignOutRequest(): SignOutRequest {
  let requested = false;
  return {
    press: () => {
      requested = true;
    },
    consume: () => {
      const was = requested;
      requested = false;
      return was;
    },
  };
}
