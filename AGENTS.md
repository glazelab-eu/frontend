# Glazelab frontend guide

A Svelte 5 + TypeScript PWA built with Vite; hash routing, no router library, no SvelteKit. The API is the separate backend repository (contract and checkout layout: `contract.md`). Run `npm run format` after every edit.

`docs/guide/` topic files ("Topics" below) hold the rest: read those whose trigger matches the task before editing.

## Commands

- Node 22+: `npm run dev` (5173, proxies `/api` to 8080); `npm run format | check | test | build` (`build` runs all); browser e2e: `e2e.md`.
- Small commits; changed behaviour gets a test; a changed rule updates its topic file in the same commit.

## Architecture

- A feature: route in `lib/routing/routes.ts` → page → components → controller action → `lib/api/client.ts`. API shapes: `openapi.json`. UI text: the string in `lib/i18n/en.json`, then its key. Tokens: `style.css`. Folder map: `src/README.md`.
- `App.svelte`: layout, route outlet, notices and dialogs only. `pages/<feature>/` own drafts, filters and submission state. `components/<feature>/` (one level deep) take typed data and callback props, never a global controller.
- `components/ui` is the generic library: it imports only `svelte` and its own folder, every visible string is a prop (`boundary.test.ts`, no allow-list). Shared pieces that know the app (`$t`, app terms) live in `components/common`.
- `state/app/app-controller.ts` is the app controller (loading, auth, connectivity, mutations) and exposes a read-only store; feature actions are modules `state/<feature>/*-actions.ts` built as `create<X>(ctx, deps)` with no module-level state; admin operations go to `state/admin/admin-actions.ts`. Its public members are pinned by `state/app/public-interface.test.ts`.
- Controller writes go through `write` (`mutate` answers a boolean, `mutateFor` a value): never repeat that lifecycle in an action.
- `lib/` is grouped by concern and pure where possible; outside tests it never imports `state/`, components or pages. Components and pages never import the API client (`lib/api/client.ts`): requests are controller actions.
- Hash routes only: change routes with `<a href={routeHref(...)}>` or `app.navigate(route, { replace })`, never by setting state. A new route extends `Route`, `parseRoute`, `routeHref` and `routes.test.ts`.
- Offline is read-only and never queues edits (the one exception is Studio's held save). Glaze and combination listings refresh by delta sync and show at once from the device's snapshot.
- Tests sit next to their module (`*.test.ts`; rune modules are `*.svelte.ts` with `*.svelte.test.ts`) and build models with `src/test/fixtures.ts`, never a local copy of a model shape. Production code never imports test modules.

## Code rules

- Svelte 5 only: typed `Props` + `$props()`, `$state`/`$derived`/`$effect` (with cleanup), `onclick` attributes with explicit `preventDefault()`, `Snippet` + `{@render}`; no `export let`, `$:`, `on:`, event modifiers or `<slot>`. Pages read the store as `let appStore = $derived(app.state)` (the prop may change).
- i18n: every visible text, placeholder, ARIA label, notice and known server error goes through `lib/i18n/` (`$t`, ICU). Keys are stable and namespaced by feature, never the English text; the dictionaries (`en`, `de`, `es`, `it`, `pt-PT`) keep identical keys and placeholders (`i18n.test.ts` fails on an unused or undefined key); translate with `docs/i18n-glossary.md`. A changed API error text changes `lib/i18n/server-messages.ts`. Never translate user content.
- State lives with its owner: drafts reset on unmount, survive failed submissions and clear only on success; no global draft cache. Submission flags are local, guard double submits and reset in `finally`. Writes are disabled offline or while busy.
- Async callbacks capture their store/ID and never read a destroyed page's derivations; drop stale async results (`lifetime(account)` of `state/shared/lifetime.ts`), revoke object URLs.
- Pages reset per-account state by watching the primitive `accountId`, never the `user` object.
- Unsaved input registers a leave guard: `app.registerLeaveGuard({ dirty, message })` from an `$effect`.
- A form's failure shows at the form: `mutate(…, notice, form)` and `common/FormError`, never a hand-made alert box and never `AppState.error` inside a dialog.
- One shared piece per job, never a second: `Combobox` (pickers), `ShelfControls` (amount edits), `ui/ModalShell` `title` (dialog headings), `common/ConfirmDialog` (yes/no before a write), `ui/Callout`, `common/OfflineNote`, `ui/Icon` with `.icon-button`, `.button-row`.
- Every page has exactly one h1. An accessible name contains the visible text. Glazes are displayed only via `glazeCode()`.
- One phone breakpoint: `PHONE_QUERY` `(width < 45em)` in `lib/layout/viewport.ts` for JS, the same `@media (width < 45em)` in CSS; wide-layout queries are exclusive too (`width < 68.75em`), never `max-width`. Touch rules depend on the pointer, never the width: one `@media (pointer: coarse)` block at the end of the component's `<style>`.
- CSS: tokens from `style.css` (palette, `--space-*`, `--font-*`, `--radius-*`), no new hardcoded colours or spacing, rem (em for breakpoints), WCAG AA contrast; BEM class names in scoped `<style>` blocks, no element/position selectors, no broad `:global`; layout never depends on whitespace between elements.
- Lines are at most 160 characters. Svelte blocks (`{#if}`, `{#each}`, `{#await}`, `{#key}`) stand on their own lines; Prettier cannot enforce this.
- e2e: selectors by role, label or `t('<key>')` text, never CSS classes; no sleeps; a fresh account per test; the app never gets a test-only hook.

## Hard rules

- Generated code (`openapi.json`, `src/lib/generated/`) is never edited by hand (`contract.md`).
- Never show one account's data to another: an account change or sign-out clears the previous account's stock, memberships, favourites, listings and caches before anything loads.
- Sign-out ends the session on the device before it awaits anything: never put an await before that patch, and nothing waits for the cache-clearing request.
- Unknown routes and unknown or invisible items show the same "not found"; never reveal that a private item exists.
- A 5xx never signs out; a 429 keeps session and data; a 428 shows the blocking terms dialog and never signs out.
- Tokens (verify, reset, login, invite, buddy) are never consumed on load and never stored in snapshots or `history.state`.
- Device storage is a closed list disclosed in the terms (`e2e/specs/cookies.spec.ts`): no `document.cookie`, no sessionStorage, nothing loaded from another origin. A new localStorage key, IndexedDB store, cache or cookie needs the maintainers' agreement and a terms change first.
- Never persist a save request or queue a write for later; storage failures never fail API work.
- Profile pictures are never shown to or requested for a guest, and a picture that answered 404 is not asked for again in the session.
- Never persist or upload OCR photos or raw text; never grant a camera in e2e without the fake capture file.
- Manifest and `theme-color` colours are never typed by hand; they come from `style.css` through `scripts/theme-color.ts`.

## Topics

In `docs/guide/`. Several files on a line: triggers in the same order; quoted names are the titles other files cite.

Structure and shared code:

- `contract.md` ("Contract with the other repository", "Contract"): any API change or regeneration, normalizers, the terms version, error texts, enums.
- `layout.md` ("Layout and finding your way"): where a file, helper or test belongs; the `lib/` folders.
- `controller.md` ("App controller", "Controller modules"): `state/app/`, a new controller module or app-level dialog, `SyncState`, admin actions.
- `state.md`, `forms.md` ("Forms"): `write` options, drafts, leave guards, account-change resets; form and field errors, a form dialog's focus.
- `ui-library.md` ("UI library"): `components/ui`, `components/common`, a new dialog or confirm question, `Callout`, `SectionNav`.
- `i18n.md` ("i18n"): a new language, lazy dictionaries, placeholders, the overflow spec that a new tight screen or longer text joins.
- `css.md` ("CSS"): any styling: wrapping, tokens, contrast, touch targets, button rows, icon buttons.
- `routing.md` ("Routing and history"): a new route or lazy chunk, `routeKey`, `history.state`, token routes, typed paths.
- `app-shell.md`: header, bottom navigation, sticky behaviour, z-index, breakpoints.
- `pwa.md` ("App updates"): service worker (`registerType: 'prompt'`), update notice, precache, manifest colours.
- `e2e.md` ("Browser e2e suite"), `a11y.md` ("Accessibility"): writing or fixing a Playwright spec; the axe test that every new page, route or dialog gets.

Data, session and offline:

- `offline.md` ("Offline, caches and status"): held save, snapshots, allowed device storage, 401/428/429/5xx handling, ended sessions.
- `sync.md` ("Incremental sync", "Instant start"): `lib/sync`, delta refresh, paged first load, snapshot on start.
- `connection.md`: offline icon, error toast, the wait before the offline warning.
- `sign-out.md` ("Sign-out"): `logout`, device clean-up, cache clearing.
- `sign-up.md`, `account.md` ("Account page"): sign-up dialog, guests' pages, operator contact; account page sections, password change, display names.

Features:

- `explore.md` ("Explore"), `explore-performance.md`: filters, quick views, sorting, chips, the link format, `PagedGrid`; anything that changes what Explore or the shelf derives or renders per item.
- `detail-pages.md`, `glazes.md`: glaze and combination page layout, headings, lineage chips, actions, tags; glaze display, add-glaze dialog, glaze corrections.
- `pictures.md` ("Pictures"), `photo-viewer.md`, `upload.md`, `image-cache.md`: photo order, gallery stage and photo menu; fullscreen and card viewer; upload dialog; picture sizes (`pictureSrc`) and the image Blob cache.
- `shelf.md` ("Shelf"), `scanning.md`: stock page, shelf rows, scan-first on phones, amount defaults; barcode detection, label reader (OCR).
- `studio.md` ("Studio"): steps, final firing, drafts, variations, photos while recording, waiting for photos, local recovery.
- `clubs.md` ("Clubs"): clubs list, club page, members, invites, leaving and removing.
- `buddies.md` ("Buddies"): buddy lists, links, requests, availability (what a buddy sees is a terms rule: `contract.md`).
- `activity-feed.md` ("Activity feed"): activity page, bell, poll, request toast.
- `sharing.md`: Share button, QR codes.
- `vision.md` ("Photo suggestions", "Similar looks"): the optional on-device image model.
- `admin.md`: a new admin page, admin routes, server-paged lists, the account list.
- `licensing.md` ("Licences"): a new dependency, wasm or third-party asset, `THIRD-PARTY-LICENSES.txt`, the footer's source and licence links, `REUSE.toml`.
- `avatars.md` ("Profile pictures"), `feedback.md` ("Feedback"), `error-reports.md` ("Error reports"), `bans.md` ("Bans"): that feature and its admin page.
