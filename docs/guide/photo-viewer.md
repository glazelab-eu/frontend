# Photo viewer and card viewer

## Photo viewer (`images/PhotoViewer`)

- A `ModalShell` with the `viewer` prop, rendered by `PictureCarousel` (its backdrop moves to the end of `<body>`, out of the sticky gallery column) (dark `--viewer-*` tokens, checked by `contrast.test.ts`). It shows the FULL-size picture (`pictureSrc(image, 'full')`, never the card copy) on `ImageView variant="viewer"`; neighbours (`preloadIndexes`) wait hidden and `aria-hidden` in the same grid cell, so a step shows a decoded photo.
- The gallery controls it: `current` is the gallery's position and every step calls its `show`, so stage, thumbnails and `?photo=` (applied once, never pulled back) stay consistent. The hash is never written.
- `lib/images/viewer.ts` (pure): `stepIndex`/`viewerKeyTarget` WRAP (the stage and thumbnail row clamp); `swipeStep` (48 px and clearly sideways); `outsidePicture` (a click in the letterbox closes: the `<img>` box is bigger than what `contain` draws).
- Keys are a `svelte:window` handler: they work wherever focus is in the viewer (or on nothing), only while it is the top dialog, never for an event from outside it. Escape returns focus to the opener, which `openViewer` first makes the stage (a click does not focus a div in every browser).
- A swipe uses touch events and NEVER `touch-action`: pinch zoom must stay. A second finger or a zoomed page (`visualViewport.scale`) is not a swipe.
- `:root:has(.modal--viewer)` locks page scroll, drops `scrollbar-gutter` (else an uncovered strip) and sets `overscroll-behavior: none` (else an edge swipe navigates back).
- Each step is announced once: the gallery's live region is empty while the viewer is open. One photo has no buttons, count or live region; the count is `aria-hidden`. A list that changes while the viewer is open keeps it on a valid photo (the gallery clamps `current`).
- The info area keeps a minimum height (no resize between photos with and without caption); in phone landscape (`orientation: landscape` and `max-height: 30em`) it is a column at the right, so the photo keeps the full height.
- The photo menu stays on the page, never in the viewer.
- The viewer and the gallery stage show the whole photo (`contain`): a photo's focus applies only to cropped views (Pictures "Detail gallery stage").
- The stage keeps `role="group"` (`role="button"` would make its children presentational). Its screen-reader button is the corner expand control: a real `<button tabindex="-1">` named `images.viewer.open`, pointer events passing through to the stage.
- `ImageView` says `images.unavailableOffline` only while the app is offline, else `images.unavailable`.

## Viewer history (`lib/images/viewer-history.ts`)

- On mount the viewer pushes ONE entry with the page's own URL: `history.state.glazelabViewer` on a copy of the WHOLE state below (navigation marker, `PagedGrid` positions), so a reload or restore finds the page's state. Back closes the viewer.
- Invariant: the entry is only ever the newest, and whoever ends the viewer pops it with `history.back()` while it is current; no dead same-URL entry stays.
  - Close, Escape and the ground go through the `holdViewerEntry` handle, which ends only the entry its own viewer pushed (several cards can each own a `CardViewer`).
  - Every other unmount (emptied list, account change, route change) pops in the component's cleanup.
- `navigation.ts` `go` and `back` run inside `afterViewerPop`: it pops an open viewer first and waits for the popstate (a queued `back()` landing after a new entry would navigate twice).
- `skipStaleViewerEntry` (in `start()` and on `popstate`) steps over a viewer entry nothing shows (reload, restore, Forward).
- Known gap: a hash typed into the address bar while the viewer is open can leave an entry behind.
- Tests: `stubSessionHistory` (`state/app/test-helpers.ts`) has a real asynchronous session history.

## Card viewer (`images/CardViewer`)

- `CombinationCard` and `GlazeRow` mount it on a click only (`{#if viewing}`).
- Openers are `<button>`s (cover and glaze-row thumbnail: `images.cover.open`; "More photos" thumbnails: `images.thumbnail.open`, position over ALL the photos), absolutely positioned SIBLINGS over the picture, never a wrapper or link: the image keeps its alt text, a card keeps one link per title, nothing interactive nests. 44 px or more; focus ring inside the cover with a light inner band.
- Thumbnail buttons are `tabindex="-1"`: the cover is a card's one Tab stop for its photos.
- Slides: `viewerSlides(...)` (`lib/images/pictures.ts`) in the detail gallery's order (Pictures "Order"), computed on the click; the start is found by image ID, never a stored index. The card's `images` list is already per viewer: never fetch more.
- `openHref` adds the link to the item; it navigates through `afterViewerPop` and leaves modifier clicks to the browser.
- The opener takes focus before the viewer mounts (Safari does not focus a clicked button). Focus returns there, or to the card (`pictureFocusFallback`, `data-picture-focus`) when the last photo took the opener with it.
- No viewer: lineage chips (one link), shelf rows, the admin report page.
