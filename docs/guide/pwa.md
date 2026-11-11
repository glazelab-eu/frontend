# App updates and installed app

## App updates

`lib/pwa/update.ts`, `layout/UpdateNotice`.

- `vite.config.ts`: `registerType: 'prompt'`, `injectRegister: false`; never set `skipWaiting` (it defeats the prompt). `clientsClaim: true` only lets the first worker control the page that installed it.
- `registerWorker` drives the pinned `workbox-window` directly. Never use `virtual:pwa-register`: its `controlling` listener reloads every tab when one accepts.
- The notice is a toast in `App`'s polite status region: no role of its own, never takes focus, never moves the page (`update.spec.ts`), persistent across route changes until Refresh or Later, never auto-dismissed. It stacks below the error toast and above the generic and offline toasts; on a phone above Studio's sticky bar (`.app-shell__toasts--above-bar`). Later hides it until the next `waiting`. `.update-notice` stays its class (`e2e/firefox/update-lifecycle.mjs` reads it).
- Refresh calls `reloadApp()` (activate the waiting worker, reload once it controls the page). After `RELOAD_FALLBACK_MS` without control the pure `afterSkipWaiting` decides:
  - a worker that started activating gets a plain reload;
  - a worker still `installed` or a refused `postMessage` is recovered: only after a `no-store` fetch of the new worker script succeeds is the registration unregistered and the page reloaded, within `RECOVERY_LIMIT_MS`;
  - a failed fetch (as during a deployment) keeps the old worker and its offline shell;
  - never recover offline (a page without its worker would not load); never delete a cache (a tab with unsaved input still runs from the old precache).
- `navigateFallbackDenylist` (`vite.config.ts`) keeps `/robots.txt`, `/api/` and every path whose last segment has a file extension (the licence notices) out of the navigation fallback: those open as the file, never as the shell's "not found" page (`path-links.spec.ts`). Extensionless paths keep the fallback (routing topic).
- Checks (`registration.update()`): on registration, on becoming visible (at most once a minute), every `CHECK_INTERVAL_MS` while visible; never while `app.state.online` is false; failures are silent.
- Each finished check also inspects `registration.waiting`/`installing` (`found`): `workbox-window` stops reporting after the first update it calls external, so a second newer build would get no notice. A worker still installing is followed to `installed` (`update()` resolves before installation ends). A dismissed notice stays dismissed for the same worker.
- Unsaved work is exactly `app.hasUnsavedWork()` (any dirty leave guard). A new page or dialog whose input must survive a reload registers a guard, nothing else.
  - Refresh then asks in `LeaveDialog` (`update.discard`); discarding calls `app.allowUnload()` (one unload, lapses after 10 s), so `beforeunload` does not ask again.
- Other tabs: each tab's `controlling` event goes through the pure `takeover` decision: the accepting tab's own reload and a first worker's claim are ignored, a tab without unsaved work reloads. A tab with unsaved work is never reloaded unasked (`beforeunload` needs user activation; iOS Safari never shows it): it is `stale` (`update.stale`, no Later) and reloads by itself once `hasUnsavedWork()` turns false. Every path reloads at most once.
- A reload offer for a missing lazy chunk of an older build (`barcodes.scanner.reload`, label reader, `RouteStatus` "reload") calls `reloadApp()`, never `location.reload()` (the old worker would bring the missing chunk back).
- Where Firefox restricts storage ("Block all cookies") registration throws `SecurityError`: no worker, no check, no notice.
- Run `npm run e2e:firefox-update` (system Firefox; options in the script) after changing the update flow, `vite.config.ts`'s PWA options or the Nginx cache headers.

## Version label

- `__APP_VERSION__` (`scripts/build-version.ts`): package version plus `GLAZELAB_BUILD` (Docker build argument), else the short commit, else `sourceHash` over `SOURCES`. Never a hand-kept number and never the build time: a label that changes per run gives every rebuild a new worker and every open app an update notice.
- `versionMeta` writes it into `index.html` (`<meta name="glazelab-version">`, `VERSION_META`); `waitingVersion` reads the waiting build's label for the footer (`app.nextVersion`).

## Installed-app colours

- Manifest `theme_color`, `background_color` and the `theme-color` meta are never typed by hand: `scripts/theme-color.ts` `appColors()` reads `style.css` (`HEADER_TOKEN` = the header's background token `--surface`, `--canvas` for the background); the `themeColor` plugin fills `__THEME_COLOR__`. Change the header's token and `HEADER_TOKEN` together (`lib/pwa/theme-color.test.ts`).
- One `theme-color`, no `media` variants. `apple-mobile-web-app-status-bar-style` stays `default` (`black-translucent` would draw white text over the light header).
- Installed apps cache the manifest: a colour change arrives with the manifest update or a reinstall.
- While the photo viewer is open, `PhotoViewer` (not `ModalShell`, which stays generic) sets the meta to `--viewer-bg` via `setThemeColor` (`lib/pwa/theme-colour.ts`; returns the restore), and `style.css` paints the root (`:root:has(.modal--viewer)`). The QR scanner sheet does not. Spec: `viewer-theme-color.spec.ts`.

## Safe areas

- The app draws edge-to-edge (`viewport-fit=cover`). `style.css` defines `--safe-top/-right/-bottom/-left` ONCE from `env(safe-area-inset-*, 0px)`; rules read these variables, never `env()`.
- A fixed element near an edge uses `max(<its offset>, var(--safe-*))`, so desktop stays pixel-identical. A dialog's `max-height` also subtracts the backdrop's padding.
- A bar that sticks to the bottom of a phone sheet covers the sheet's bottom padding with its ground and pads its controls above `--safe-bottom` (`avatars/AvatarCropDialog`).
- A new element fixed to an edge joins `e2e/specs/safe-area.spec.ts` (it overrides the variables at 390x844 and 844x390, the crop dialog also at 320x568).
