# Error reports

- Backend "Error reports". The choice is the account's `UserView.diagnosticsOptIn`: sign-up sends `diagnosticsOptIn` in the registration body, the account page `PUT /api/account/diagnostics`.
- `readLastUser` reads a snapshot from before the field as off, and only a server answer turns it on, so a stale snapshot never makes the app send.
- The terms section `terms.section.diagnostics` (`TermsView`, heading `id="terms-diagnostics"` for a link to it) states exactly what a report carries and changes with the backend rule, in every language, with a terms version bump (topic "Contract").
- `lib/diagnostics/`:
  - `scrub.ts`: the client's scrubber, the server's being the second line (bearer, secret pairs, emails, queries, fragments, long tokens); `eventKey` merges repeats.
  - `device.ts`: device facts, only enum and number values the API accepts, never the user agent string.
  - `hooks.ts`: `error`, `unhandledrejection` and wrapped `console.error`/`console.warn` that always call the original; installed once, on the first opted-in account; they only feed `capture`.
  - `diagnostics.ts` (`createDiagnostics`): the buffer lives in MEMORY ONLY, never localStorage/IndexedDB/Cache Storage, so the cookie spec's key list and the terms' storage sentence stay unchanged. Limits: 50 distinct events, 20 per 10 minutes, a batch of at most 20 events and 30 KB, two sends at least 30 s apart, a failed send backs off 1, 2, 4 ... 10 minutes. Its own failures are never captured; there is no retry loop.
- The controller feeds it the state (`state/app/diagnostics-wiring.ts`): `enabled` = signed in and `diagnosticsOptIn` (otherwise it clears the buffer and drops every event at once); `canSend` = online, no pending terms, not on a token route (`isTokenRoute`: nothing is collected there either).
- Answers: 409 clears and reads `/me` again; 428 sets `termsRequired` and pauses; 400/413 drop the batch silently; 429 waits `Retry-After`; 401 clears.
- Captured: failed loads that are server errors (`failureOf`). Never: ordinary offline states, 4xx and form errors.
- The switch (`DiagnosticsSection` on the account page; `chooseDiagnostics`, form `diagnostics`) is disabled offline and shows the server's answer. The sign-up checkbox in `AuthDialog` is unchecked, with a link that opens the terms and scrolls to `terms-diagnostics`.
- Vitest and e2e read what is sent from the network (`diagnostics.spec.ts`; it replaces the page-error fixture because it raises rejections on purpose).

## Reader

- `pages/admin/ErrorReportsPage` (`#/admin/error-reports`): `app.loadErrorReportGroups(page, filter)`, `loadErrorReportBuilds`, `loadErrorReportOccurrences(fingerprint, page)`, `deleteErrorReports({fingerprint}|{id})` (forms `error-reports`, `error-report-delete`); pure parts in `lib/admin/error-reports.ts`.
- Outline: one `<li>` per message with an h2 (the message); details open one at a time (h3, per report h4s, `deviceFacts`); delete through a `ModalShell` confirmation.
- Paging asks for `nextReportPage(shown)` (50) and `nextOccurrencePage(shown)` (20). The retention in the page text is `REPORT_RETENTION_DAYS` (same as `glazelab.reports.retention`).
- The page never shows an account (the API returns none).
- After deleting one report the group's counts are adjusted locally (last/first seen and builds stay until the list is read again).
- `error-reports.spec.ts` and the Error reports cases in `a11y.spec.ts` (mocked) cover it.
