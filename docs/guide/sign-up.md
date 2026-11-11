# Sign-up, guests and operator contact

## Sign-up (`auth/AuthDialog`, `app.submitAuth`, form `auth`)

- Email and display name only, never a password or consent (`lib/api/registration.ts`); the terms are readable there, with a note that they are accepted at activation. With mail, the dialog turns into the check-email step with the resend request (`AccountRecovery`, prefilled).
- The activation form (`AccountLink` once the API asks for activation, and the setup step) is the consent (topic "Contract": the terms are accepted at activation, never at registration): the terms (`TermsView` in a `details`), a required acceptance box and the error-report box, unchecked, with the account page's wording; `api` adds `termsVersion`. Every activating link (verify, magic login, a pending account's reset) shows it; `AccountLink` is a sheet on phones so the long words fit at 320 px.
- A mail-free server's `setupToken` opens `AccountLink` as `kind="setup"`. The token is a controller variable only (never the store, a route, history, storage or a snapshot), cleared after `completeAccountSetup`, by `closeAccountSetup` and on an account change; `AppState.accountSetup` holds only email and name.
- The setup step signs in with the new password; if only that fails, the sign-in dialog opens. A mail-free answer without a token (address taken) is a form error.

## Guests

- Every `AppNav` entry is a link for guests. Shelf, Studio, Clubs and the club page show their intro and `auth/SignInEmpty`; a guest page needs no data.
- Combination and glaze pages end with `catalog/GuestInvitation` while `isGuest(state)` (no user and the session settled, so it never flashes for a signed-in visitor).
- The star is an active button for guests: never gate a star on `user`. `app.toggleFavorite(kind, id)` opens the sign-in dialog for a guest and sends nothing.
- The sign-in dialog never navigates.

## Operator contact (`legal/OperatorContact`)

- The address is never in `AuthOptions`, the state, a snapshot, localStorage, the i18n files or the built files, and never passed down as a prop.
- The component gets `loadContact` (`app.operatorContact`, `GET /api/auth/operator-contact`, keeps nothing) and requests only on the button's click (`state/legal/operator-contact.svelte.ts`). The answer becomes a `mailto:` link in an `aria-live="polite"` region (focus moves to it); any failure shows one message with the button again. State is cleared on unmount; a later answer is dropped.
- The button is always visible (footer and `TermsView`), for signed-out and signed-in visitors alike.
