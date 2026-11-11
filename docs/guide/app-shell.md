# App shell

## Breakpoints

- One phone breakpoint: `PHONE_QUERY` `(width < 45em)` in `lib/layout/viewport.ts` (`isPhone()`, `phoneMedia(onChange)` returning its cleanup) for JS, the same `@media (width < 45em)` in CSS; 720 px itself is the wide layout.
- Wide-layout queries are exclusive too: `(width < 68.75em)` (1100 px), never `max-width`. `AppNav` wraps below `70em`.

## App shell on phones

- `phone` comes from `phoneMedia` in `App.svelte` and is passed to `AppNav`/`HeaderAccount` as a prop, so JS and CSS switch together. A new phone-only element is rendered by `phone`, never by hiding duplicates with CSS.
- The top bar is one row. The bell's count (`layout/FeedBell`) is the app's ONE badge, kept inside the bell's own box so the row never grows; no other dot or badge.
- The four entries move to `layout/BottomNav`, a fixed `<nav aria-label="Main navigation">` rendered last in the shell so it is read and tabbed to after the page. The top bar's own `<nav>` is not rendered on phones: only one landmark.
- Visibility is the pure `bottomNavVisible(phone, section, studioStarted)` in `lib/layout/bottom-nav.ts` (with `navTabs`, the one list of entries and their short labels). Never while `StudioPage` reports `onStarted`: Studio's sticky bar then takes the foot of the screen, and two fixed bars never stack.
  - `onStarted` is true while Studio's form shows (as `studioView` decides) and the draft has input or a save is held. Without the form (an edit gone after a reload shows "not found") the navigation stays.
  - Studio's bar is `position: sticky` only then (`studioBarSticky`), and in the flow while the draft is untouched.
- Clearance: `.app-shell` gets `padding-bottom: var(--bottom-nav-clearance)` (`--bottom-nav-height` + the 1 px top border + `var(--safe-bottom)`, all in rem so it grows with the text size). The bar is never taller than it: labels wrap (even inside a word) and shrink with their column (`cqw`) instead of being cut off, and keep 12 px on touch screens.
  - `index.html` has `viewport-fit=cover`, so `.app-shell` and the bar also pad the left/right insets.
  - `:root:has(.bottom-nav)` sets `scroll-padding-bottom` (disjoint from Studio's `:has(.studio-form--sticky-bar)` rule), and the toast moves above the bar.
- Stacking uses the `--z-*` tokens of `style.css` (sticky bar < bottom nav < popups < header < toast < modal): dialogs, sheets and the scanner (`ModalShell`) always cover the bar.
- Every full-screen layer is a `ModalShell`, whose backdrop lives at the end of `<body>` (`ui/portal.ts` `toBody`), so `--z-modal` counts against the whole page: a sticky column, the header or any other stacking context it opens from never traps it (`e2e/specs/photo-viewer-layer.spec.ts`). Never give a layer its own `position: fixed` inside the page or lift an ancestor's `z-index` instead.
- The language select is one component (`LanguageSelect`): in the top bar on wide screens, in `layout/AccountMenu` for signed-in phones, in the footer for guests on phones.
- `layout/AccountMenu` (signed-in phones) is a disclosure; Escape, an outside press, focus leaving and a hash change close it, and following its link returns focus to the menu button.
  - Its scanner (`LinkScanner` with `kinds` buddy and invite and the neutral `links.scanner.*` texts) is rendered outside the panel: the panel closes with the focus on the menu button and the scanner gives it back there. `onScan` is `app.navigate`, threaded `App` > `AppNav` > `HeaderAccount`. Phones only: wide screens scan from the Buddies section and the Clubs page (`ScanLinkButton`).
  - Its buddy code (`buddies/BuddyCodeDialog`; `App.svelte` builds `BuddyCode` and passes it down) shows the link made in this session, else makes one on open with `createLink(hasLink)`: an earlier link is replaced WITHOUT the question the Account page asks (deliberate). Offline without a link it says it needs a connection (`buddies.code.offline`). e2e: `buddy-code.spec.ts`.
- Sign out has one wrapper, `App.svelte` `signOut` (header, phone menu and account page all call it): it presses the `createSignOutRequest` that `HeaderAccount` consumes, and focus moves to the Sign in button (`lib/layout/sign-out-focus.ts`) instead of falling to the page or staying on the wide header's Sign out (which stays in the page, `inert` and hidden). A session that expires or ends in another tab moves no focus.

## Footer

- The footer (`App.svelte`, inside `<main>`) holds the operator contact, About, Terms, the version, Source code and Licences (`legal/SourceLinks`) for guests and members alike, offline too; About stands before Terms.
- Feedback (members) and Administration (site admins) follow; the guests' language select joins on phones.

## Sticky header

- `layout/AppNav` with `lib/layout/headroom.ts`: `.app-nav` is `position: sticky; top: 0; z-index: var(--z-header)`, always in the flow, so sliding it away moves nothing below it (no layout jump; `PagedGrid` first render and restore untouched).
- From 70em the header only sticks. Under 70em (the CSS media query, the one place) it also slides out (`.app-nav--hidden`; a 0.2 s transition only without `prefers-reduced-motion: reduce`) after `HEADROOM_TRAVEL` (12 px) of scrolling down beyond its own height, and returns after 12 px up.
  - `stepHeadroom` is the pure rule: a run is counted from where it turned (a wobble flips nothing); within its height of the top it is always shown; positions past the page's end count as the end (iOS bounce); print never slides it.
- It never moves while frozen, and focus entering it shows it. Frozen means:
  - an open menu in it (`[aria-expanded="true"]`);
  - keyboard focus inside it (`:focus-visible` only: a tapped menu button keeps focus after the menu closed and must not hold the header);
  - a field with focus (the soft keyboard);
  - any open dialog (the page scrolls behind one).
- `watchHeader` (attached in `AppNav`) keeps `--header-height` on the root. `style.css` derives `--header-offset` (the height; 0 while `:root:has(.app-nav--hidden)` under 70em) and `scroll-padding-top` from the full height, also while it is slid away (it returns on the first scroll up), so a focused field or scrolled-to target is never covered (WCAG 2.4.11).
- A new element that sticks to the top of the window sets `top: calc(var(--header-offset) + gap)` with a `top` transition of the same 0.2 s (today the gallery columns of `CombinationCard` and `GlazeCard`).
  - `watchStickyFit`/`fitsSticky` count the header's height as taken from the window in every width, also while slid away, so the gallery does not flip between sticking and not as the header comes and goes.
- One-tap return to the top: the brand and the highlighted entry (`AppNav`, `BottomNav`) call `scrollTopOnSamePage` when their route has the same `routeKey` as the shown one (the brand on `#/?q=…` also clears the filters); smooth unless reduced motion; plain primary clicks only. Another route starts at the top through `showRoute`; a filter change on the same page does not scroll.
- e2e: `sticky-header.spec.ts`, `update.spec.ts` (notice offset), `combination-actions`/`glaze-page` (gallery offset).
