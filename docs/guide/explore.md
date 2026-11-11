# Explore

- One mixed list (`PagedGrid` `explore`) of combination cards and glaze rows: search, tags (counted from the shown items), glaze filter and quick view all live in the link. The logic is pure in `lib/explore/explore.ts` (what depends on the listing alone in `lib/explore/listing.ts`), shelf matching in `lib/stock/shelf.ts`.
- Outside Mine every list, count and glaze rule uses `published()` combinations.
- A bare Explore link opens the default view (no redirect to a quick view).

Quick views and filters:

- `quick`: `favourites`; `shelf` (personal entries only, independent of remembered availability choices); `available` (in-stock glazes from the personal shelf plus explicitly included club/buddy sources); `canMake` (every glaze step available under the same scope, never a combination without glaze steps; `almost=1` also permits one missing glaze); Mine (own, drafts included). Other-type and guest account views are ignored (`quickApplies`).
  - Buddy-only availability can enable I can make now; keep its scope controls reachable when buddies or club entries exist but are not yet included.
  - An unavailable chip's reason describes that chip and never replaces the active view's scope.
- Shelf part (`QuickViews` `choices`, group "Stock", shown once the account has any shelf entry): In stock (default; `shelfGlazeIds`: > 0 g on the account's personal shelf), Used up (an entry, none above 0 g) and Both. `DiscoverFilters.stock` (`stock=used|all`) is parsed and written only with `quick=shelf`: `shelfStockRoute` sets it; `quickRoute`, `almostRoute`, `typeRoute`, `firingRoute` and `glazeCombinationsRoute` drop it with the view.
  - `explore()` builds the all-entries lookup (`shelfEntryIds`) only while the view is in effect and fills `shelfStock`/`shelfChoices`; no per-item scan beyond the existing filter.
  - The labels differ from the type row's "All" on purpose (else the same accessible name twice).
- Availability options `clubs=1|0` and `buddies=1|0` apply only to `available`/`canMake`, survive the transition between these views and the missing-one step, and override the remembered per-account device choices.
  - Both optional sources default off; personal stock is always included and named. The source names and the offline buddy availability date stay visible.
  - Source toggles push history and remember the choice using the existing include-clubs/include-buddies keys.
  - Personal Used up never includes anyone else's stock; a buddy holder is additional information on an empty personal jar.
- Final-firing filters `cone` and `atmosphere` (lower case in the link) keep the combinations whose final firing has exactly that value and leave the glazes out of All; `effectiveType` then treats All as Combinations, so the glaze-only shelf and availability views are hidden and ignored and `firingRoute` drops them.
  - Not for Glazes: parse, `routeHref` and `typeRoute` drop them there.
  - The cone choices are the cones of the published listing in firing order (`conesOf`), plus a cone from the link.
- Type/firing changes announce any incompatible view, firing or order they clear, through `DiscoverPage` `changeView`.
- All resets only the quick view, retaining search and advanced filters; explain that while other conditions remain.
- Clear filters clears the whole route and pending search/picker input, closes the phone sheet and focuses search, preserving remembered availability choices.
- A link that states a number of combinations (the glaze page's "See all", a glaze row's count) is `combinationsOfGlazeRoute` (Combinations type, glaze only, other filters dropped), so the heading count equals the number clicked. The barcode-scan result alone uses `glazeCombinationsRoute` (the current route's filters, All, the glaze card first).

Order and totals:

- Default order is Newest for every type (`listedAt` = `publishedAt || createdAt`). Explicit sorts: Most favourited (public total descending, then newest), A–Z (display code for glazes), Most used (glazes only, no photo priority). Old `sort=photos` links canonicalise to the default.
- A star's answer patches only its own ID into `AppState.favorites` (answers may arrive out of order); the totals read after it apply only from the newest star (`setFavorite`). The full list comes with the next load.
- Public totals come from `GET /api/favorites/counts` with each load and after starring, live separately from private favourites in `AppState.favoriteCounts` and are saved in the existing snapshot (older copies omit them; missing totals sort as zero). A failed totals read retains the last totals without failing the library. They do not change the synced views or the sync format.

Page:

- Page and tab order: search/pickers, Show chips, View chips and scope controls, the list heading row (heading, count, sort, then Add glaze and Record), active-condition summary, results.
- The summary (`activeFilters`, shared by the page and the top of the phone sheet) names type, quick view, search, explicit order and removable advanced selections. It renders only while `narrowed` (type, view, search, tags, glaze or firing): an explicit order alone hides nothing and does not count, though the summary names it beside a filter and Clear filters resets it.
  - Removing a chip (`removeChip`, run from an effect after a tick, because a pushed route arrives with `hashchange`) moves focus to the chip that takes its place, else Clear filters while something still narrows the list, else in the sheet its Close and on the page the phone Filters button or the search field.
  - The phone Filters count includes active type, view, search, stock/missing-one and shared-source choices as well as advanced fields.
  - Clear filters stands at the end of the summary's row (compact, outlined, touch height) and wraps below the text, still at the end, when the text would keep less than 10rem.
- The sort `<select>` lives in the heading row (`collection-heading__sort`), not beside the Show chips; below 720 px its visible word is hidden and its `aria-label` (`discover.sort.label`, always set) is the name. The heading row wraps, the heading takes the free width, and its height must not depend on the count.
- Show and View chips are `ui/ChipRow` (group, label, chips); `FilterChip` keeps `flex: none` and snaps to its start; the rows keep the touch height from `.button`.
  - Wide screens: the chips wrap as flex items of the group (the scroller is `display: contents`). Phones: one line that scrolls sideways (`scroll-snap-type: x proximity`, scroll-padding = the fade width, no scrollbar), the label fixed, a mask fade at each side that holds more chips (`ui/chip-scroll.ts`: `chipScrollLeft`, `scrollEdges`).
  - The active chip (`aria-current`) is revealed by setting `scrollLeft` before the next paint after `active` changed (an animation frame), never animated, and at the row's first layout and when the row comes back from the wide layout, both in the ResizeObserver. No effect or mutation callback reads geometry (that forces the layout of the whole page), and wide screens read none.
  - A chip focused by the keyboard (`:focus-visible`) is revealed the same way, never one a press focused (the scroll would move another chip under the pointer and the click would be lost).
  - The scroller has `tabindex="-1"` (browsers add a scrolling region as a tab stop) and padding that matches a negative margin so the focus ring is not clipped.
- Intro steps and their per-account device dismissal stay with Explore (`lib/explore/audience.ts`): shelf, combination, club, profile picture (`avatarId`), error reports (`diagnosticsOptIn`). The last two link to `#/account?section=picture|diagnostics` (`Route` `account.section`, ignored by `routeKey`), where `AccountPage` scrolls to that part, focuses its `h2` and brings its controls in with `nearest` (`reveal`: the picture's wrapper, clear of the sticky header and the bottom navigation by the root's scroll padding), once per arrival (`createJumpGuard`: a reload of the account does not move the page again; a bare `#/account` in between, by Back or the address bar, lets the same link jump again) (`ui/section-jump.ts`, shared with `SectionNav`).
  - Error reports stay opt-in: the step is a link only (no switch in the card, neutral wording), ticked only while reports are on, and never required: the card goes once the other four are done (`introDone`).
  - A card dismissed before the two steps existed stays dismissed.
  - On coarse pointers the card's links and Hide are `--touch-target` tall, rows `--space-2` apart; fine pointers keep the compact line (`explore-intro.spec.ts`).

## Paged list

- `explore/PagedGrid`: pages of 12 via a sentinel, "Show more" without IntersectionObserver, position and focus in `history.state`, data fully loaded client-side.
- The saved position keeps the scroll offset and where the list started (`top`); the restore (`restoredScrollY`) follows the list's start once the viewport had reached it, so an intro card or notice above may differ in height on return.
- First-render rule: everything above the list must be in its first render (no `$effect`-set state that shows or hides content, no breakpoint known only in `onMount`). A later insertion shifts the page after the restore, and scroll anchoring then keeps the wrong content in view.
  - Explore's guest welcome and intro card wait for the end of `loading` (an unknown account looks like a guest until then), so `load` and `restore` end it in the very patch that brings the listings, never after the snapshot is saved.
- Each item spans its measured height over fixed row units (`lib/paging/paging.ts` `packInRows`); never give a card `align-self` or height assumptions.

## Layout and discovery

- Search precedes the type/view controls; phone search occupies a full row, with scan/filter controls beneath it. Type chips use square corners and a solid active accent; quick views stay pill-shaped.
- Explore glaze rows offer Share beside the favourite only at 22rem of card content width, or 25rem while quick-add is present (a cleaned-up `ResizeObserver` measures rem-relative space). Do not use CSS containment on these cards: their photo viewer and share fallback dialog must cover the viewport. Detail cards receive a `share` snippet, rendered next to the star; drafts render none.
- Photo discovery (`photoBrowse`) defers entries without result photos (packaging-only glazes too, which have no preview) until the `PagedGrid` end snippet offers their explicit reveal.
  - Counts remain complete, with explicit pictured and deferred counts whenever entries are hidden; offline snapshots retain the complete matching data. Search, glaze lookups, Waiting for photos and personal quick views remain complete.
  - Reveal appends the missing-photo entries without reordering pictured cards, loads a page and focuses its first link; its account/route key is kept in the current history entry for Back/reload.
