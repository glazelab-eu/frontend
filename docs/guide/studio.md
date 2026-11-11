# Studio

## Draft, variation, edit

- `?from=<id>` copies steps (fresh keys), tags, description and a localized variation suffix and sends `basedOnId`; not for an unavailable source, never in edit mode. `lib/studio/studio-draft.ts` builds the copy after loading settles. `?glaze=` prefills one glaze step.
- Initialize the draft once per account: a later load never overwrites an initialized draft; clear it on an account change.
- Edit mode `#/studio/<id>` (author only): content fingerprint for the guard, PUT to the same ID.
  - Online, the form takes its draft only once the sync is `idle` (never from the snapshot while the start refresh runs); offline it opens from the snapshot.
  - The save sends `baseTags` (the tags the form opened with; kept in the recovery record) so only the form's own tag changes apply (backend "Steps"). `stepsLocked` disables every step control with the variation reason; title, notes and tags stay editable. Another account or an unknown target is not found.
- Deleting drops combination, favourite and images from snapshot and cache.
- Drafts stay in `AppState.combinations` (in the snapshot; removed by the account clean-up); other people never see them. They show in Mine, in Studio's draft list and, labelled, among the variations on their source's page (`combinations/CombinationLineage`).
- Save draft and Publish are for a new combination or an own draft; edits of a published one only save. Save draft leaves empty steps out and reports a started step without glaze or label at its field.
- Offline the save buttons hold the request (`studio/HeldSaveNote`; "Offline, caches and status").

## Steps

- Steps start empty (`initialSteps()`); the empty-state panel (`#studio-steps-empty`) holds the one set of add buttons until the first step. The first glaze step starts with two coats, later ones with one (`addedGlazeStep`).
- Any step makes the form started (`stepsStarted`: sticky bar, hidden bottom navigation); removing the last returns to the untouched form. Focus: the first step takes it (the pressed button leaves); after removing the last, the add-glaze-step button.
- Every step can be removed. The server allows a draft without steps and refuses publishing or saving a published combination without one: say `errors.combinationStepRequired` in the panel before sending (also offline, where nothing is held).
- A new combination's Save draft needs `draftWorthSaving` (`lib/studio/save-draft.ts`; blank steps alone do not count). Without it the button is `aria-disabled` (focusable, described by `saveDraftReason`; `disabled` only while saving), and the leave guard does not ask.

## Final firing (`studio/FinalFiringSection`, `lib/firing/firing.ts`)

- Optional fields after the steps; earlier or extra firings are custom steps. The date shares the photo date range (`EARLIEST_FIRED_ON`/`LATEST_FIRED_ON`, the API's 1900..2100).
- Folded on phones, but never over an invalid field: an input event on an invalid field opens it for good (`firingSectionOpen`).
- `studioInput` builds every save request (held saves included) with all six fields, trimmed, blank as explicit null. Never `undefined`: it drops the key, and the API keeps a missing field. `studioDraft` copies the fields for an edit and a variation; `studioFingerprint` compares them.
- Snapshots without the fields read them as null. Clay-body suggestions come from the loaded listing (`clayBodySuggestions`).
- The card line is `firingLine`; the combination page's labels are their own keys (`firing.detail.*`).
- The card's add-photo actions are for lists only: the combination page (`detail`) has its own.

## Photos while recording (`state/studio/studio-photos.svelte.ts`)

- The upload dialog's parts (`UploadPicker`, `UploadFileList`, `UploadVisibilityField`) and session; kinds from `kindsFor({ type: 'combination' })`, so a new kind appears by itself; the focus comes with `UploadFileList` (upload "Focus").
- Photos live in memory only: the recovery record keeps their count (`photos`), never a file, name or URL; a restore says they were not kept.
- Attached photos are unsaved input (leave guard, sticky bar); a HEIC conversion holds the save.
- Save draft and Publish both take the photos: the draft (`saveCombination(…, draft, { open: false })`) or combination first, then the photos, with the same progress and failure handling.
- A draft's photos are the author's only until publication, which applies each chosen visibility (backend "Photos"); the draft list counts them.
- Offline, photos are never held: the save buttons are disabled with `studio.photos.offline`; removing the photos brings the held save back.
- Save first (`open: false` answers the ID), then the photos one at a time to it; when all are stored the form opens the combination (`app.navigate`, replace).
- A failed photo never undoes the save: the fields lock, the failed photos keep Retry, "Try again" sends every unsent one, Done drops them and opens the combination.
- Leaving while the save or uploads are out lets the photo in flight finish and drops the rest (`studio.leave.photosBody`; after an unmount the error toast `studio.photos.dropped`). An account change drops every photo at once (`reset`).

## Waiting for photos (`studio/WaitingList`, `lib/studio/waiting.ts`)

- Rule (Studio and Explore's `quick=waiting` alike): every shared glaze without a visible result photo (`isWaitingGlaze`; packaging is not a result photo) plus the account's own published combinations without one (`isWaiting`); never drafts.
- Studio shows it on a new combination only (not editing, not a variation): the newest `WAITING_LIMIT` (5), the total and a link to `quick=waiting`. Empty while offline (an upload needs the connection); hidden when empty.
- On phones it and the drafts list are closed `studio/FoldPanel` disclosures (`h2` with the toggle button, `aria-expanded`, `aria-controls` only while open; `lib/studio/phone-fold.ts`), so the form stays within the first screen.
- A row opens the upload dialog (`app.openUpload`, Test tile preselected) and leaves once the picture is patched in. Focus then goes to the next row, else the title field (the toggle if folded meanwhile): the row passes a `returnFocus` callback (`focusAfterRow`) that the upload dialog runs as its `fallbackFocus` after closing. Do not move focus from an effect on the removed row: it runs while focus is still inside the dialog.

## Phones

- A finished step (glaze chosen, or a label) folds into its summary; an unfinished step never folds (native validation must reach its field). Wider screens never fold.
- Adding a step folds the finished ones and focuses the new step's first field; removing a step next to a folded one focuses that header.
- Form order: title, steps, notes/tags, firing. Add-step controls stay at the end of the recipe; only save actions occupy `studio-form__bar` (sticky while the draft has input; "App shell on phones").
- `studio-form--sticky-bar` sets `scroll-padding-bottom: var(--sticky-bar-clearance)` on the root through StudioPage's one narrow `:global(:root:has(...))` rule, keeping a focused field clear of the bar. No inline style from JS.

## Local recovery (`state/studio/recovery.svelte.ts`, `lib/studio/recovery.ts`)

- Raw fields under `<account>/studio/<routeHref>` in the existing `glazelab-offline` snapshots store: no new database, store, cookie or localStorage key (covered by the device-data terms).
- A recovery is kept only for what the leave guard asks about (`keepable`: blank steps alone are not).
- Typing writes it after a pause (`RECOVERY_DELAY_MS`); a hidden or left page and unmounting write at once, a signed-out account never. `clear` drops the waiting write and removes only the revision in storage.
- Read before writing; offer restore/discard and never replace the form unasked. Restore allocates fresh step keys and never restores a held save.
- An edit's recovery keeps `baseTitle` (the title the form opened with): a recovered title equal to it keeps the stored one, so a rename from the combination page is not undone by restoring an untouched title.
- Another tab or device with the edit form open still sends its old title with its next save: title PATCH and PUT are last write wins (backend "Steps").
- Successful saves, explicitly discarded navigation and returning to a clean form remove only the matching recovery revision, so an older tab cannot erase newer work. Sign-out and account deletion use the serialized account-range deletion.
- A storage failure leaves saving usable and shows a local notice.
