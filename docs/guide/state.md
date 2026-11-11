# Writes, drafts and leave guards

State ownership and the `accountId` reset rule: `AGENTS.md` "Code rules"; account-change clearing: "Hard rules".

- `write` (`mutate`: boolean; `mutateFor`: the value `apply` returns) runs `request`, then `apply` (listings, reloads, navigation) only while the starting account is still signed in. Never repeat that lifecycle in an action.
- Options: `notice`, `form`, `requireOnline` (signed in and reachable, else a silent false), `reloadOn` (statuses that reload the listings before the failure is reported), `busy` (one write per key).
- The one of each: `emptyAccountData()` (reset of every private listing), `formErrorFor(state, form)`, `errorMessage(cause)` (`lib/api/client.ts`), `lifetime(account)` (`state/shared/lifetime.ts`: still mounted and same account after an await).
- Rune modules (`*.svelte.ts`) are compiled for the client runtime under Vitest (`vite.config.ts`), so `$effect.root` works in Node.
- Leave guard: `app.registerLeaveGuard({ dirty, message })` from an `$effect`; optional `body` and `leave` texts for a question that is not about a discard (`LeaveQuestion`). Re-register when the question changes.
- User navigation asks in `layout/LeaveDialog` (a hash change cannot be cancelled: the page's link is put back with replace); reload/close asks via `beforeunload`; the controller's own navigation never asks.
- The listings cleared on an account change include private image metadata. Watch `accountId`, not `user`: a reload replaces the object.
