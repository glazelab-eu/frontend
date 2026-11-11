# Barcodes and OCR

## Barcodes

- `loadDetector` uses the native `BarcodeDetector` when it reads EAN-13/UPC-A/EAN-8, else `lib/barcodes/barcode-fallback.ts` (pinned ponyfill + `zxing-wasm`): wasm from our origin, never a CDN; out of the precache (`globIgnores`), `CacheFirst` after first use.
- The camera runs only while the page is visible and `BarcodeScanner` mounted: `createCameraSession` (`lib/barcodes/camera-session.ts`) is the one owner of the stream and the only caller of `openCamera` (`getUserMedia`).
  - A hidden page (`visibilitychange`), `pagehide`, `freeze`, a route change (`hashchange`: Explore, Stock and the account menu keep the scanner mounted) and `CAMERA_IDLE_MS` (2 min) without a code stop every track and show the paused state; never re-acquire the camera without the person's "Resume camera".
  - While a host holds a code (`holding`: the shelf scan sheet while the person types) the idle limit does not run; it starts in full on release (`CameraSession.hold`).
  - A handed-over code, an error, close and unmount stop it without a pause; an account change closes the hosts' scanners.
- Every camera failure has a translated message, and typing the code always works.
- `app.findBarcode` asks `GET /api/barcodes/{barcode}` online, else the loaded listing.

## QR link scan (`scanning/ScanLinkButton`)

- It reuses `BarcodeScanner` with `mode="qr"` (`qrFormats`; no typed field; `links.scanner.*` texts). `pickQr(codes, valid)`: the first code the host's `valid` accepts wins, so a refused code never hides a valid one.
- `keepOpen` + `holding`: a refused code shows its note and the camera goes on; `LinkScanner`'s `noteKey` re-creates the note so the same text is announced again.
- The preview keeps the 4:3 frame (the compact strip would cut a square code off).
- The decoded text is untrusted. `scannedLink` (`lib/scan/scanned-link.ts`) accepts only this app's own origin (pathname ignored), no search or credentials, `#/buddy/<token>` or `#/invite/<token>` with an `isLinkToken` token and a kind the host allows; anything else is refused and nothing opens.
- An accepted link closes the scanner (camera off) and goes through `app.navigate`, so the token-route rules apply ("Routing and history").
- Specs `link-scan*.spec.ts`: one file per camera setup (`launchOptions` are file-level). Every test that opens the scanner writes the fake video just before (parallel tests share the file), with `qrVideo`/`qrVideoOf` from `support/barcodes.ts`.

## OCR (`scanning/LabelScanner` in `GlazeForm`)

- Input: local JPEG/PNG/WebP, ≤ 12 MB and ≤ 24 MP; Tesseract.js 7.
- The confirmation only fills the draft. Never persist or upload photos or raw text. Abort and revoke on replacement, close/unmount and account change (`GlazeForm.accountId` also clears the prior draft).
- `lib/ocr/worker.ts` owns the Worker before initialization (pinned v7 protocol, deadline): upgrade adapter and tests together.
- The OCR assets (`scripts/ocr-assets.ts`) and the lazy `label-reader` chunk stay out of the precache (runtime cache `label-ocr`).
- Never promise full-name recognition or fill uncertain names (the measured OCR accuracy on real labels does not allow it).
