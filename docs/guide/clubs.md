# Clubs

- Members: `GET /api/clubs/{id}/members` is readable by every member, so `load` fetches each club's member list right after the clubs (`AppState.clubMembers`, by club ID; kept in the snapshot; cleared with the account data); components never fetch members.
  - A 403 (the account left the club after the clubs were read) leaves that club's list out and the page says it is unavailable; any other failure is a failed load.
- Members join only through an invite link (no adding by email).
- `changeClubRole` reloads everything (`reloadOn: [404, 409]`, so a stale list is refreshed before the refusal shows). `updateClub` and `regenerateInvite` reload on 404 too: the API answers a club the account no longer sees exactly like an unknown club, so the reload takes it off the listings and its page shows "not found".

Club page (`#/clubs/<id>`, `ClubPage`, `routeSection` clubs):

- A club outside the account's own list is "not found"; guests get the sign-in prompt.
- The club shelf link (`#/stock?shelf=<id>`) is for everyone; "Invite people" and "Club settings" are for admins only, each a button with `aria-expanded`/`aria-controls`: an opened panel takes focus at its `PanelTitle` heading, closing returns it to the button; an admin who demotes themselves loses both panels and focus moves to the members heading.
- "Combinations by members" is `memberCombinations(combinations, members)`: published combinations whose `authorId` is a current member, newest first with Explore's `newestFirst`; drafts never count.
- Its `PagedGrid` is named `club:<id>`; every state above it (panels, folds) changes only on a click, never in an effect or from a measurement, so the first-render rule holds.
- House rules are folded by the pure `rulesFold` (`lib/clubs/clubs.ts`: more than 400 characters or 6 lines; counted, never measured).
- Members show names (never IDs or emails), admins first then by name (`orderedMembers`, `Intl.Collator` in the app locale), at most `MEMBERS_SHOWN` (12) then "Show all". A plain member is told whom to ask for the invite link (`clubAdmins`).
- The members area is replaced by the settings while they are open, so there is one member list.
- A club without a saved member list (older snapshot, offline, a 403 race) shows a note instead of the list and the settings' member part, and the rest of the page works (`ClubSettings` `members` may be undefined).
- Leave stays on the Clubs list only; the page links back.
- "Make member" for the only admin (`isLastAdmin`) is `aria-disabled` with `aria-describedby` the reason, never `disabled`, and its click does nothing; the server's last-admin guard stays authoritative.
- `ClubSettings` keeps its name and rules drafts from when it opened (`untrack`), but its invite switch is a writable `$derived` of the club's value, so it follows a change of that value (a generated link, another admin) and a later save never switches invites back.

Wishlist (`components/clubs/ClubWishlist`, rules in `lib/clubs/wishlist.ts`, actions in `state/clubs/wishlist-actions.ts`; backend "Authorization and visibility"):

