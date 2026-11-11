# Admin pages

- Every site-admin page lives under `#/admin/<page>`; the route names stay the bare page names. A new page joins `adminPages` in `routes.ts` and the landing page's list, and starts with `AdminBackLink` (rendered for site admins only: a guest's guard text names nothing).
- `AdminPage` (`#/admin`) is the landing page: one h1 and a card per page, no requests and no counts. The footer has ONE "Administration" link, for site admins.
- `parseRoute` still accepts the first hashes (`#/image-reports` ...); the history tracking replaces them without an entry. An unknown `#/admin/<x>` is the in-app not-found.
- `components/admin/AdminGate` is every admin page's not-admin / offline / page order (the landing page passes no `online`): guests and non-admins get the guard text. Empty texts and dialogs stay in the page.
  - The gate only decides what shows. Nothing is requested for a guest, a non-admin or offline because every list page loads only for its `actor` (`user?.siteAdmin && online ? user.id : null`, a primitive, so a reload of the same account keeps the rows); a new admin page does the same.
- Admin pages keep their data in page memory only, clear it on account or connectivity changes and ignore stale responses.
- Photo report queue (`ImageReportsPage`, `lib/admin/image-reports.ts`): drops every report of a deleted photo and deletes through `app.deleteImage({ id, url })` with the shared `RemoveImageDialog`.
- A report row shows a thumbnail only for a PUBLIC photo (`reportPhotoUrl`): no other photo's bytes are requested and no URL to it exists in the page (a deliberate privacy rule: discuss before changing it).
- Admin texts: visibility through `adminVisibilityKey` (never the uploader's "Only me"); times through `formatServerTime` (the API's instant in UTC with the zone shown, so "(server time)" is true); an ID row without a value is left out (`deletionItem`).
- Account list (`pages/admin/UsersPage`, `app.loadUsers(page, q)`, form `users`): read-only; the search is a submitted `role=search` form (no request per keystroke; `userSearchText` strips and cuts at 100 like the API; a new search resets to page 0). The email is for site admins only (backend "Admin user list"); no terms text, since the admin is the operator with database access. A null `createdAt` shows nothing.

## Server-paged lists

- Server-paged admin lists use `state/admin/paged-list.svelte.ts` (`createPagedList`): page-owned rows, loading/failure state, deduplication and stale-request invalidation.
- The host resets on primitive account ID, connectivity and filters, and invalidates on effect cleanup.
- Mutable queues pass `nextReportPage` (occurrences: `nextOccurrencePage`), since dismissals and deletions shift the server pages; append-only logs advance by page.
- Failed loads retain rows: logs retry the failed page, mutable queues recalculate it from the remaining rows.
- Capture `current()` before a mutation to guard its local continuation.
- `components/admin/PageLoadControls` renders the shared error, Retry and Show more controls; dialogs and row actions stay in their pages.
- A list of record cards is `RecordList` > `Record` > `RecordDetails` > `RecordField` (scoped styles, no global classes). `class` keeps the page's own block and entry names beside `record-list`/`record`: the e2e suite selects `.bans__entry`, `.avatar-reports__entry` and similar, so keep them. `UsersPage` keeps its own one-line rows.
