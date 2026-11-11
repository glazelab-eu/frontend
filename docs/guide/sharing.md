# Sharing and QR codes

## Share button

- `sharing/ShareButton` (for everyone, online or offline; not on drafts) calls `app.share(title, route)`, which shares `canonicalUrl(route, location)`; never `location.href` (it may carry filters, list state or a token route).
- `shareLink(data, navigator)` (`lib/share/share.ts`): `navigator.share` from the click only, a cancel (`AbortError`) is silent; any other failure or no share API copies the link; a missing or refused clipboard answers the link, which the button shows in a selectable field.
- Keep `shareLink` taking the navigator-like object, so tests need no globals.

## QR codes

- `sharing/QrCode` draws inline SVG from the app's own encoder `lib/qr/qr.ts`, on the device: no QR service, library or request, nothing stored or logged.
- Limit: up to 213 UTF-8 bytes (byte mode, level M, versions 1 to 10); beyond it `encodeQr` throws `QrTooLongError` and the component says so.
- The links hold tokens (buddy and club invite links): memory only, never in storage, history or an attribute other than the drawing.
- Modules are `currentColor` (`--ink`) on `--paper` with the 4-module quiet zone in the viewBox, so the code scans in any theme. Size by class only (CSP; 15rem to 20rem wide). `role="img"` named by the `label` prop.
- A consumer ALWAYS shows the same link as text beside the code and puts `sharing/QrPanel` under it, shown at once (no disclosure); the panel loads code and encoder lazily, offers no save for a too-long link and a reload (`reloadApp`) when the code chunk fails to load.
- Save (`lib/qr/qr-png.ts`, loaded on the click): black on white with the quiet zone, whole pixels per module; the share sheet with the file only on a coarse pointer where `navigator.canShare({files})` works, else a download through an object URL revoked after `REVOKE_AFTER_MS`, since WebKit aborts a download whose URL went at once (a cancelled sheet does nothing, another refusal falls back to the download). Nothing stored or requested.
- The file name (`lib/qr/qr-file-name.ts`, separate so consumers do not pull in the encoder) holds a slug of the club name, never the link or token.
- Consumers: `clubs/ClubInvitePanel` and the buddy link. A new consumer adds its own a11y case for the page that holds it.
- Tests: `qr.test.ts` decodes every version with ZXing (`lib/qr/qr-decode.ts`, test-only); `specs/qr-code.spec.ts` renders the component on a harness page (`e2e/support/qr-harness/`) under the production CSP and reads the screenshot and the saved PNG back (`e2e/support/qr-image.ts`).
