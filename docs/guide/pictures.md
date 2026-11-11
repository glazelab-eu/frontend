# Pictures

## Order (`lib/images/pictures.ts`)

- `orderByFiring`: dated photos first, latest `firedOn` first; undated and equal dates keep upload order. A glaze's own photos come before the combination photos it borrows.
- A combination's photos: `orderPhotos` sorts that order stably by the ONE kind list `PHOTO_KIND_ORDER` (Finished piece, Test tile, In progress, Packaging; a kind not in it last); `combinationPictures` is the one list for its covers, thumbnails, gallery, viewers and lineage chips (a kind or date edit moves the cover).
- A glaze's cover = first test tile of that order, else first finished piece, else first work in progress; thumbnails: finished first, then tiles, then work in progress.
- Kind labels and alt texts come only from `imageKindKey`/`pictureDescription` (`lib/images/pictures.ts`); a kind this version does not know reads as a finished piece and stays out of galleries, so an older client never breaks on a new kind.
- `IN_PROGRESS` is no result photo (`hasResultPhoto`, Explore's photo filters) and never lends a glaze a finished piece.
- A glaze uses its own pictures, then finished pieces of its combinations, never their tiles.
- `PACKAGING` appears only in `glazeGallery`, after the result photos; never offered for a combination photo.

## Detail gallery stage

- `PictureCover size="full"` in `PictureCarousel`: the whole photo, never cropped (`ImageView variant="stage"`), on the sage tint (on purpose). Height caps: `min(30svh, 16rem)` on phones, `min(72vh, 40rem)` from 45em; an empty cover reserves 6rem.
- `stageShape(pictures)` picks one of `picture-cover--landscape|square|portrait` from the tallest photo (height over width above 1.1 is portrait, below 0.9 landscape, else square; unusable dimensions are ignored), the same for every slide, so swiping never moves the page.
- Never an inline `style` (CSP `style-src 'self'`). The stage keeps `width: 100%` (with only the height cap the aspect ratio would narrow the box).
- No kind badge on the stage; covers on cards and lists keep fixed height, crop and badge.
- Every cropped view of a photo (card covers, thumbnails, lineage chips, Similar looks, the upload list's preview) sets `object-position` to `coverPosition(image)` through `ImageView`'s `position` (Svelte `style:`, CSSOM, allowed by the CSP); the stage and the viewer show the whole photo and ignore it (upload "Focus").

## Gallery chrome (`images/PictureCarousel`, `images/PictureStrip`; detail pages only)

- The ONE meta line (`PictureMeta part="line"`) is a pill over the stage (`.picture-carousel__line`): one line with ellipsis, `title` = whole text, a `<p>`, `pointer-events: none` so a click opens the viewer. The caption (`part="caption"`, up to 200 characters) is whole, under the stage, its row only when present.
- Meta parts: a `null` uploader is the deleted account, an `undefined` one (old snapshot) gets no part. Parts are `inline-block`; each `aria-hidden` dot follows a no-break space, so a wrapped line never starts with a dot (hence the `prettier-ignore`).
- Thumbnails (two or more photos): 53 px fixed-square buttons with the card copy, named `images.thumbnail` (the image alt is empty); the shown one has `aria-current="true"` and an `::after` border (the button keeps its size). The `n / total` is `aria-hidden`.
- Keyboard: the stage group is one focusable region (`tabindex 0` also for one photo; arrows, Home, End; Enter/Space/click opens the viewer). The thumbnail row is roving (one tab stop). When a refresh removes the focused thumbnail's photo, focus moves to the shown thumbnail, not the page.
- No previous/next buttons. A visually hidden `aria-live` region announces the position.
- The row scrolls sideways; keep the shown thumbnail in view with `scrollTo` on the list only (the page never scrolls).
- A visibility change gives a photo a new ID: the strip is keyed by ID, `changeVisibility` re-shows the same position, and the menu button keeps the focus.

## Photo menu (`images/PictureCarousel`; detail pages only)

- A `ui/ActionMenu` with `overlay` in the stage's upper-left corner. Other menus open above their button (cards clip overflow); `placement="below"` for a button at the top of a card or dialog.
- `photoMenuEntries(image, signedIn, online)` (`lib/images/photo-menu.ts`) decides the entries; a host drops those without a handler. Guests have no menu; offline the entries are disabled (focusable, `aria-disabled`).
  - Edit details (uploader): `PictureDetailsDialog`, form `image-details`, caption and date only. `detailsChange` (`lib/images/photo-details.ts`) sends only fields that differ, blank as explicit null (the API keeps what is absent). The upload dialog takes the same caption and date.
  - Change type (`canDelete`: the API's deletion rule also gates `PUT /api/images/{id}/kind`): `PictureKindDialog`, form `image-kind`, `app.changeImageKind`; offers `kindsOn(glaze)`, no confirm (reversible), Save disabled on the current kind.
  - Set focus (`canDelete`, like the type): `PhotoFocusDialog` on the full size, form `image-focus`, `app.changeImageFocus`; Reset when a focus is set (upload "Focus").
  - Visibility (uploader): `PictureVisibilityDialog`, form `image-visibility`; offers `photoAudience`, plus a club the owner has left as the current choice. Leaving PUBLIC gives the photo a new ID.
  - Delete for everyone: only `ImageView.canDelete` (computed by the API per viewer); `app.openImageRemoval`.
  - Report (signed in, not the uploader): `ReportImageDialog` (reason of at most 500 characters), `app.reportImage`, form `image-report`; a repeated report is a success.
- A viewer whose only entry is Report gets an icon button in the same corner instead of a menu (`aria-disabled` offline).
- A photo already gone (404) counts as done (`ifGone`/`photoGone`): listings reload, `notices.photoAlreadyDeleted`, dialog closes; focus falls back to the card (`lib/images/picture-focus.ts`).
- The carousel holds the dialogs' state, looks the photo up by ID (the dialog closes when it vanishes) and closes them on an account change.
- The menu returns focus to its button before an action runs, so a dialog's focus return and the `data-picture-focus` fallback work.
- Cards, covers and thumbnails never carry a delete or report control. A new photo action is a menu entry with a controller action on the write lifecycle.
