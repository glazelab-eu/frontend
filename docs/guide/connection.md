# Connection state and error toast

- Connection state is shown only when it is a problem: nothing while `online`; while offline `HeaderAccount` shows ONE icon button (`.header-account__offline`, `data-offline-icon`, accessible name `header.offline`, `--warning-bg`/`--warning-ink` with a glyph, never colour alone) as the FIRST item of the account area on wide screens and phones alike.
  - It is the only visible indicator: no pill, no offline line in the phone account menu and no banner in the page, so nothing in the page flow moves when the connection changes (`offline.spec.ts` measures the first heading's top on three routes).
  - The area is right-aligned, so an item at its start moves nothing that is there; never move the icon behind the other items.
- Activating it (`onOffline`, threaded `App` > `AppNav` > `HeaderAccount`) opens the offline toast and does nothing else. The toast shows ONLY on that activation, never by itself when the connection drops.
- Offline toast: `lib/offline/offline-toast.ts` `createOfflineToast` (`open` restarts the clock, so there is one toast; `OFFLINE_TOAST_MS` 8 s; `hold`/`release` stop and restart the clock while the pointer or focus is on it). Try again is `app.retry` (disabled while loading); Escape or dismissing returns focus to the icon; it closes when `online` turns true; a fade only without `prefers-reduced-motion: reduce`.
- `.app-shell__toasts` in `App.svelte` is the one fixed toast box, always in the page. Its two `display: contents` live regions (`.app-shell__region`: `role="alert"` for the error toast, `role="status"` for the rest) are always present, so insertions are announced.
  - Stack, top to bottom: error, update notice, generic `notify` toast, new buddy request ("Activity feed"), offline. It sits above the bottom navigation and Studio's sticky bar, under dialogs.
- The inline `OfflineNote`s at forms and dialogs stay: they explain why a control is disabled where the person is.
- Screen readers: the status region carries a visually hidden `header.offline` while offline and `header.backOnline` for `BACK_ONLINE_MS` (5 s) when `online` turns true again; a failure inside the grace window never turns `online` false, so it announces nothing. There is no "Online" text.

Header budget:

- `AppNav` has no `space-between`: the entries (`margin-right: auto`) follow the brand and the account area takes the rest, so anything that changes the account area's width cannot move the entries. Keep it that way for new header items.
- The header stays one row (`header-still.spec.ts`: the height, no overlap and no control moved by the icon, at 720-1920 px in en/de/pt-PT with a 48-letter name, the icon and the bell; the phone top bar at 320-719 px).
  - The account area is `flex: 1 1 0` and never wraps the row, also below 70em; every item is `flex: none` except the name (`flex: 0 1 6rem`, `min-width: 2.5rem`): only the name may narrow, keeping its right edge.
  - The entries' padding is tighter from 70em to 80em; below 24em the wordmark and the gaps give way so the bell fits.
  - A new header item must fit this budget (the tightest case is de/es/pt-PT at 1120-1190 px) or collapse the same way; re-run the spec.
- Own profile picture: from 80em an `Avatar` `sm` before the name link (`.header-account__picture`); below 80em it is `display: none` because it does not fit the budget, and a hidden one is never fetched. The phone account button shows it in place of the letter (`size="fill"`). Neither is a control of its own.

Error toast (`error-toast.spec.ts` measures that the page does not move):

- `AppState.error` (a message key or a known server message, text from `$errorText`; never while `deletingAccount`) renders as `.app-shell__toast--error` in the alert region (danger tokens with a ring and an icon, never colour alone) with Try again (`sync.failure && online`, disabled while loading) and Dismiss (`app.dismissError`).
- It is persistent, never auto-dismissed: it closes on Dismiss or Escape inside it, when a load or the next write clears `error`, or when a newer error replaces the text (`error` is one string, so identical errors never stack).
- It takes no focus when it appears; after Dismiss or a retry removes the button that had focus, focus goes to `main` (`keepFocus`), not the document.
- A 5xx without a message (nginx 502/503/504 HTML) arrives as status 0, so it is an offline error: the toast says the server is unreachable, without Try again, and the offline icon appears. A 429 or a 5xx with the API's message keeps `online` and shows Try again.
- Still in the flow of `main`, on purpose: the install prompt (a one-time interactive invitation after the person's own first save) and the storage warning (`app-shell__notice`: it can last the whole session, and a fixed box that long would cover content). Per-form and dialog errors stay inline (`FormError`, `OfflineNote`).

Waiting before warning (`lib/offline/grace.ts`, the pure `failureVerdict`; the numbers live only there):

- Why: a phone that just started the app, came back from the background or got its `online` event may still have the radio asleep, so the first request fails although the network answers a moment later.
- The controller opens a grace window (`GRACE_MS`) at `start`, on `online` and when the page becomes visible. Inside it an unreachable answer to a `patient` load (those three starts; never `refresh`, `retry` or a write) or to the health poll is retried once, silently, after `RETRY_DELAY_MS` (`loading` stays on, nothing offline shows).
- A second failure, a failure after the window or `navigator.onLine === false` warns at once. A resume while offline or failed reloads at once instead of waiting for the poll.
- The `offline` event records the load version (`offlineAt`): a load begun up to then and still in flight finishes with its data but does not report `online` again (`reachable()`), so the event's offline state is never undone; the poll or the `online` event brings the app back. A later load (a manual retry included) reports `online` even on a device that says it is offline.
- The held-save and read-only rules follow `online` and are untouched. `offline.spec.ts` covers it; a real phone's sleeping radio cannot be tested.
