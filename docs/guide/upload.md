# Upload dialog

`images/UploadDialog`, opened app-level by `app.openUpload(target)`.

- `UploadTarget.kind` is the starting kind when the target allows it, else Test tile; Packaging only for a glaze, Work in progress only for a combination (`kindsFor` over `kindsOn`). Only the combination page's add-finished-piece button passes Finished piece.
- Each file has its own kind, caption and firing date; visibility, club and the size limit are the batch's. The camera input (`capture="environment"`) shows on phones only.
- The dialog registers a leave guard while any photo is not yet stored (chosen, waiting, in flight or failed).
- Revoke preview object URLs on removal, after the file went in and on unmount.
- Its parts are shared with Studio's photos ("Studio"): `UploadPicker` (inputs, limits, refusals), `UploadFileList` (rows with kind, caption, date, Retry), `UploadVisibilityField`; the one progress line is `uploadProgress`.

## HEIC/HEIF (`lib/images/heic.ts`)

- Converted on the device: the API has no HEIC decoder and gets none.
- `looksHeic` goes by type OR extension, any case (an iOS file may have an empty type).
- `convertHeic(file, maxBytes)` never throws and never answers with the original (JPEG at falling quality until it fits; scaled down only above 4096 × 4096 px, older iOS Safari's canvas area; the API keeps at most 1600 px).
- A failed conversion can never upload the raw HEIC: `addFiles` queues it as `converting` (not sendable; one conversion at a time); a failure removes the row and names it in `rejected` (`upload.reason.heic`; `tooLarge` for a JPEG over the limit). `rejectionOf` lets a HEIC up to `MAX_HEIC_BYTES` pass; `MAX_UPLOAD_BYTES` applies to the JPEG.
- `app.uploadImage` maps the API's `Unsupported image` for a HEIC-looking file to the same message (`uploadFailureMessage`).
- The inputs keep `accept="image/*"`: an explicit `image/heic` makes iOS hand over HEIC originals instead of converting library picks to JPEG.

## Focus (`images/PhotoFocusDialog`, `lib/images/photo-focus.ts`)

- Optional per photo in `UploadFileList` (upload dialog and Studio); the photo is always sent whole and the item keeps only `focus` (`{x, y}` or null, `focused`), sent as `focusX`/`focusY` (backend "Photos"). Set and reset only while the photo is chosen or failed (`canFocus`).
- The value is CSS `object-position` in percent: the frame at X % of its travel shows what a cover at `X% Y%` shows, and that point of the photo stays visible at every cover aspect (`frameAt`/`frameFocus`). Never store the frame's centre instead.
- The frame is the largest `PHOTO_FOCUS_ASPECT` (3:2, the card cover at 390 px and in the three-column grid) window: it moves, never zooms, and stays inside the photo. `CropStage` `variant="focus"` paints the whole photo (`fitRect`) with the frame (`paintFocus`); arrows move the frame a step, one pointer drags it, + / - and pinch do nothing.
- The list's preview uses `coverPosition` like a cover; the row says `upload.focus.set` and offers Reset.
- The photo menu's Set focus opens the same dialog on the stored full size (`pictureBlob`), online only, form `image-focus`, `app.changeImageFocus` (the kind change's lifecycle and rights, `canDelete`).
- No automatic object detection: the start is the centre (the on-device model could pre-fill it later).

## Queue

- Pure queue `lib/images/upload-queue.ts` (`MAX_UPLOAD_BYTES` = the API's `ImageEncoder.MAX_BYTES`, `MAX_UPLOAD_FILES`); rejected files are named, never queued, never requested.
- `state/images/upload-session.svelte.ts` runs one request at a time: a failed file keeps its message and Retry while the others go on; a stopping failure (offline, 401, 428, 429) or Stop leaves the rest unsent; the file in flight always finishes (no abort: it may already be stored); nothing is reported after `dispose`.
- `app.uploadImage(input)` patches the returned `ImageView` (`withNewImage`) without a listing reload. The dialog closes itself when every file is done; `closeUpload(added)` gives the one notice `notices.photosAdded`.
- Focus returns to the opener if it still exists, else to its `returnFocus` (`app.returnUploadFocus`, kept past `closeUpload` because the dialog reads it as it unmounts), else to `<main>`.

## Visibility

- Choices come from `lib/images/photo-audience.ts` (`uploadAudience` here, `photoAudience` in the photo menu).
- On a draft the chosen visibility takes effect at publication; until then only the author sees the photo (backend "Photos").
- On someone else's combination (`authorId`; a borrowed glaze-page photo carries it in `Picture.combination`): only Everyone and the clubs whose loaded member list holds the author, never Only me, with `images.visibility.authorRule` as the select's description. The API refuses the rest (`errors.photoAuthorMustSee`).
- The last visibility is `AppState.uploadVisibility` (memory only; reset by an account change and sign-out). `startVisibility` uses it where offered; a remembered Club without a club falls back to Only me, never Everyone; where Only me is not offered, the narrowest choice left. The fallback never overwrites the remembered choice.
