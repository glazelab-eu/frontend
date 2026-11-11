# Layout and finding your way

Feature path, the `App.svelte`/pages/components split, fixtures rule: `AGENTS.md` "Architecture". Folder map: `src/README.md`.

- Owners: generic primitives in `components/ui`, app-aware shared pieces in `components/common` ("UI library"), app-shell controls in `components/layout`, feature components in their folder. `state/app`: controller, shared state/write types, integration tests; `state/<feature>`: sessions and actions; `state/shared`: lifecycle/confirmation helpers.
- Cross-feature rendering tests and fixtures live in `src/test`; `fixtures.ts` builders: `glaze()`, `combination()`, `glazeStep()`, `customStep()`, `stockItem()`, `imageInfo()`. Pass the values a test relies on explicitly.
- Import implementations directly: no re-export files at old paths.
- `lib/` folders worth knowing:
  - `api/`: `client.ts` configures the generated SDK; `models.ts`/`inputs.ts` alias its types.
  - `layout/`: `viewport`, `bottom-nav`, `headroom`, `sticky-fit`, `first-name`, `account-initial`, `sign-out-focus`; `touch-target.test.ts`, `contrast.test.ts`, `icon-buttons.test.ts`, `button-rows.test.ts` guard the CSS.
  - `admin/`: moderation view rules (`image-reports.ts`, `avatar-reports.ts`), ban gate (`bans.ts`), `error-reports.ts`, `feedback.ts`, `users.ts`.
  - `clubs/clubs.ts`: `memberCombinations`, `isLastAdmin`, `leaveRefusal`, `stockAdder`, `rulesFold`, `clubAdmins`, `orderedMembers`, `clubSummary`, `sortedClubs`; `clubs/wishlist.ts`: the club wishlist's link grammar and display rules.
  - `glazes/steps.ts`: the glaze-step helpers every glaze rule uses. `firing/`: the final firing. `stock/`: shelf rules.
  - `share/`: share fallback, `copyLink`, canonical link. `qr/`: QR encoder. `scan/`: scanned links. `vision/`: photo suggestions, similar looks. `diagnostics/`: error reports.
  - Others by name: `i18n/`, `routing/`, `offline/`, `sync/`, `images/`, `avatars/`, `paging/`, `explore/`, `studio/`, `tags/`, `barcodes/`, `ocr/`, `pwa/`, `buddies/`, `feed/`, `feedback/`.
