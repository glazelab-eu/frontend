# Feedback

- Backend "Feedback". Signed-in accounts only; guests see no entry.
- Entries, all calling `App.svelte` `openFeedback` (which remembers the opener for the focus): the phone `AccountMenu`, the wide header's `header-account__feedback` icon before the bell, the Account page's Feedback section and the footer's text button.
  - The header icon is `display: none` from 70em to 80em, where the one-row header has no room in de/es/pt-PT (`header-still.spec.ts` fails if it grows).
  - Nothing about feedback is fixed to the screen, so it never covers the page, the shelf's actions, the scan sheet, the viewer or the toasts.
- `feedback/FeedbackDialog` (`ModalShell`, starts at the text) edits a copy of the draft and reports every change (`app.keepFeedbackDraft`).
- The draft (`state/feedback/feedback-actions.ts`: text, chosen photos, the context checkbox) is controller memory per account, never stored on the device (no new storage key: the cookie spec and the terms' storage sentence stay).
  - It is kept when the dialog closes, on a page change, offline (the `OfflineNote` says sending needs a connection) and after a failed send (the error shows at form `feedback`).
  - A successful send (toast `notices.feedbackSent`, dialog closed) and an account change clear it.
- Photos (`lib/feedback/feedback.ts` `photoProblem`, `preparePhoto` over `lib/images/heic.ts`'s decode/encode) are decoded on the device and re-encoded as JPEG of at most 1600 px and 3.5 MB when chosen, so three fit the API's 12 MB multipart limit; one the browser cannot read is refused, never sent as it is. While one is being prepared, Cancel, Escape and the close button wait; a page change closes the dialog anyway and `app.feedbackPhotoDropped` says that photo was not added (`notices.feedbackPhotoDropped`), so none is lost silently.
- The context (`feedbackContext`: the route NAME only, `__APP_VERSION__`, the locale, `deviceClass(phone, coarse pointer)`) is shown in the dialog and left out entirely when unticked.
- Admin page `pages/admin/FeedbackAdminPage` (`#/admin/feedback`): `app.loadFeedback(page, status)` (form `admin-feedback`; Open by default; `nextReportPage`; the answer's `open` count beside the filter). Mark as done / Open again and Delete (a `ConfirmDialog`; form `admin-feedback-change`) each read the list again from page 0.
  - Photos are `<img>` of `/api/admin/feedback/photos/<id>/card` (`no-store`, never through `imageUrl`) that open a `ModalShell viewer` with the full size.
- e2e: `feedback.spec.ts`, the Feedback cases of `a11y.spec.ts`, `overflow.spec.ts` (dialog and page, five languages, 320 and 390 px), `header-still.spec.ts`.
