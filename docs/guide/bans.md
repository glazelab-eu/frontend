# Bans

- Backend "Bans": `app.banUser(id, name, reason, blockPictures)` (`POST /api/admin/users/{id}/ban`), `app.loadBans(page)` (`GET /api/admin/bans?page`), `app.unbanUser(id)` (`DELETE /api/admin/bans/{id}`).
- Never request or show an address. The Bans page (`pages/admin/BansPage`, `#/admin/bans`) lists `{reason, bannedAt}` only: an entry names nobody, neither the banned person nor the admin ("Lift ban" is labelled with the date), and the ban dialog's reason hint asks for no names or personal details.
- The one gate is the pure `canBan(viewer, targetId)` (`lib/admin/bans.ts`, with `banReason`, `MAX_BAN_REASON` = 500, `withoutBan`): site admins only, and only where the account is known and not the admin's own.
- Places: the profile-picture queue (`ownerId`), the photo queue (`uploaderId`) and the club page's member rows (an `extra` entry in the row's one `AvatarReport` menu); `ClubSettings` member rows have no ban.
  - "Also block the reported pictures" is offered only for a picture entry with open reports, the one case where the server's `blockPictures` does anything.
  - A site admin among club members is still offered the ban (`MemberView` has no flag); the API refuses with 409 `errors.banSiteAdmin`.
- The host page owns the dialog state (`banning`), never the row: the row leaves with the reload after a ban, and `components/admin/BanUserDialog` must outlive it, with `fallbackFocus` at the list or the members heading.
- A blank reason shows `ban.reasonRequired` and sends nothing. Errors show in the dialog (form `ban`, through `server-messages.ts`), which stays open; a refusal reloads (`reloadOn` 404 and 409).
- A success reloads the whole app (`load()`: the account's content is anonymised, clubs and member lists change); the host reads its queue again from page 0 and focuses the list.
- The Bans page pages with `nextReportPage` (50). Lifting asks first in a `ModalShell`, with errors at the separate form `unban` (reading the list again clears the form `bans`); a lifted entry leaves the list at once, a 404 reads the list again.
- e2e: `bans.spec.ts` (the three places, the 409/404 messages, the page, lifting with the address registering again (the mail-free API answers a banned address without a setup token), paging mocked because it needs more than 50 bans, the plain account); `a11y.spec.ts` has the dialogs and the page in en, de and pt-PT.
