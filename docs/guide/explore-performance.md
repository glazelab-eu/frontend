# Explore and shelf rendering cost

The rule under everything here: a listing change replaces the arrays and the changed items and never edits them (`upsert`, `withGlazeNames`, `app-state`). The caches below are keyed by array or item identity (`WeakMap`s), so a store update that edited an array or item in place would leave every derived value stale.

Listing:

- What Explore derives depends on three things, recomputed only when they change:
  - `lib/explore/listing.ts` `listingOf(glazes, combinations)`: one set of rows per pair of arrays (a `WeakMap` by the combination array, so nothing outlives a sign-out): entry objects, sort text, time, `usage`, and the two whole-listing orders every sort reduces to (`newest`, `az`) as ranks.
  - `matchesOf`: the last result of search, tags and glaze filter (a chip or sort changes none of them).
  - `missingGlazes`: the last four shelf scopes, compared by content (`KEPT_SCOPES`: the two switches on and off), each one number per combination.
- What depends on the account or the moment (stock, buddies, favourites, totals, `now`) never enters a row or cache: `explore()` applies it in one pass per list that gives each row its views as bits and tallies them, however many chips ask. Never add a pass per view.
- `glazeMap`, `buildTagIndex` (one per array, whichever page asks; never edit the array or the answer) and `glazeIdsOf` (one per combination) rest on the same rule.
- `inOrder` reads ranks only (with a score, as for Most favourited and Most used, it sorts whole numbers natively), so no filter or sort compares a title or date.
- The first use of an order sorts the listing, a long task for A-Z (the collator): `warmOrder` (`DiscoverPage`, per listing) does it in idle slices through the pausable `mergeSort`, and a use before the end finishes it.
- Retained: about 13 MB at 23,095 items (rows, orders, tags, four scopes).

Sort:

- An order's comparators (`compareIdentity`, `byNewest`, `byText`) compare through the one shared `Intl.Collator` (`compareText`): `localeCompare` with a locale or options builds a collator per comparison.
- A comparator over the listing never parses a date or builds text (rows hold both, once). `listedTime` parses a date once per item (a `WeakMap`; `newestFirst` uses it too).

Delta:

- A delta that changes nothing keeps the arrays and the snapshot (`upsert`, `persist`), so Explore derives only the account data the load read anew.
- A changed delta on Explore calls `warmListing` before it patches (rows, the newest order, tags and maps in tasks of their own, and the order the link's sort reads, `listingOrder`, in tasks of at most `WARM_TASK_MS`), so the task that shows it holds only what depends on the account.
- That wait sits inside `settle`, before `load`'s `touched` check, so a write during it asks again: never move it after that check.
- The loop's last `touched()` and `current()` checks and the patch that shows the data run in ONE synchronous step (`loadAs`, `state/app/load.ts`): never put an await between them, also not by moving the patch into an awaited helper. A write patching in that gap would be overwritten by the older answers, and a sign-out landing there would let the old account's data in.
  - `settle`, `rest()`, `shownData`, the loop and that tail move together (`sync.test.ts` "writes and saved records racing a load"; `load-source.test.ts` reads `load.ts` and fails on an await, `.then`, `queueMicrotask` or `setTimeout` between the loop and the patch).
- `DiscoverPage` reads the store's fields through one `$derived` each (`stock`, `buddies`, `buddyAvailability`, `favoriteCounts`, `sync`, `accountId`), and no derivation that feeds `explore` reads `$appStore` or `user` itself: `$appStore` changes with every patch and a load replaces the `user` object, and either would derive everything again.
- The glaze and combination pages and `createAddGlazeHost` read the listings and buddy fields the same way, so a patch elsewhere (a toast) never counts tags or sorts buddies again.
- The load's ending patches only when it changes something ("Controller modules"), and `similar-looks` passes over the library only while the model is on.
- Known cost: `store.put` of the snapshot is one task, about 50 µs per item on the 4x phone (1 s at 20,000), for every listing or rest change and every small write (`saveCurrent`). It is the structured clone, so only another storage layout, a worker or a later write helps.

Search:

- `search` (`lib/glazes/glazes.ts`) compares text made once per item (`WeakMap`s by item object). No language or account data enters the text; anything that does must join the check.
- A combination's text also holds its steps' glazes (code in both forms, manufacturer), and a code or short ID correction does not replace the combination (`withGlazeNames` copies names only): so its entry keeps the glaze objects it was made from and is rebuilt when the map answers another one.
- `glazeMap` answers one map per glaze array (`ExploreInput.glazesById`; never edit a map).
- `DiscoverPage` warms the text in idle slices per listing (`warmSearch`, cancelled on change); a key that beats the warm-up builds the rest in its own task. It keeps about 1 kB per item.
- `Combobox` (every picker) renders a window of its matches (`ui/option-pages.ts`). Never render the whole match list (thousands of options were seconds of DOM and forced layout on the 4x phone).
  - `openWindow` (again per text or opening): the first `OPTION_PAGE`, or one page around an active option further down; one page more when the list is scrolled within a view of either edge of the window; `optionWindow` grows it to an active option the keys moved past an edge.
  - Keep the active option inside the rendered range for any new key, so `aria-activedescendant` names a rendered option that `scrollIntoView` can reach. The active option is read through `activeOption` (the last match when the matches shrink under an open list, none without matches), never past the end.
  - Option IDs and `aria-posinset` are places among all matches, with `aria-setsize` of all of them.
  - A page added above keeps what the list shows by moving `scrollTop` by its height after a `flushSync` in the scroll handler, with `overflow-anchor: none` on the list so no browser's scroll anchoring moves it twice.

Shelf:

- `ShelfList` renders the first `SHELF_FIRST_ROWS` rows (`firstRows`, in group order, so nothing above a new row moves; a shelf that fits is unchanged) and the others through `idleSlices` of 10 ms with `flushSync` (hundreds of rows at once were a long task on the 4x phone, and no read order saves it).
  - A group's used up rows follow its rows in stock in the same slices, never all at once; the summary reads `usedUpCount`, the whole group's count.
  - What scrolls to the form below the list calls `showAll()` first (`focusStockForm`, a chosen or scanned glaze), else the coming rows would move it away where the browser has no scroll anchoring.
  - Focus entering the form (`onfocusin` on `.stock-form`) calls it too, in a timer task of its own (`showAllSoon`), because focus can move inside an effect, where `flushSync` must not run (WebKit itself is not tested here).
  - Fewer rows (a chip, the filter) lower the limit, so more rows come in slices again; a whole list stays whole when a few rows join (`shelfRowLimit`), else a saved entry would push the last rows out for a moment.
- `groupShelf` sorts with a shared numeric collator, in the browser's language as `localeCompare` without a locale.
