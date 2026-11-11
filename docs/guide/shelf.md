# Shelf

`StockPage`, `stock/ShelfList`; pure rules in `lib/stock/shelf.ts`.

## List

- Groups: Personal, then clubs by name, used up apart. A club row names its adder only while they are a member (`stockAdder`).
- Remove (used up only) shows only where `StockItem.canRemove` (the API's rule per viewer); snapshots without the field allow it for personal entries only; a 403 from `removeStock` reloads.
- Owner choices call the personal shelf "Personal"; "My shelf"/"Your shelf" name the page and possessive text.
- Row writes use `app.saveStock(input, true)` (toast errors; the form uses `formError`) and patch in place (`withSavedStock`); only a first save reloads. Focus follows a row that moves.
- While a row write runs, `ShelfControls` marks its buttons `aria-disabled` (never `disabled`, which drops the focus) and ignores taps.
- Offline the list is read-only text with a note.
- Personal rows share one privacy explanation per list (`aria-describedby` on each switch); never hide the switches.
- Typed input registers a leave guard (`drafts.discardShelfScan`): the stock form once a glaze is chosen and an amount or jar size differs from where it started (`stockFormDirty`); the glaze page add form once its amount or jar size differs from the defaults. A row's inline field (one value, closed by Escape) is exempt.
- An empty shelf leads with the manual form, without a separate empty list panel; a populated shelf keeps the form mounted after the list.

## Which shelf is active

People must never change club stock by accident.

- `stock/ShelfScope` names the active shelf in words and an icon, never by colour alone (`aria-live`; a club's in the warm `ui/Callout`). A club group of `ShelfList` uses the same callout. No side bar anywhere (`stock/shelf-look.test.ts`).
- `stock/ShelfSelect` is every owner select that writes stock; while a club is chosen it shows the scope sentence under the select (`aria-describedby`, outside the label so choosing never remounts the select).
- Every write button and a club row's amount field name their target (`stock.target.*`, `stock.scan.saveNext(Club)`, `stock.scan.quickAddClub`, `glaze.shelf.quickAdd*`, `stock.row.amountLabelClub`).
- Safe default: a club is the target only when chosen on purpose (its chip or link, the select).
  - The form starts on the shown shelf, else on the personal one (`formOwnerFor`); a chip change moves the select only while no glaze is chosen; a refresh never undoes a shelf chosen in the form; a club left goes back to personal, even with a glaze chosen.
  - The glaze page add form whose club went away goes to personal or closes, never to another club.
  - The add-glaze dialog starts on its host's shelf (`owner`, `draftOwnerFor`): Stock's on the form's, a scan session's on the session's; Explore's buttons, Studio and the club wishlist on personal. A club left goes back to personal.
  - A preselected club is not typed input: the dialog's leave guard ignores it.
  - One-click adds on Explore and the glaze page always write to the personal shelf.
  - A scan session starts on its `owner` prop, else personal; nothing is remembered.

## Availability marks

- Pure in `lib/stock/availability.ts`: `availabilityByGlaze` (in-stock entries; club entries only within the scope and only for a club of `AppState.clubs`, which also gives the name), `availabilityText`.
- "On your shelf" means personal stock (> 0 g) only; personal plus club stock still says only that, never the club.
- A glaze only club shelves hold says "Available in <club>" (two named, from three "A, B and N more"; names cut at `CLUB_NAME_MAX` with the full line as `title`). Amounts never appear in a mark.
- The scope decides: the combination page counts every club of the account; Explore rows name clubs only in Available to me with club stock counted (`clubs=1`); otherwise rows mark the personal shelf alone.
- The glaze page line says "On your shelf: …" only with a personal entry; club-only it is `glaze.shelf.inClubs` (in-stock parts) or `glaze.shelf.usedUpInClubs`.
- Overflow: `overflow.spec.ts` "club availability" (long names, five languages, 320 and 390 px); behaviour: `shelf-availability.spec.ts`.

## Owner filter (`?shelf=`)

- With at least one club, `ui/FilterChip` links in a `ui/ChipRow` (clubs sorted by `Intl.Collator`; counts are entries in stock). `shelfOwnerFor` resolves the link (an unknown or left club is all shelves); `filterByOwner` filters.
- `ShelfList` gets the filtered entries and an `empty` text of the chosen shelf (never "your shelf is empty" while other shelves hold glazes), and stays mounted so its text filter (from `SHELF_FILTER_FROM` entries of the chosen owner; no match still says so) survives a chip change.
- `.stock-shelves` is a flex parent (the chip row's sideways scrolling needs it); `.stock-list` keeps `min-width: 0` as a grid item.
- The back link names the club when the club page is the recorded predecessor (`previousRoute`).

## Additions vs. amounts (backend "Stock")

- `app.saveStock` takes a `StockWrite` (`lib/api/inputs.ts`): a `StockInput` sets the amount (`POST /api/stock`, last write wins); a `StockAddInput` adds grams to what the server holds (`POST /api/stock/add`, `isAddition`), and the listing takes the answered entry (`withStockEntry`; an entry not listed yet reloads).
- Every "add a jar" is an addition, never a total worked out from the device's copy: `oneJarInput`, the form's jar mode (`stockFormInput`), the one-click adds (`quickAddInput`), the scan sheet's Save after only + steps (`sheetInput`). A typed amount (`ScanSheet.typed`) or less than before sets it.
- A form or sheet filled where the shelf held no entry (`StockDraft.startAmount` null, no `ScanSheet.entry`, the glaze page's add form) adds its amount (`newEntryWrite`; 0 g with a size is a size-only save), so an entry another device made meanwhile keeps its grams.
- A set sends only what changed against where the form or sheet started (`changedOnly`): the amount only when it differs from `startAmount`/`entry.quantityG` (a size change alone is a size-only save), the jar size only when it differs from `startJar`/`entry.jarSizeG`.
- A failed addition sent again unchanged (same account and input) repeats its `requestId` (`state/stock/stock-actions.ts`), so a lost answer and a second tap add once; a success or any other addition gets a new ID (`lib/api/request-id.ts`).
- Jar size: the server stores a sent size only where its entry has none. An addition sends the size it adds ("+1 jar" always, so a row another device removed comes back with it); `replaceJarSize` is asked only for a size changed on purpose (`changesJarSize`: differing from the size the entry showed when the form or sheet was filled, `StockDraft.startJar`/`ScanSheet.entry`, never from an entry a refresh changed meanwhile; never by one-click adds or a new entry's usual jar). Changing a size otherwise is the set path (size-only when the amount is untouched). Saving must never set a size unasked: an existing entry keeps its size or none.
- A new jar action follows the same rules; `stale-jar.spec.ts`, `stale-jar-scan.spec.ts` and `stale-writes.spec.ts` write from a stale page.

## Scan-first (Stock on phones)

- `StockPage` (`isPhone()`) mounts `stock/ShelfScanSession` while `scanSession` is set, closes it on an account change and forwards the add-glaze dialog's outcomes (`added`, `useGlaze`, `addClosed`). The session owns its state (`lib/stock/scan-sheet.ts`), `LeaveDialog` and leave guard.
- Its `BarcodeScanner` (`keepOpen`, `sheet`, `bind:holding`) stays mounted across jars. A held code stays ignored until decoded frames show it absent for `REPEAT_ABSENT_MS` (`lib/barcodes/scanner.ts`) or another valid code appears; failed reads are not absence.
- A known code opens `stock/ScanSheet` inside the scanner (saves via `app.saveStock` with `formError('stock')`; an unsaved change asks before close or leave); an unknown code opens the add-glaze dialog above the scanner.

## Amount default and one-click add

- `DEFAULT_JAR_G` (250) prefills the AMOUNT of every NEW entry a person types, on the personal and every club shelf alike: the stock form (`stockDraftFor`), the glaze page's add form (reset to it after a save), the add-glaze dialog (`emptyGlazeDraft`) and the scan sheet (`scanSheetFor`). Untouched, it saves at once as an addition of 250 g.
- The prefilled amount is not typed input: `stockFormDirty`, `addDirty`, `shelfTyped` and `sheetChanged` compare with it and never ask for it alone.
- A new entry's jar size fields start empty and optional; only the scan sheet starts with a 250 g jar for its - and + steps (no change either).
- One constant serves the prefill and the one-click jar ("+1 jar", `quickAddInput`, `glaze.shelf.quickAddFor`): changing it changes both.
- Glaze page: `.glaze-shelf__quick` shows while online and `freeOwners` lists `personal` (a used-up personal entry does not count as free). It saves `quickAddInput` through the form's path (`saveStock(input, false, 'notices.shelfAdded')`): same notice and `FormError`; focus then goes to the toggle, also after a failure.
- Scan sheet: the same button for a glaze the sheet's shelf does not hold (`sheetQuickInput`).
- Explore glaze rows: icon-only `.glaze-row__quick` left of the star (`GlazeRow` `onQuickAdd`/`quickError`), passed only for a signed-in account's glazes without a personal entry (`DiscoverPage` builds that set once per list); `quickFailed` limits the error to the failing row; focus goes to the glaze link on success and stays on the button after a failure. Never on combination cards.
- Failures: `e2e/specs/quick-add-failure.spec.ts`.
