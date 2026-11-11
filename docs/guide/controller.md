# App controller

## App controller

- `state/app/app-controller.ts` is the app controller: loading, auth, connectivity and mutations (typed inputs, boolean results), composed of the modules below; it exposes the read-only store of `state/app/app-state.ts`.
- App-level dialogs (`authOpen`, `accountSetup`, `uploadFor`, `removingImage`, `deletingAccount`, `changingPassword`, `feedbackOpen`, `leaving`) are state there with open/close actions and reset when the account changes; `App.svelte` keeps none of its own.
- A change of page (`showRoute`: link, Back, Forward) closes `authOpen`, `uploadFor`, `removingImage`, `deletingAccount`, `changingPassword` and `feedbackOpen` (its draft stays). It never closes:
  - `accountSetup` (its token is the only way to finish a mail-free sign-up);
  - `leaving` (the question about that very navigation);
  - the blocking `TermsDialog` (route independent; the delete dialog only hides it, so closing the delete dialog returns to the terms).
- `state/navigation/navigation.ts` (`createNavigation({ read, patch })`) owns history and navigation: leave guards, the recorded predecessor (`previousRouteFor`), `navigate`/`go`/`back`, the hash and `beforeunload` listeners and the Explore claim. The controller object re-exports them and resets the claim when the account changes.
- Controller tests sit by concern (`navigation`, `session`, `sync`, `mutations`, `account` `.test.ts`) on the shared mock API of `state/app/test-helpers.ts` (`useMockApi()` at the top of a file, `routes`, `loaded()`, `stubBrowser(hash)`). Its `GET /api/sync` always answers `resync`, so every load there reads `listing(…)` from `GET /api/sync/combinations`.

## Admin actions

- Admin operations live in `state/admin/admin-actions.ts`: add them there instead of growing the controller. They receive only `query`, `mutate`, `load` and `notify`; the controller keeps the shared write lifecycle (`Write` is declared in `state/app/write.ts`).

## Controller modules

- The core `state/app/app-controller.ts` keeps the store, `read`, `patch` with the reset registry, `stale`, the one `LoadTicket` (`load-ticket.ts`), `notify`/`fail`/`report`/`write`/`mutate`/`mutateFor`/`query`, `inFlight`, `storage`, navigation, the construction order, the dialog one-liners and the public object.
- The rest are modules in `state/app/` (`snapshot.ts`, `listing-sync.ts`, `session.ts`, `load.ts`, `account-data.ts`, `share-actions.ts`, `diagnostics-wiring.ts`, `gone.ts`) and the feature actions `state/<feature>/*-actions.ts`; each module's header comment says what it does and which state it owns (folder map: `src/README.md`).
- Pattern: `create<X>(ctx, deps)`; `ctx` is a `Pick<AppContext, …>` of `state/app/context.ts`; what other modules hand back (`signingIn`, `loadAuthOptions`, `reloadBuddies`, `availabilityOf`, `refreshAvatarIds`) comes as `deps`.
  - No module-level state: a module owns its per-account memory and registers its reset with `onAccountChange`, which `patch` runs synchronously inside the account-change update, in registration order. Never a store subscription, which would run after subscribers saw the new account.
  - Every load and cancellation goes through `ctx.ticket`, never a counter of a module's own.
  - State another module reads or sets goes through accessors on the owner's returned object (`snapshot.synced`, `sessions.pendingLogout`, `sessions.confirmed` and the like).
- Construction order: the store and its `networkReachable` mirror, `patch`, the ticket, `snapshot` (its reset registered first), `listing-sync`, navigation, then `ctx`, then the modules (account data, buddies, session, account, the diagnostics wiring, whose store subscription is the second, then the load, which registers `onAvatarGone`), the remaining ones inside the public object.
  - `notify`, `query`, `mutate`, `mutateFor`, `fail` and `storage` in the core, and `load`, `saveCurrent` and `signingIn` in their modules, are hoisted function declarations: never turn them into `const` arrows, because `ctx` and modules built earlier name them before the line that defines them (temporal dead zone).
  - `ctx.load` is the one late binding (`(options) => load(options)`; the load module is built after the modules that call it), so nothing may load while the controller is built.
- The public object is spreads of the modules' returns plus the one-liners; `app.*` and `AppController` keep their members, pinned by `state/app/public-interface.test.ts` (a member added or removed changes its list in the same commit).

Sync state:

- `AppState.sync` is one `SyncState` of `lib/sync/lifecycle.ts` (`loading` with the paged progress, `refreshing`, `idle`, each with the last failure). `online` is NOT part of it, and sign-out and the session check have no typed state. `flagsOf` (and `test-helpers.ts` `flat`) project the former five fields for tests.
- Pages and helpers read it through `isLoading`, `progressOf`, `sync.phase` and `sync.failure`; a page that derives from it reads `$appStore.sync` through one `$derived`, as `DiscoverPage` does.
- Only the dispatcher `ctx.step(version, events, data)` writes it (`state/app/sync-writes.test.ts` scans the sources for another write): it drops a superseded load's events and data (`ticket`), applies the data and the new state in one patch, and patches nothing when nothing changes.
- `patch` is typed without it (`AppPatch`) and applies `accountChanged` (which also drops the failure) inside the account-change update.
- Every load ends in `load`'s `finally` (`ended`, dropped for a superseded load such as the patient retry's first attempt); a path that patches on its way out ends in that patch, a failure over shown listings with its end (`[failed, ended]`); `failed` keeps `loading` during the snapshot read.
- `restore(…, continues)` shows the snapshot as `refreshing` when the load goes on, in the same patch, so no update sees the listings settled meanwhile.
