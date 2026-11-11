# Photo suggestions and similar looks

## Photo suggestions

`lib/vision/`, `state/vision/photo-suggestions.ts`, `vision/PhotoSuggestions*`, `account/PhotoSuggestionsSection`.

- OPTIONAL and OFF until the person says yes, per device: no model request, no worker, no cache entry before the explicit turn-on (`PhotoSuggestionsConsent`: what it does, the size, on this device only, whether the phone is fast enough).
- The choice is `glazelab:photo-suggestions` (`on`/`off`). Declining and turning off both store `off`; only an absent key makes the upload dialog ask. The account section's disclosure downloads nothing and changes no preference; all consent information precedes the turn-on button.
- Only finished-piece photos are analysed (at most `MAX_ANALYSED`, 3, per dialog), in the upload dialog; never test tiles, work in progress or packaging.
- Offline and undecided shows nothing. A metered connection (`isMetered`) asks again before the download. After the download one timed inference (`SLOW_MS`) offers a slow device to turn off and remove the model.
- Chips are buttons: nothing is ever added by itself. The tag (`tagFor`) passes through `normalizeTag`/`tagProblem`.
- Model files: `models/vision/labels.json` (committed) and `model.onnx` (NOT in git), both from `scripts/vision-model.py` (thresholds per model, calibrated by hand); `onnxruntime-web` is pinned exactly. `scripts/vision-assets.ts` emits them under `assets/vision-<hash>/`, NEVER in the precache (`globIgnores`); the model is served from our origin, never a CDN.
- The model is pinned by size and SHA-256 (`MODEL` in `scripts/vision-model-file.ts`); the directory hash takes the pin, not the bytes.
- A build uses `models/vision/model.onnx` (git-ignored, also the cache) when it matches the pin, else downloads it from `GLAZELAB_VISION_MODEL_URL` (Docker build argument) into place after the check; any mismatch, a missing file without a URL or a failed download stops the build. A mismatching file is never replaced.
- The dev server obtains the model only when it is requested (503 on failure). Vitest never needs it.
- `vision-model.py` with the pip versions in its header makes the pinned bytes from the pinned onnx-community export: the fallback when no copy is published. A changed model changes the pin in the same commit.
- `GLAZELAB_VISION_MODEL=stand-in` (e2e and development without the model) emits zeros of the pinned size under a directory of its own; never for a deployed build.
- The page downloads them itself (`lib/vision/assets.ts`: `cache: 'no-store'`, cached only after the size matched the build's record) into Cache Storage `vision-model`, so `removeAssets` is one `caches.delete`.
- The worker (`vision-worker.ts`) gets wasm and model bytes from the page and never touches the network. The client (`client.ts`) runs one image at a time; every failure is an outcome (`offline`/`unavailable`), never an exception.
- Memory: the worker detaches the model and runtime buffers after `InferenceSession.create`; the client terminates an idle worker (`idleMs`; never while an `embed` is queued or running) and `embed` restarts it from Cache Storage.
- Photos are decoded one at a time (`decode` in `state/vision/photo-suggestions.ts`), so several "Find similar" presses never hold several full-size bitmaps.
- Only `dispose()` ends the model for good: no restart after it, also not for one still loading (`epoch`). `PhotoSuggestions` is the only owner of the one shared client; similar looks embed through it behind their own consent.
- A label without `tags` in `labels.json` only absorbs probability.
- CSP: never add `blob:` or `unsafe-eval` for it (`'wasm-unsafe-eval'` and `worker-src 'self'` suffice).
- A changed model needs: `scripts/vision-model.py`, its calibrated thresholds, the pin, README (source, licence, SHA-256, size), `scripts/vision-NOTICE.txt`.
- e2e never downloads the real model except in `@vision-real`: `support/vision.ts` builds a stand-in padded to the built files' sizes. A run built with `GLAZELAB_VISION_MODEL=stand-in` needs no model and skips `@vision-real` (`STAND_IN_BUILD`).

## Similar looks

`lib/vision/embeddings|embedding-store|indexing|library|similar.ts`, `state/vision/similar-looks.ts` + `similar-context.ts`, `vision/Similar*`, `UploadSimilar`, `account/SimilarLooksSection`.

- A SECOND consent (`SimilarConsent`): nothing is read, requested, embedded or stored before the person starts the indexing. Nothing is offered while the model is off, for a guest or after a decline, and it never nags: only the account section and the explicit buttons in the viewer and upload dialog still ask.
- Embedding goes through `PhotoSuggestions.embed`/`modelInfo`, one image at a time in call order.
- Vectors live in IndexedDB `glazelab-embeddings` (an own database, so older tabs never meet a version change of `glazelab-offline`), keys `<account>/meta` and `<account>/p/<image ID>`. `embedding-store.ts` serialises every operation and creates the database only on a write, so a device that never agreed leaves no trace.
- `clearEmbeddingsOf(account)` runs in `clearPrivateCache` (sign-out, deletion, another account); `clearAll` when the model is turned off (`disable()`): the choice goes with the copy.
- Covered by the terms' existing IndexedDB sentence: no new localStorage key, no terms change (`cookies.spec.ts` lists the database).
- `createSimilarLooks` (wired once in `App.svelte`) indexes only `libraryPhotos` (`LOOK_KINDS`: test tiles, finished pieces and work in progress the viewer can see, never packaging), drops vectors of photos the SETTLED listings no longer show (`pruneStale`, never while a load runs), forgets another account's at once and starts over under another model ID or vector length.
- Background indexing (`lib/vision/indexing.ts`, pure) waits while offline, hidden, on low battery and not charging, or metered without agreement (agreement lasts the session); one photo at a time after `requestIdleCallback` and a pause.
  - Indexing starts only once a load of the account settled: the snapshot may still name removed photos.
  - A failed fetch is never given up and the next request always waits: `offline` (no request) `OFFLINE_RETRY_MS`; `unreachable` (shown as offline) and `unavailable` (429, 5xx with a message) double the wait per failure in a row up to `MAX_RETRY_MS`, at least a 429's `Retry-After`.
  - A 401 (`signed-out`) stops the run and keeps the saved copies; the next settled load starts it again.
  - Gone (other 4xx, copies dropped) and undecodable photos are given up for the session and never asked for again; `GONE_IN_A_ROW` gone in a row stop the run until the next settled load (the tarpit counts 404s).
  - `ready`: every photo indexed or given up as gone or undecodable; a failed fetch never counts.
  - Resumable: every vector is stored as it is made. Stopping and declining store `off` and keep the vectors; only the remove action deletes them.
- Results (`rankSimilar`): nearest photos of THE SAME KIND (kind from the listings; work in progress is a group of its own, never compared with tiles or finished pieces; `SimilarLooks` shows one heading per kind), each item once, never the item itself, at most `RESULT_LIMIT` (6). Present them as looking similar with the colour-after-firing caveat; never name a glaze as the answer.
- Surfaces: `SimilarLooks` on glaze and combination pages; a disclosure in `PhotoViewer` (results beside the photo, never over it; links through `openPage`; the controller arrives by Svelte context, `similar-context.ts`); `UploadSimilar` (results open in a new tab so the unsaved photos stay); the account section.
- Tests: `e2e/specs/similar-looks.spec.ts` seeds PRIVATE photos (`support/similar.ts`) because the suite's public library is shared: read totals from the page, never assume them.
- A wait for the first vector there includes the model's start in the worker: give it `INDEXING_MS` (`firstVector`), never the default poll.
