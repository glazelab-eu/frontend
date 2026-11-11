# Glazes

- Display only via `glazeCode()`, as `<manufacturer name> <code>`. Short IDs appear only where a manufacturer is chosen or added; search still matches `<shortId>-<code>`. Manufacturers: `manufacturersOf` over `GET /api/glazes`.
- Tags are suggested and filtered in the browser only (`buildTagIndex`, `filterByTags`). Counts use `published()` combinations; only Studio's tag field adds the writer's own drafts.

## Add-glaze dialog

- Hosts (Discover, Stock, Studio) use `createAddGlazeHost` (`state/catalog/add-glaze-host.svelte.ts`: target, `dirty` with leave guard, close on `accountId` change, form-error clearing, shared `props`) and add only their own props and `onAdded`.
- Render `<AddGlazeDialog {...add.props} bind:dirty={add.dirty} />` outside every loading branch: a refresh must never unmount the draft.
- `app.addGlaze` answers `GlazeCreatedView` or null and patches in place (`withNewGlaze`, `withNewImage`); never reload.
- `shelf` prop (shelf section starts on): Stock always, Explore with a barcode, Studio never. `stock` is sent only when complete. Its starting shelf (`owner`): shelf "Safe default".
- Scanned barcode: `GlazeForm.scanned` offers adding it to the duplicate or to similar hints passing `canTakeBarcode` (not yet there, under 10 barcodes), via `app.editBarcodes(id, change, 'glaze')`; a failure shows in the dialog's form error. Then the dialog closes and the glaze opens.

## Scanner first (Discover)

- Add buttons call `startAdd`; `addStart(coarse, camera)` (`lib/barcodes/add-flow.ts`) picks `scanner` (coarse pointer and `getUserMedia`) or `dialog`. The toolbar scan button forces the scanner for signed-in users (`startAdd(event, true)`); guests keep the find-only scanner (`findScanned`), whose notice an account change clears (`scan-notice.spec.ts`).
- `scanner` mounts Stock's `ShelfScanSession` (`title`, `skip` props): known code → sheet, unknown → `openAdd(barcode)`; `existingAction` uses the sheet (`useGlaze`); `closeAdd` calls `addClosed`, so the scanner returns after the dialog (hence no scan-next button).
- Refocus the opener before the dialog replaces the session, so Close returns to the button.
- Session shelf: the `owner` prop, else personal. Never remember it between sessions (a remembered club made the next Explore scan write club stock); `lib/stock/scan-shelf.ts` only removes the legacy key.
- Specs: `add-scan.spec.ts`, `add-scan-denied.spec.ts`. Specs opening the dialog from Explore use `AddGlazeDialog.openFromExplore()` (skips the scanner).

## Glaze corrections

- `glazes/GlazeAbout`: a null name with a time is the deleted-account label; Edit needs sign-in and is disabled offline; History is for everyone.
- `glazes/EditGlazeDialog` edits name, code, notes from the glaze as opened. Never reuse `GlazeForm` (the add form with barcode and OCR pre-fill).
- `glazeCorrection` (`lib/glazes/glaze-edit.ts`) sends only fields the user changed and that differ; blank notes as explicit null; an untouched older code or untrimmed notes stay unsent.
- `codeEditable` (non-admins, while a loaded combination uses the glaze) is a hint only: the server's 403 shows at the code field, and a code locked after the reload reverts to the stored one so the rest can be saved.
- `app.correctGlaze` (form `glaze-edit`, reload on 403/409) patches glaze, step and shelf names (`withCorrectedGlaze`); 404 reloads with `notices.glazeGone`. The page guards an unsaved edit.
- `GlazeHistoryDialog` (`app.glazeHistory`, form `glaze-history`) loads only online and keeps nothing.
