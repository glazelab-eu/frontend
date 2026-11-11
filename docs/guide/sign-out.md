# Sign-out

Server side: backend guide "Sessions" (`GET /api/auth/clear-cache`, the only answer with `Clear-Site-Data: "cache"`).

- `logout` ends the session on the device before it awaits anything: one synchronous step patches the account and its data away (`signingOut`, earlier loads discarded) and sets `pendingLogout` (memory and localStorage). Never put an await before that patch.
- Then `api.logout()` goes out in the background and `forgetAccount` cleans the device (device flags, snapshot, photo cache, similar looks; `lastUser` last, so a start that finds the flag with a `lastUser` finishes the clean-up first).
- The request is one shared promise (`endServerSession`; success drops the flag and the CSRF token, a failure the token). Every load, the health poll and the next start await or resend it; no load reads `/me` or a listing before it answered (the cookie still names the account).
- The health poll asks nothing while the page is hidden; `resume` sends a pending sign-out at once.
- Cache clearing: once the server ended the session (logout success, a dead session found at a load, deletion's 204), `clearHttpCache` sends `api.clearBrowserCache` (never throws). The browser may hold the answer for 20 s and more: never await it, never make it part of `endServerSession`, a toast, `signingIn` or a load, never retry it. An offline or failed sign-out sends it with the retried logout.
- Toasts: `signingOut` until clean-up and logout are over; the signed-out notice only once the server confirmed; `signedOutPending` when it failed (the device stays signed out, poll and next start retry); `signedOutOffline` offline.
- Every sign-in request (`signingIn`: password, setup, magic link, reset) first awaits or sends a pending sign-out, whose late answer would delete the new cookie. No load sends the pending sign-out while a sign-in runs.
- A sign-out whose answer finds a sign-in under way leaves the load to it (`leftToSignIn`); if every such sign-in fails and no load ran since, the last one's `signingIn` loads (else the guest would stay loading for good).
- A load whose resent pending sign-out fails shows the guest through `session(null, …)`, so the signed-out account's listings leave.
- Account deletion keeps its own path.
