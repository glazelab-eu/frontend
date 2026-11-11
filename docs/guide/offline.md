# Offline, caches and status

## Offline is read-only

- Never queue edits. The one exception: Studio holds the single save the writer chose, in memory (`state/studio/held-save.svelte.ts`, pure transitions in `lib/studio/held-save.ts`); never with photos attached.
  - The request is the click-time snapshot; the form stays locked (Cancel to edit).
  - `release` hands it out once, when online, not loading and for the same account.
  - Dropped on cancel, sign-out, account change, leaving the page, unmount. The leave guard counts it as unsaved.
  - Never persist it or resume it after reopening.
- A request already out cannot be called back: `studioLeaveQuestion` asks a variant that promises no discard, and `saveCombination` opens the saved combination only while the route visit that started it (`navigation.visit()`) is current; else `notices.combinationSavedAway` (a failure then goes to the error toast).

## Snapshots and device storage

- Snapshots: IndexedDB `glazelab-offline`/`snapshots`, keys per owner (snapshot, `<owner>/sync`, `<owner>/first…`). Access is serialized, so sign-out cleanup follows pending saves. Read snapshot and sync point together (`readSaved`).
- Normalise older records (missing collections → empty; includes `clubMembers`, `buddies`, `buddyAvailability`). Never migrate localStorage snapshots (incl. legacy `glazebook`). Keep legacy image-cache and device-preference compatibility.
- The complete device storage (disclosed in `terms.section.cookies`; `e2e/specs/cookies.spec.ts` fails on anything else):
  - localStorage: locale, lastUser, pendingLogout, install-declined, `glazelab:photo-suggestions` (the device's choice; no sign-out removes it); per account intro-dismissed, `glazelab:include-buddies:<account ID>`, `glazelab:include-clubs:<account ID>` (`lib/buddies/include.ts`) and the legacy `glazelab:scan-shelf:<account ID>` (only removed, `lib/stock/scan-shelf.ts`);
  - IndexedDB: `glazelab-offline`, `glazelab-embeddings`, Workbox's expiration store;
  - Cache Storage: `glazelab-images-<owner>`, precache, `label-ocr`, `barcode-scanner`, `vision-model`;
  - no cookie of the app's own (never `document.cookie`; the API sets `GLAZELAB_SESSION` and `XSRF-TOKEN`), no sessionStorage, nothing from another origin.
- A new key, store or cookie that is not strictly necessary needs the maintainers' agreement and a terms change (version bump) first.
- Sign-out and account deletion remove the account's per-account flags (`forgetDevicePreferences`); `DiscoverPage` then forgets its in-memory copies. An ended session that keeps unsaved input leaves them.
- Storage failures never fail API work (non-blocking notice).
- `caches` and `crypto.randomUUID` exist only in a secure context: plain-HTTP LAN development has neither, so guard them (`deleteCache` in `lib/offline/offline.ts`, `newRequestId`).
- Await restoration before ending loading; discard stale loads after an account change.
- Tests: controller tests on fake timers drive fake-indexeddb with real `setImmediate` rounds (`settle`); offline-event tests also set `navigator.onLine`.

## Status

- Unknown routes and unknown or invisible items (`findItem` → `missing`) show the same `RouteStatus` "not found": never reveal a private item. After a failed load (`sync.failure`: unreachable or any 5xx, nginx HTML included) a missing snapshot item is `unavailable` with retry.
- A 5xx never signs out. A 429 keeps session, online state and data (the health poll reloads). A 428 shows the blocking `legal/TermsDialog` and never signs out.
- A 2xx that is not the API's JSON (a proxy's or captive portal's page, the tarpit decoy) or lacks the expected outer shape (`lib/api/answers.ts`, checked in `lib/api/client.ts`) is an unreachable failure (status 0): never data, never "signed out", never saved.
- A `/me` answer that is no account never switches the snapshot owner: the load keeps the last account, its snapshot and its photo cache.

## Ended session (401)

- A 401 on any write, `query` or upload of the signed-in account (`sessionLost` in `fail`; not form `auth`, whose 401 is a wrong password) is not shown: `fail` awaits `checkSession`, one shared `load({ tryApi })`. Never a second check, never a raw sign-in error beside the notice.
- Still signed in → the failure shows as usual. A 401 from `/me` ends the session; it is announced only for an account the server confirmed in this run (`confirmed`) or when the check asks.
- Nothing unsaved (`navigation.hasUnsavedWork()`): best-effort `api.logout()`, then `clearHttpCache`, then `resetCsrf()`; the signed-out path clears everything and `authNotice` `sessionEnded` opens the sign-in.
  - It clears the private cache of the account on screen and of `lastUser`: another tab's sign-out may have removed `lastUser` while a load here saved the snapshot again.
- Unsaved work (any registered leave guard): never drop it. Nothing is cleared, no load continues, no logout is sent, and `authNotice` `sessionEndedKept` opens the sign-in in place, also for a remembered account the server never confirmed.
  - Shown once per account (`keptShownFor`): later background loads keep the state quietly; only a write attempt reopens the dialog. The flag resets on an account change and on a load that finds the session alive.
  - Signing in as the same account retries nothing; another account clears everything.
- No pre-emptive block: a later write meeting the dead session repeats this.
- `patch` clears the notice whenever `authOpen` turns false or the account changes; `AuthDialog` shows it as `role="alert"`.
- Not covered: image downloads shown on a page (a 401 drops the cached copy like any permission 4xx; the similar-looks indexing keeps it).

## Other tabs

- Another tab's sign-in, sign-out, password change or link confirmation replaces the CSRF cookie. `lib/api/client.ts` `send` repeats a write the API refuses with `ACCESS_DENIED` (403) once with a fresh token; never a second repeat.
- Writes refused together share one fresh token: only the request that still holds the cached token resets it.
- The repeat sits below every caller (sign-in, sign-out, writes): never add a CSRF retry of their own.
