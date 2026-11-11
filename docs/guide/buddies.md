# Buddies

- Backend "Buddies". `AppState.buddies` (`BuddiesView`: accepted `buddies`, `incoming`, `outgoing`, `hasLink`) loads in `rest()` of `load` (so the `touched` re-ask covers it; `emptyBuddies()` for guests), is saved in the snapshot (names and IDs, per account, deleted with it; an older snapshot normalises to none) and never holds a token.
- Availability (`AppState.buddyAvailability` = `{glazes: BuddyGlazeView[], asOf}`) is a full fetch beside it in `rest()`, never part of the synced views or the sync point.
  - `availabilityOf` keeps what is shown, with its old time, on any failure but a 401: a convenience must not cost the library.
  - `refreshBuddies` and a changed `reloadBuddies` read it again, so a removed buddy's glazes go at once.
  - `persist` saves only the entries of buddies the saved lists still call accepted (`ofAcceptedBuddies`): a re-read that failed after a removal never keeps that buddy's name on the device.
  - The snapshot compares it by glazes and by the UTC day of `asOf` (`restOf`): the same availability read again today moves only the sync point.
- Matching is the pure `lib/stock/buddy-shelf.ts`: `buddyHolders` keeps only buddies that `AppState.buddies` still calls accepted; `buddyCover`/`groupCover` match them with the missing glaze steps; `markNames`/`summaryNames` fix the wording thresholds (a mark names up to three buddies, then a count with the names in a `<details>`; a sentence lists three names, else two and "N more": a count never stands alone); `askLink` omits a draft's link.
- Buddy marks show only where the shelf marks are (`shelf` defined: signed in with any stock entry, or Explore's active availability scope; never for guests): always on the combination page (`CombinationCard` `buddyShelf`), on Explore's cards only in "I can make now" with "Include buddies" on, never on other list cards. The glaze page lists the holders with one `AskBuddy` each (`title` null: the glaze message, never a link), for a signed-in account only. Offline the pages add the availability date.
- "Include buddies" (`QuickViews` `buddies`) is shared by Available to me and I can make now ("Explore"). `shelfScope` builds the availability set with the selected clubs and buddy IDs, and a separate personal-only set for On my shelf and Used up; personal scope labels never change with these flags.
  - `BuddyMark` identifies a buddy's glaze outside the selected owned scope, and can name a holder beside an empty personal jar without changing its stock state.
  - The cards in I can make now compare against the selected owned sources, including an empty set for buddy-only access.
  - The `readIncludeClubs`/`readIncludeBuddies` flags are removed with account data at sign-out and deletion.
- `buddies/AskBuddy`: `app.shareMessage(text)` shares `{text}` through the system sheet, else copies it, else shows it in a read-only field in a dialog; it works offline. A draft's message has no link.
- Keep private: `ShelfRow` shows the checkbox on personal rows only, never club rows (`app.setKeepPrivate`, `PATCH /api/stock/{id}`, patched in place, online only).
- Waiting requests show in the activity bell ("Activity feed") and as one quiet line of text in the phone account menu (`buddies.requestCount`, a link to the account page): never a dot, badge or colour on the menu button. The line stays offline from the snapshot.

Writes (`state/buddies/buddy-actions.ts`):

- `buddyAction` (`acceptBuddy`, `declineBuddy`, `cancelBuddyRequest`, `removeBuddy`): online only, one per buddy, `reloadOn` 404/409 so a stale page reloads before the refusal shows at form `buddies`. Success refetches `GET /api/buddies`, saves the snapshot and names the buddy in the notice (hence `toastValues` may hold strings).
  - An Accept on a club member's row passes that row's form `buddy-member:<userId>` (the club page shows no `buddies` form); `requestBuddyInClub` uses the same form.
- `createBuddyLink(replace)` (form `buddy-link`): the API always replaces, so Create (`replace` false) reads `GET /api/buddies` first and, when a link was made meanwhile on another device or tab, takes the lists and shows `errors.buddyLinkExists` instead of replacing it unasked.
- The link token is answered once and lives in controller memory (`buddyLink()`), dropped on an account change; after a reload the section only says a link exists.
- `previewBuddyLink`/`requestBuddy` (form `buddy`): a token not of the API's shape (`isLinkToken`: 43 base64url characters) is `errors.buddyLinkInvalid` without a request, so a link pasted with a trailing full stop never shows the form-field message. `previewInvite`/`joinClub` do the same with `errors.inviteInvalid` at form `invite`.
- `refreshBuddies` follows a write that succeeded, so it swallows every failure but a 401: the saved lists stay and the success notice shows.
- `reloadBuddies` (silent, online) refreshes the lists when the account page or a club page mounts: requests arrive from other devices and the sync log does not cover them.

Components:

- `lib/buddies/buddies.ts` holds the pure parts (`buddyRelation`, `orderedBuddies`, `requestOffer`, `requestCount`, `isLinkToken`).
- `buddies/BuddiesSection`: requests to the account first, then buddies, then requests sent; Remove behind `createConfirmation`; row actions disabled offline under `OfflineNote`; after a row's action the focus goes to the "Your buddies" heading. It holds `BuddyLinkPanel` (Replace asks first; Share only where `navigator.share` exists; `QrPanel`; the text link always shown).
- `#/buddy/<token>` is the dialog `buddies/BuddyRequest` over Explore (like `ClubInvite`): the preview's relation decides what it offers (asking back accepts the other's request); a guest gets the sign-in prompt and returns to the same link; an invalid or replaced link shows `errors.buddyLinkInvalid` and Close.
- Club page member rows show `buddies/MemberBuddy`; nothing on the account's own row.
