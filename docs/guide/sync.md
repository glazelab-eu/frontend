# Incremental sync and instant start

## Incremental sync (`lib/sync/sync.ts`)

Contract: topic "Contract", backend "Sync".

- Glaze and combination listings refresh by delta; stock, clubs, member lists and favourites load in full on every load.
- The sync point (`SyncPoint`: cursor, epoch and the server's format exactly as answered, opaque, plus `CLIENT_FORMAT`) is stored beside the shown listings and sent to `GET /api/sync`.
- `applyDelta` (pure) upserts by ID, removes tombstones, keeps unchanged objects (so lists do not rebuild) and copies a glaze's manufacturer and name into its steps (`withGlazeNames`). It answers `resync` for a `resync` answer, another format or epoch, or listing sizes that differ from `visibleGlazes`/`visibleCombinations`.
- A full load takes the resync answer's cursor before any listing read. Glazes come in one request, combinations in pages of `PAGE_SIZE` (`GET /api/sync/combinations`), each saved with its progress (`saveFirstSyncPage`), so a dropped connection or reload continues after the last saved page (`readFirstSync`). `progressOf(AppState.sync)` feeds `RouteStatus` `progress`.
- Every write that reloads and the `online` event refresh by delta; returning to the foreground does once the last finished load is `RESUME_SYNC_MS` old. A club join/leave, role change or site-admin grant changes the epoch (the server answers `resync`).
- A delta applies to the listings captured as its request left (`listingsOf`), never to the state at its arrival.
- When a write patched the shown data while a load read, or the load resumed saved pages, the load asks again from the point it reached (with stock, clubs and favourites) before showing anything (at most twice): an answer taken before the write would bring a deleted combination or a removed favourite back.
- Never apply a delta to another account's listings: every account change (`patch`) drops the sync point and the memory of the saved snapshot; the load ticket (`ticket.isCurrent`) discards stale loads before anything is applied or saved.

## Instant start

- `loading` means nothing of the account is shown yet.
- The first load shows the snapshot of the account the device last saw (`lastUser`; the guest snapshot for guests; never while a sign-out is pending) before asking the server, ending `loading` in that patch as `refreshing` (`restore(…, true)`); the refresh changes shown objects in place.
- Until the refresh ends, `findItem`/`studioSourceStatus` report an item the snapshot lacks as `loading`, not `missing`.
- A server that names another account clears everything first (`session`) and shows only that account's snapshot; later loads never show the last user's snapshot again.
- Accepted: the snapshot shows before the epoch is checked, so a club left on another device shows its saved content until the resync replaces it (the server refuses its pictures and nothing new arrives).

## Snapshot writes

- Snapshot and sync point (`<owner>/sync`) are written in one transaction; every finished load drops a paged load's pages in the same transaction.
- A delta that changed nothing (listings by identity; stock, clubs, members, favourites as JSON) moves only the point (`persist`), and only while the stored point is still the one this tab saved (`saveSyncPoint` checks in its transaction): another tab may have saved older listings, and moving the point over them would skip changes for good; else it writes the snapshot too.
- `saveCurrent` saves nothing while `loading`.
- Sign-out, account deletion and another account remove the snapshot, its point and any unfinished paged load (`deleteSnapshot` drops `<id>/…`).
- Snapshots without a point or of another `CLIENT_FORMAT` show at once and then load in full. Bump `CLIENT_FORMAT` when the normalisation can only guess at a stored shape.
- Snapshots of sync format 1 hold zone-less combination times: `instantTime` (`lib/api/instant.ts`, used by `listedTime` and `formatServerTime`) reads a zone-less time as UTC, never in the reader's zone, until the format-2 full load replaces them.
- `withImageOwner` never writes a `null` uploader for an old snapshot picture: `null` means a deleted account, `undefined` unknown.