- A page fetch, never synced or saved: the club page reads `GET /api/clubs/{id}/wishlist` on every visit while online into `AppState.clubWishlists` (memory only, cleared with the account data and by `withoutClub`); offline it shows what this session read, read-only, else a note.
- Writes (`addWishlistEntry`, `removeWishlistEntry`, `setWishlistAcquired`) need a connection and patch the list with the API's answer; a 403/404/409 reads the list again before the refusal shows, and a 403 also reloads the clubs.
- Forms: `wishlist-load` (the section), `wishlist-add` (both dialogs), `wishlist-remove` and `wishlist-acquired` (under the section's buttons).
- Remove and the acquired toggle show only where `canManage`; removal asks through `createConfirmation` and focus then goes to the section heading; the toggle stays focusable while it runs (`aria-disabled`) and focus follows its row when the list re-sorts.
- Order: still wanted newest first, then acquired, most recently acquired first (`orderedWishlist`); "n of 100" counts the open entries; at the limit both Add buttons are disabled with a note.
- "Add glaze" picks with `GlazePicker` (code, manufacturer or name); a glaze not in the library goes through the one add-glaze dialog (`createAddGlazeHost`, above the wishlist dialog), which then selects it. A glaze already wanted is refused in the dialog before a request.
- "Add item" checks the link with `wishlistLink` before sending: the typed text must hold no white space, control character or backslash and start with `http://` or `https://`; the browser's `URL.href` is sent (punycode host, percent escapes) and must pass the grammar shared with the backend (`wishlist-links.json`).
- An item's link shows its host (`linkHost`, punycode kept) as the link text, opens with `target="_blank"` and `rel="noopener noreferrer nofollow"`, and adds a visually hidden "(opens in a new tab)"; never `{@html}`.
- An entry without an adder (left the club or deleted the account) says "a former member".
- Both dialogs register one leave guard on the page (`drafts.discardWishlist`) and close on an account or club change.

Invite links:

- The API answers a token only on generation, together with `InviteView.version`. An admin's club view carries `inviteVersion`: it names the active link without revealing it and changes with each replacement; null without a link and always null for a plain member.
- `regenerateInvite` keeps token and version in the controller's `inviteTokens`: memory only, never the store, a snapshot, storage, a route or history; cleared on an account change and on leaving the club. It patches the club with what the server did (link, invites on, new version) in the same update and reloads; `app.inviteLink(id)` rebuilds `{link, version}`.
- What the panel shows is the pure `inviteKind(known, club)` (`state/clubs/club-invite.svelte.ts`), decided by the version alone so no load order can lose or mislead it: `shown`, `off` (the active link, but invites are disabled: hidden, with the way back), `replaced` (a newer link was generated elsewhere), `hidden` (a link this session never saw, as after a reload) and `none` (always for a plain member).
- Generating a link turns invite links on (backend "Authorization and visibility"; the settings switch is the off switch); the panel says so under the button while they are off.
- `ClubInvitePanel` (through `createClubInvite`): "Copy link" uses `lib/share` `copyLink` (a refused copy selects the field with a hint); "Share link" only where `navigator.share` exists (`app.shareUrl`, which copies when the sheet fails); a `sharing/QrPanel` with the text field always visible beside it; replacing an existing link asks first in a `ModalShell`.

Clubs list (`ClubsPage`, `#/clubs`: a list, never a redirect):

- Sorted on the client by `sortedClubs` (`Intl.Collator` of the app locale; the API sorts case-sensitively).
- `ClubCard` is one link: the club name is an `<h2>` inside the `<a>` whose `::after` is stretched over the card (the focus ring is drawn on that pseudo-element); "Leave club" has `position: relative; z-index: 1` above it. Never nest another interactive element in the link.
- Outline: h1, then one h2 per club; no h2 in the "Start a club" disclosure (a `<summary>` is no heading), except that with no club the start panel has an h2.
- "Start a club" is a `<details>` whose name field takes focus on opening; without clubs one panel holds the join hint (`clubs.joinHint`) and the open form.
- The count line is the pure `clubSummary(club, members, stock, combinations)` over loaded data (members, glazes in stock on the club shelf, combinations by current members: the club page's own numbers). A count whose list is unavailable is left out, never 0. Each part is its own plural message (`clubs.page.members`, `clubs.card.glazes`, `clubs.card.combinations`) in a `nowrap` span, so a wrap never splits a number from its noun.
- `createClub` allows one request at a time in the controller (a second call while one is pending answers null without a request, so a reopened page cannot make a second club), answers the new ID (null after a failure) and opens the club's page as a new history entry while the writer is still on the visit that started it. `joinClub` replaces the invite route with `#/clubs/<id>`.
- One `OfflineNote` above the grid serves every "Leave club" (disabled offline). After a leave, focus goes to the list (`tabindex="-1"`, named by the page title), or to the start panel's heading when no club is left.

Leaving and removing (`DELETE /api/clubs/{id}/members/{userId}`):

- `leaveRefusal(members, userId)` mirrors the last-admin guard (the only admin, or the only member, cannot leave) as `aria-disabled` with the reason as `aria-describedby`, shown as one short line on the card (`clubs.leave.lastAdmin`/`onlyMember`).
- `ClubSettings` gives admins "Remove" per other member, never their own row; the confirmation also says that an active invite link lets them back in. `.club-settings__remove` keeps `--touch-gap` from the role button on touch.
- Both questions run through `state/shared/confirmation.svelte.ts` (`createConfirmation`): the dialog closes on confirm, so focus returns to the opener and a failure's `FormError` takes it from there; one run at a time.
- `app.leaveClub` (form `clubForm('leave', id)`, shown on the card; `reloadOn` 403/409) first applies `withoutClub` (drops the club, its member list, its shelf and every CLUB photo of that club from the listings), saves the snapshot, drops those pictures from the image cache and the club's invite link from memory, then reloads: a failed reload keeps nothing of the club.
- `app.removeClubMember` (form `clubForm('members', id)`, shown at the member's row, or under the Members heading when that member is gone after the reload; `reloadOn` 403/404/409) reloads, and the settings move focus to the Members heading. The server's guards stay authoritative.
