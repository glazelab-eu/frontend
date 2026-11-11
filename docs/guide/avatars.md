# Profile pictures

- Other people's pictures (backend "Profile pictures") are shown only to a signed-in account, never to a guest: a guest has no `authorAvatars`, the controller never asks, and `CombinationCard` renders no avatar without a `user` (`avatars-shown.spec.ts` checks the card line and the requests).
- Places: club member rows (`ClubPage`, `ClubSettings`), the Buddies section, the buddy request page (`BuddyRequest`), the author line of every `CombinationCard` (the initial for an author without a picture, nothing for a deleted account) and the account's own header control.
- The initial is the first visible character of the name (`lib/layout/account-initial.ts`): never a format, bidi or zero-width character, a mark or a blank filler.
- Author pictures come from `AppState.authorAvatars` (`{userId: avatarId}`, `GET /api/combinations/author-avatars`): a full fetch in `rest()` of every load (a failure other than a 401 keeps the shown map), saved in the snapshot (optional: older snapshots read as none), cleared with the account data, never part of the synced views. Pages pass `$appStore.authorAvatars` to the cards.
- Report: `avatars/AvatarReport` (an `ActionMenu` with one entry, disabled offline, and `ReportImageDialog` with its own `title`/`body`; `app.reportAvatar`, form `avatar-report`). Once per reporter: a repeat is a success; a 404 counts as done, says so and reads the lists again.
  - Offered in member rows, the Buddies rows, the buddy request page and, on the combination page only (`detail`, `onReportAvatar`), at the end of the author line. Cards in lists carry no report control.
  - Never offered for the account's own picture (the host leaves it out; the API answers 400), for a person without a picture, or to a guest.
  - `placement="below"` on the author line and in the dialog: a card clips overflow at its foot and the line sits at its top.
- The crop dialog's stage (`common/CropStage`: drag, pinch, keys, announcements, zoom row), the crop math (`lib/images/crop.ts`), decoding (`crop-source.ts`) and painting (`crop-render.ts`) are shared with the photo focus (`variant="focus"`, upload "Focus"); their rules are in "Account page".
- `ModalShell` resets colour, size, weight and letter spacing, because a dialog may open inside styled text.

## Report queue

- `pages/admin/AvatarReportsPage` (`#/admin/avatar-reports`): `GET /api/admin/avatar-reports?page&status` through `app.loadAvatarReports(page, status)`, the Open filter by default, the photo queue's paging (`nextReportPage`); the admin pages' page-memory rules apply ("Admin pages").
- `lib/admin/avatar-reports.ts` holds the pure rules (`groupReports`, `pictureStateKey`, `statusKey`, `missingPictureKey`, `canRemove`) and groups the flat answer by `avatarId`: one entry per picture, because a decision applies to every open report of the picture.
- The evidence is `<img src="/api/admin/avatar-reports/<report>/picture">` (lazy), never through `imageUrl`: the answer is `no-store`, so no browser, Cache Storage or service worker copy exists. A picture the server no longer keeps shows a text instead; `ownerId` null means it was deleted with the account (its reports are `CLOSED` without a reason or a deciding admin). `CLOSED` with an owner means the reports expired 90 days after their opening (backend "Profile pictures").
- Actions: `app.dismissAvatarReport`; `app.removeReportedAvatar` after a confirmation dialog (the server blocks the picture either way, also when it is already gone); for a dismissed or expired (`CLOSED`) picture that is still shown, `app.removeAvatarAsAdmin` (`DELETE /api/avatars/{id}`). Every decision reads the queue again from page 0 and focuses the list. Errors show at form `avatar-reports`.
- The actions row wraps and is sized for no fixed count; "Ban this user" (site admins, see "Bans") is its last button, for an entry whose `ownerId` is known.
