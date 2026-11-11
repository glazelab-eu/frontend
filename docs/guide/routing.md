# Routing and history

- Hash routes only: `start()` follows `hashchange` into `AppState.route`. Changing and adding routes: `AGENTS.md` "Architecture".
- Outlet: `{#key routeKey(route)}` + `<svelte:boundary>` (`RouteStatus` "crashed").
- `#/terms` and `#/about` are static pages: no request and no state, so they open offline from the precached shell for guests and members.
- `routeKey` ignores what must not remount the page:
  - the discover query (`type`, `q`, `tags`, `glaze`, `quick`, `cone`, `atmosphere`, `sort`; stable order, defaults left out, invalid values dropped; `#/glazes` and `#/combinations` still parse);
  - the shelf's `shelf` (`#/stock?shelf=personal|<clubId>`, `#/stock/<barcode>?shelf=…`), or a chip change would lose the add-form draft. `glaze` and the barcode stay in the key; `StockPage.chipHref` keeps them.
- Explore: typing replaces the history entry (debounced); a committed filter change pushes one.
- Item routes may carry `?photo=<image ID>` (`PictureCarousel` `focusPhoto`, opened once). It is a one-time pointer: `withoutPhotoPointer` drops it from the recorded predecessor and from `canonicalUrl`, so it never reaches `history.state`, back links or shared links.
- `history.state` holds the session marker, the previous safe route, list positions and Explore's reveal of photo-free items (its route only); never token or unknown routes, item metadata or account data. A reload starts a new session.
- Back links use `app.back()` only when the controller recorded an in-app entry this session, else their fixed target.
- A page that links to items has its case in `lib/routing/back-label.ts` (else the item's back link falls back to Explore or Clubs).
- No lazy route chunks. A lazy feature chunk answers a failed import with a reload offer through `reloadApp` ("App updates"): the barcode fallback, the label reader and `QrPanel`'s code chunk (`qr.loadFailed`, `specs/qr-code.spec.ts`); a precached chunk can fail too, when a page of an older build asks for a file the server no longer has. Exceptions: the language chunks use the error toast ("i18n"); the QR save chunk shows `qr.saveFailed` (the link stays beside it).
- Token routes (`#/verify|reset|login|invite|buddy/<token>`; an old `#verify=<token>` maps to the first four, never to `buddy`):
  - never consumed on load; never in a snapshot;
  - after the confirming POST (`confirmAccountLink`, `joinClub`, `requestBuddy`) the controller replaces the route; closing replaces too;
  - `auth/AccountLink` keeps its draft on errors and never sees the token (the host binds it into `onConfirm(input)`).

## Typed paths

- Nginx and the service worker answer every extensionless unknown path with the shell. `src/boot.ts` calls `redirectPathToHash` (`lib/routing/path-to-hash.ts`), which `replaceState`s `/clubs?x` to `/#/clubs?x` when the hash is empty (`start`/`home`/`index` mean home). Keep it the first import of `main.ts`, before anything reads `location.hash`.
- File-like paths and scanner prefixes are 404 at Nginx (`nginx.conf.template`); the e2e `web-server.ts` mirrors that.
