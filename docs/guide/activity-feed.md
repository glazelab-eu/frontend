# Activity feed

- Backend "Activity feed". `#/activity`: `pages/activity/ActivityPage`, `components/activity/FeedItem`, view rules `lib/feed/feed.ts`, actions `state/feed/feed-actions.ts` (forms `feed`, `feed-settings`), settings `account/FeedSection` (section `account-feed`).
- The feed is online only and page memory, never in the snapshot.
- The badge is `User.feedUnread`, read with `/me` on every load and saved with the account, so offline it shows the saved count; `readLastUser` gives an older saved account 0 and both sources on.
- `layout/FeedBell` (signed-in accounts only) is a link with the whole sentence as its name and `title`. Its badge shows the unread count, else the buddy requests still waiting (`feed.openUnread`, `feed.openRequests`, `feed.open`).
- The count sentences (`feed.openUnread`, `feed.showNew`) take the number from `badgeCount` (capped at 100) and say "99+" in their `=100` form, so every language agrees in number.
- Seen: `POST /api/feed/seen` once per first page with the newest entry's time, never awaited, silent on failure; the "New" group stays until the page is left.
- News that arrives while the page is open never moves the list by itself: once the seen post was saved, a badge above 0 shows the `feed.showNew` button (a polite status region, not hidden while "Show more" reads, so it is announced once), which reads the first page again and hands focus to the "New" heading. After a failed seen post nothing is offered (the badge still counts what is shown).
- Reading the first page again (`showArrived`, an account or source change) drops any "Show more" still under way (`version`): its page belongs to the replaced list.
- `BUDDY_REQUEST` entries show whatever the two sources; with both off the page says so above them.

Poll (`state/app/load.ts`; `state/app/feed-poll.test.ts`, `feed-poll-races.test.ts`): `GET /api/feed/unread` every `FEED_POLL_MS` (30 s).

- Only while the page is visible, online and signed in; never during a load (its `/me` brings the count), a sign-in or before a pending sign-out is answered; at once when the page becomes visible without a load.
- A failure doubles the wait up to `FEED_POLL_MAX_MS` (back to the interval after an answer, a resume or `online`); a 401 checks the session (`ctx.fail`).
- It patches (and saves) the account only when the count changed, and only onto the very `user` object it asked with: another account, a load's `/me` or a "seen" that answered meanwhile knows better.
- It schedules nothing once `start`'s stop ran and never touches the sync state or its cadence.

New-request toast (`AppState.requestToast`; `state/app/request-toast-poll.test.ts`):

- The poll's answer names the newest waiting request later than the seen position (`requesterId`, `requesterName`, `requestedAt`, `requests`); the pure `lib/feed/request-toast.ts` (`requestNews`, `requestShownBy`) decides over a memory the load module owns (`ready`, `through` = the newest request time known or announced).
  - The memory is never stored and is reset by `onAccountChange`; an answer asked with an older memory is dropped.
  - The first answer per account only sets the baseline, except for a requester the loaded `buddies.incoming` does not hold (it arrived after the load).
  - Afterwards a request later than `through` gets ONE toast per answer (`feed.requestToast`), never twice; on `#/activity` and `#/buddy/<token>` it is recorded without a toast.
  - An answer with no unseen request, or whose newest is older than `through` (the announced one is gone), closes a shown toast; an answer without the fields (an older API) changes nothing. The store is patched only when the toast changes.
- It is reset by an account change and by a page change to `#/account` or `#/activity` (`showRoute`).
- `App.svelte` renders it in the polite status region: not while offline; no sound, vibration or focus move; it stays until Answer (opens `#/account` and focuses the Buddies heading once the page shows, or reloads the buddies when the page is open already) or Dismiss/Escape (`app.dismissRequestToast`, focus to `main`).

e2e: `activity.spec.ts` (two accounts on a fake clock; `support/feed-poll.ts` `runPollsUntil`/`runPolls`), `overflow.spec.ts` (page, badge, switches and toast in all five languages at 320 and 390 px).
