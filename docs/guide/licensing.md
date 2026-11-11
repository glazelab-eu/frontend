# Licences and the source offer

The app is `AGPL-3.0-or-later` (`LICENSE`, `REUSE.toml`, `LICENSES/`, `README.md` "Licence"); contributions carry a DCO sign-off (`CONTRIBUTING.md`).

- A new runtime dependency must be combinable with the AGPL (no GPL-2.0-only, SSPL, BUSL, non-commercial or research-only licence) and ship a licence text: `scripts/third-party-licenses.ts` fails the build for a bundled package without one unless it is in `COVERED_BY_HAND` with a text in `scripts/notices/`.
- `thirdPartyLicenses()` runs `rollup-plugin-license` (pinned) in the main build and in `worker.plugins` (the vision worker bundles ONNX Runtime) and writes `THIRD-PARTY-LICENSES.txt` at the root of `dist/`; the build fails when it is missing or empty.
  - Software the bundler never sees is added by hand in `handWritten()`: the service worker's Workbox runtime and its `idb`, code compiled into WebAssembly (zxing-cpp, ONNX Runtime's ThirdPartyNotices with Eigen, Tesseract with Leptonica) and the tessdata licence. A new wasm, worker runtime or copied asset of a third party adds its section there.
  - Upstream texts that npm packages do not ship live in `scripts/notices/`, taken from the upstream repository at the pinned version: refresh them when the pinned version changes (onnxruntime-web ships no licence and no notices).
  - The file is a `.txt` outside the precache globs (about 400 kB, not needed offline); the Nginx configs serve it from `location /` as `text/plain` without a charset, so it starts with a UTF-8 byte order mark.
- The OCR and vision asset folders carry their own notices (`ocr-NOTICE.txt` with the tessdata licence as `model-LICENSE.txt` and Leptonica's; `vision-NOTICE.txt`); a changed model or OCR data updates them.
- Footer (`legal/SourceLinks`): "Source code" links `AuthOptions.sourceUrl` (the API's `GLAZELAB_SOURCE_URL`, backend topic "Licences") and "Licences" links the notices, for guests and members, also offline once the options were loaded.
  - The link shows only for an absolute http(s) URL (`lib/legal/source-code.ts`) and hides while it is unset or unknown; keep it outside the terms text (no terms version bump).
- Generated client runtime (`src/lib/generated/client/`, `core/`) is MIT (Hey API) and the fixture photos are CC0: `REUSE.toml` records each third-party file, and a new one gets an entry (fixture sources in `e2e/fixtures/README.md`).
