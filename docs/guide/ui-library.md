# UI library

- Two tiers, both folders of the frontend (no package): `components/ui` is generic; `components/common` holds shared pieces that know the app (translated texts, app terms).
- A file in `components/ui` (subfolders and `.ts` files too) imports only `svelte`/`svelte/*` and its own folder; a pure helper it needs lives there. `components/ui/boundary.test.ts` scans the imports: never add an allow-list; a component needing `$t` or app knowledge moves to `components/common` or its feature folder.
- Every visible string is a prop. The one exception: `ui/labels.ts`, a store of the library's own fixed labels (`{ close }`, English by default), which `App.svelte` sets from `$t`.
- Dialog headings: `ui/ModalShell` `title` renders the `h2` (`.modal__title`) and names the dialog (`aria-labelledby`); `eyebrow` is the small line above. A host never writes its own dialog `h2` or title class. `ariaLabel` is only for a dialog without a heading (`PhotoViewer`) or whose heading changes while its name stays (`AuthDialog`).
- The top dialog is the last `[role=dialog]` in the DOM (`ui/keys.ts` `topDialog`): it alone takes keys and the opening focus, and it is painted on top.
- `ModalShell` moves its backdrop to the end of `<body>` in opening order (`ui/portal.ts` `toBody`) and leaves a hidden `.modal-home` in its place; a `topmost` dialog (`TermsDialog` only) stays last while others open after it.
- Dialog content is styled by the dialog's own component or `ModalShell`, never through a selector whose ancestor sits outside the dialog: the backdrop is no longer inside the host's markup.
- The backdrop closes a dialog only for a press that also started on it (a text selection dragged out of a field ends there as a click).
- Key handlers of `ModalShell` and `Combobox` ignore an input method's composing keys (`composing`): its Enter and Escape are never a pick or a close.
- `common/ConfirmDialog` is every yes/no question before a write: Cancel first, confirm last (`danger` by default), `common/FormError` for the error. The host keeps opening, closing and the action. A dialog with fields or steps keeps its own markup, and so does `layout/LeaveDialog`.
- Every confirm disabled offline says so (`common/OfflineNote` above it); a new confirm dialog joins `e2e/specs/confirm-offline.spec.ts`.
- `ui/Callout` (`tone` `warm` | `sage` | `neutral`, optional `icon` snippet, `as`) is the one highlighted box that is neither error nor warning: never a side bar or a feature's own box. `common/OfflineNote` and `common/FormError` keep their own boxes. `lib/layout/contrast.test.ts` checks the tones' lines.

## Section navigation

- `ui/SectionNav` takes its translated landmark `label` (`common.onThisPage`), the items' labels and DOM IDs. Its buttons focus the section's h2 and scroll it below the sticky header without writing a fragment (hashes belong to the router).
- Hosts provide unique IDs, focusable h2s and scroll margins, and offer only mounted sections.
