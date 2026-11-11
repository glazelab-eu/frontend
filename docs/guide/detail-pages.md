# Detail pages

- Headings: every page has exactly one h1. `PageHead` gives it; a detail page's h1 is the card's title (`GlazeCard`/`CombinationCard` `headingLevel={1}`; list cards stay h3) and keeps the class of the h3 it replaces, so nothing changes visually.
  - `RouteStatus` takes `headingLevel={1}` where no `PageHead` stands above it (unknown route, missing item, crashed page), else it is an h2, like `SignInEmpty` (always h2 under its page's h1; the guest club page gets a `PageHead` first).
- Detail pages read first: `tags/ItemTags` shows plain tag chips and `glazes/GlazeBarcodes` one line of codes. Each has an Edit control (signed in and online only; offline closes the editor) that opens its editor with focus in the field and returns focus to the control on Done.
  - `ItemTags` `inline` (inside the card's recipe column): label, chips and the edit/Done control in one wrapping row without a frame. An empty list shows only `tags.addFirst`, and the h2 stays visually hidden so the outline keeps h2 Tags.
  - Live tag editing (`ItemTags` → `TagEditor compact`) uses the compact combobox's visually hidden label and omits the normalisation/count hint, but keeps the validation/status descriptions and the tag-removal focus. Studio and creation forms keep the default labelled editor and full hint.
  - `GlazeBarcodes` keeps its remove buttons during a request (a busy guard, not removal of the buttons) and moves focus like the tags: the next remove button, else the input.
- Favourite buttons use a stroke/fill glyph for their state; their look is the shared `.icon-button` ("CSS").

Layout shared by both pages:

- The pages pass snippets that render inside the card body: `CombinationCard` `detail` takes `tags`, `actions`, `lineage`, `footer`; `GlazeCard` `detail` takes `status`, `actions`, `combinations`, `footer`. The layout CSS of the two cards is a copy: change both together.
- From 45em (`width >= 45em`, the complement of the phone query; no new breakpoint) the card is a two-column grid, 1:1 below 68.75em and 1.1:1 above: the media column (`combination-card__media`, `glaze-card__media`) left, the recipe right. On a phone it is one column in the same order.
- `.detail-main` is 40rem on phones and unlimited from 45em; the guest invitation stays outside the card at 40rem.
- The media column is `position: sticky` (`top: calc(var(--header-offset) + var(--space-4))`) only while all of it fits the window with 1rem above and below (`lib/layout/sticky-fit.ts`: `watchStickyFit` measures the column and the window, `fitsSticky` decides), because a taller gallery would hide its lower part until the page ends. Never a fixed height query (captions and wrapped buttons change the height). Sticking changes no layout, so measuring after mount is safe.
- The card uses `overflow: clip`, not `hidden`, which would stop sticky (older Safari does not stick: acceptable); the photo menu opens upwards, so clipping stays harmless.

Combination page (`pages/catalog/CombinationPage`):

- Recipe order: author, title, firing, description, the action group, tags, shelf line, steps, lineage, then Delete below a rule. On phones the title is displayed before the author metadata. Star and Share stay beside the title.
- The action group (`combination-card__actions`) holds the photo buttons (`CombinationCard`'s `photoActions` snippet) and the page's variation (signed in) and edit (author) actions on every width; the gallery keeps only photo browsing, metadata and its menu.
- Photo buttons (test tile, finished piece) stay adjacent (a paired row on phones), for every signed-in viewer (a draft's only viewer is its author), disabled offline. The first photo swaps the placeholder for the gallery, so they open the upload with a `returnFocus` that finds the same button (`data-photo-add`) in its new place.
- At most one green primary on the page: the test tile button only while a published combination has no photo (also for non-authors), Publish on a draft; everything else is an outlined `.button`.
  - A draft shows its photo buttons, Publish and Edit draft, nothing else.
  - The title control ends the group on a published combination: Rename for the author, Correct title for a site admin on someone else's (`combinations/RenameCombinationDialog`, form `combination-title`, disabled offline). `app.retitleCombination` patches the title in place (`withCombinationTitle`) and saves the snapshot; 404 reloads with `notices.combinationGone`, 403 reloads.
  - Delete (author) is an outlined `.button` in danger ink, like the glaze page's admin removal.
- The nav's Record is the only way to a new combination from the page (no "Record another").
- Heading outline: one h1, then h2 Tags and h2 Variations in reading order.
- Shelf: the detail page's shelf line gives only the count (list cards keep the missing names). Each glaze step ends with a shelf mark (dot plus text, never colour alone) beside the coats, wrapping below the name where the column is narrow. The mark's wording follows "Shelf" "Availability marks". Glaze names are underlined links on lists and the page.
- Lineage chips (`combinations/CombinationLineage`, which takes `userId` for the cover's `ImageView`; `lineage.spec.ts`): "Based on" and each variation is ONE link holding the cover's card copy (`pictureSrc`, never the full size) in `ImageView variant="thumbnail"`, or an `aria-hidden` neutral square of the same size, the title (two lines, then an ellipsis; a draft keeps the `combination.variations.draft` suffix) and a one-line byline (`combination.variations.by`, the deleted-account label for a null author, `combination.variations.yourDraft` for a draft).
  - Only the viewer's own drafts are ever listed.
  - The card clips overflow, so `min-width: 0` on the text is what keeps a long name inside.

Glaze page (`pages/catalog/GlazePage`; `glaze-page.spec.ts` covers layout, sticky-fit, order, buttons and gallery):

- Media column: `PictureCarousel` (own photos, then the finished pieces borrowed from combinations with their "Used in" line, packaging after them) or the full-size placeholder, and the one photo button (`catalog.addPhoto`: opens the upload at Test tile; every signed-in viewer, disabled offline; `.button--primary` only while the glaze has no photo).
  - The button stands OUTSIDE the gallery, so the first photo replaces the placeholder without replacing the button, and the upload dialog's focus return finds it.
- Right column order: shelf line (`status`), notes, the action row (Share sits beside the favourite), About (Edit, History), `ItemTags inline`, barcodes, then the h2 Combinations with "See all" and at most four cards. Site-admin removal follows the card.
  - "See all" keeps the complete count and opens the full filtered Explore listing.
  - About and barcodes carry no frame of their own. The h2 outline under the one h1 is About, Tags, Barcodes, Combinations.
