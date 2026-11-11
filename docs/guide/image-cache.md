# Picture sizes and image cache

- `ImageInfo.url` is full size (≤ 1600 px), `cardUrl` the card copy (≤ 480 px). `pictureSrc` (`lib/images/pictures.ts`) is the one choice: full size only in the detail gallery (`PictureCarousel`, `PictureCover size="full"`), the card everywhere else. Never derive a size from width or height.

## Blob cache (`lib/offline/offline.ts` `imageUrl`)

- Order: this session's download; else the saved copy of that size (Cache Storage, no request); else, unless known offline, a download saved under its URL. Never put the network first: a black-holed request holds the picture for the browser's connect timeout.
- Download answers: a 4xx drops both saved sizes and shows nothing; 429, 5xx and unreachable show the saved other size.
- Only an `image/*` answer is saved, shown or handed to `pictureBlob`'s caller; any other 200 (a decoy, a portal page) counts as a server failure and its body is cancelled.
- A shown copy that fails to decode is dropped (`ImageView`, `Avatar` `onerror` call `dropCachedImages`), so the next attempt downloads it afresh.
- A download gives up after `SAVED_DOWNLOAD_TIMEOUT_MS` (4 s) without headers, only when the other size is saved. Never cut off an unsaved picture or a body still arriving.
- "Offline" = `navigator.onLine === false` or app state `online` false (`networkReachable`).
- A saved read finishing after `forgetLoadedImages` shows nothing (`generation`).
- `pictureBlob(url, userId)` is the one way to read bytes without showing them (similar-looks indexing): never saved, never in the session cache; a refusal (4xx, not 429) drops the saved copies and answers `gone`.
- Session cache: one account, at most 200, least recently used dropped. Each view makes and revokes its own object URL.
- Each size is saved under its own URL (a card never pulls the full size), but dropping and pruning go by picture (`pictureOf`): `dropCachedImages(…, [image.url])` and `pruneImageCache(shownImageUrls)` take both sizes. Offline, a size never saved falls back to the saved other size.
- Old snapshots get `cardUrl = url + '/card'` (`withImageOwner`).
- An entry goes with a visibility change, a permission/removal 4xx, `pruneImageCache` (after every load that changed the listings) and `clearPrivateCache`. A details edit keeps it.
- Cache failures never discard a download.
- `images/ImageView` fetches near the view (`whenNearView`), shows the unavailable text only after a failed load and retries when `networkReachable` turns true. In the 53 px thumbnail the text is an icon with `role="img"`, `aria-label` and `title`.

## Browser HTTP cache

- It keeps every downloaded size beneath the Blob cache (CLUB and PRIVATE pictures are `private, max-age=604800, immutable`: the browser only, never a shared cache), so a picture the viewer lost access to may still answer 200 for up to a week: the listings (`pruneImageCache`) drop it, not the download.
- The clearing after sign-out and deletion (`GET /api/auth/clear-cache`) empties only that HTTP cache: `clearPrivateCache` must still remove the account's copies.
- Never fetch pictures with `cache: 'no-store'`/`'reload'`; never ask the backend for `"storage"` in `Clear-Site-Data`.
- e2e counts requests at the server (`startWebServer({ onApiRequest })`): `page.route` disables the browser's HTTP cache.

## Profile pictures

- Same cache: `imageUrl` takes `/api/avatars/<id>` (256 px) and `/small` (64 px) through `api.avatar`, saved in `glazelab-images-<account>` (cleared with the photos). `pruneImageCache` never touches them; they are dropped by ID on replace/remove (`app.uploadAvatar`/`removeAvatar`), and a 4xx drops both sizes.
- `avatars/Avatar` is the one component (`decorative` = aria-hidden beside a name, else `role="img"` named by `label` or the name). The initial stays until the picture is decoded and on any failure. It retries when `networkReachable` or `avatarIdsConfirmed` turns true.
- Other people's pictures (`offline/avatar-cache.test.ts`):
  1. An ID that answered 404 is never requested again in the session (`goneAvatars`, cleared with the pictures at sign-out and account change): the API's tarpit counts unknown-picture 404s (20 in 5 minutes flag the client for 15 minutes). The first 404 calls `onAvatarGone` → `refreshAvatarIds` (re-reads `author-avatars`, member and buddy lists; at most once per 30 s, never during a load, offline or signed out). Other 4xx answers drop the saved copy and are not remembered; neither are 429, 5xx and unreachable.
  2. A burst (`AVATAR_404_LIMIT`, 6 IDs in 5 minutes) stops all new avatar downloads until the window passes.
  3. A restored snapshot's IDs are unconfirmed (`avatarIdsConfirmed` false until a load's data shows): show saved copies only, never download.
  4. One lazy request per distinct ID, however many views show it.
