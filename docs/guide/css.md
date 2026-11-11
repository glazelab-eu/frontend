# CSS

The token, breakpoint, BEM, whitespace and line-length rules are in `AGENTS.md` "Code rules"; this file adds to them.

Wrapping:

- A label that shares a flex row with controls (Studio's step header) keeps its words whole: no `overflow-wrap: anywhere` or `min-width: 0` on it (the row would squeeze it letter by letter). Let the row wrap instead and give only user text inside it `overflow-wrap: anywhere`.
- A one-word page title that can outgrow a 320 px screen scales with `clamp(…, vw, …)` below the size where it no longer fits, never smaller for every width.
- A native `<select>` is as wide as its widest option: never cap it at a share of a row; let the row wrap so it gets a line of its own.
- A one-column grid is `minmax(0, 1fr)`, never a plain `1fr`, which grows to its widest item's longest word.
- A text field in a row with buttons keeps a flex basis that holds its placeholder (`13rem` for a barcode and its example) and lets the buttons wrap below.
- Side-by-side form fields (a grid or row of `.form-field` labels) set `align-items: end`, so a label that wraps or carries the `form-field__optional` hint never pushes its input below its neighbours'. A row whose labels hold content after the input (a field error) stays on the default stretch, which keeps the tops level.

Formatting and structure:

- A Svelte block's open tag, `{:else}`/`{:then}`/`{:catch}`, body and close tag are never written on one line. `singleAttributePerLine` puts each attribute of a tag with more than one on its own line; `.editorconfig` mirrors indent, width and line endings.
- Whitespace between elements never spaces them (Prettier's `htmlWhitespaceSensitivity: ignore`): use `gap`/margin tokens or structure.
- The CSP is `style-src 'self'`: never a `style` attribute in markup. A value known only at run time (a photo's `object-position`) goes through Svelte's `style:` directive, which sets it through the CSSOM (the e2e suite fails on a CSP violation).
- `style.css` holds only resets and shared blocks; responsive rules stay with their component; remove obsolete rules.
- Look: a compact potter's notebook (system fonts, restrained sage/peach/blue, no marketing heroes or decorative gradients).

Contrast and buttons:

- Contrast is WCAG AA: text 4.5:1 on every background it sits on, a field's boundary (`--control-border`, also on filter-bar selects and inputs) 3:1. `lib/layout/contrast.test.ts` reads the tokens from `style.css`, so a new token pair or background is added there.
- `.button` is the one look of `<a>` and `<button>`: no underline and a visible boundary (`--control-border`). Outlined is the default (there is no `button--secondary`); the solid `.button--primary`/`.button--danger` carry their fill as the border colour.
  - An outlined button never sits on a tint (the sage tint, `--blue` and `--warning-bg` give the boundary under 3:1): use `.button--primary` there, as the install banner's Details and the scanner's Reload do.
  - A component never sets `border-color: var(--border)` on a `.button` (`contrast.test.ts`).
- The destructive confirm of a dialog (and the reports page's Delete photo) is `.button--danger` of `style.css`, never a per-component red rule; a page's opener for such a dialog stays an outlined `.button`.

Touch screens:

- The primary pointer decides, never the window width (a narrow desktop window is not coarse). Touch rules sit in one `@media (pointer: coarse)` block, the last rule of the component's `<style>`; no `any-pointer`, `hover: none` or `pointer: fine` queries (`touch-target.test.ts` checks both), so a fine pointer renders unchanged.
- Every control is at least `--touch-target` (2.75rem = 44 px, the only spelling of that size; `lib/layout/touch-target.test.ts`) wide and tall: buttons and `.button` (shared rule), links standing alone (`display: inline-flex; align-items: center; min-height`), `summary`, selects, inputs (`--control-height` is the token there), option rows, close buttons, and a checkbox or radio with its label (the label carries the height; the box is 1.25 rem).
  - Compact browsing controls use `--touch-target-compact` (2.5rem = 40 px): `FilterChip` opts into `.button--compact`. Primary actions, fields, icon buttons (`.icon-button`, star and Share included), close buttons, steppers and navigation keep the default.
  - A link inside a sentence is exempt (WCAG 2.5.8).
- Adjacent targets are at least `--space-2` apart, and a destructive button keeps `--touch-gap` from a constructive one: every `.button-row` has that gap on touch screens, dialog footers put the safe action first and the destructive one last, step and shelf Remove buttons carry their own modifier class for the extra margin.
- Text: the coarse block at the end of `style.css` sets `--font-sm`, `--font-base` and `--font-md` to the 16 px body size (iOS zooms into a focused field below 16 px) and `--font-xs` to 14 px (badges, eyebrows, step numbers). Prose and controls that use `--font-xs` (hints, counters, chips, add-step buttons) set `--font-body` in their own coarse block: no control and no sentence on a card or form is below 16 px.
- Measuring: the audit harness (every page and dialog at 390 px; targets under 44 px, form text under 16 px, neighbours under 8 px) is not part of the repository. Headless Firefox reports `pointer: none` and `hover: none`: set `ui.primaryPointerCapabilities` and `ui.allPointerCapabilities` in the profile's `user.js` (1 = coarse touch, 6 = fine pointer with hover) and check `matchMedia('(pointer: coarse)')` before trusting a measurement.

Shared classes (global, in `style.css` beside `.button`; kept tiny on purpose):

- `.button-row`: every row of `.button`s (dialog footer, page, card or admin-entry actions): flex, wrap, `--space-2`, `--touch-gap` on coarse pointers; `.button-row--end` for end alignment (dialog footers). A host that needs more puts its own BEM class beside it with only that (margins, a border, `align-items`, `center` or `space-between`, hiding it on wide screens), never `gap`, `flex-wrap` or end alignment (`lib/layout/button-rows.test.ts`).
  - Not for rows that must not wrap or are not plain button rows: header/card icon rows (`*__header-actions`, `GlazeRow`), `ShelfControls`, `StepControls`, the scan sheet's grid, toast and banner rows (`UpdateNotice`, `InstallPrompt`), a field with buttons, the phone pair of photo buttons in `CombinationCard`.
- `.visually-hidden`: text only for screen readers (live regions, a label a compact control hides); never copy its declarations (`clip-path: inset(50%)` in a component fails the test).
- There is no other layout utility (`.row`, `.stack`, `.muted`, `.hint`).
- `.icon-button`: a button that shows only a glyph, with the glyph from `ui/Icon` (stroke paths on a 24 grid; a new glyph goes into its `paths`), never a typed character (×, +, −, ⋯, arrows) or an inline `<svg>` (`lib/layout/icon-buttons.test.ts`). It is a class, not a component, because every host keeps its own markup, refs, ARIA states (`aria-pressed` on the star is the selected look, `aria-disabled` the offline look) and scoped placement classes.
  - It sets size (40 px, `--touch-target` on coarse pointers), radius, border, colours and states. Modifiers: `--quiet` (no box until hovered: toasts, dialog corners, rows, header), `--overlay` (small round disc over a photo, the touch size on coarse pointers; only the expand hint, `pointer-events: none` and so no touch target, stays 2rem on every pointer), `--viewer` (over the dark viewer ground).
  - A host adds only placement or the size its container dictates (`--icon-size`), and a narrower host keeps its touch size in its own `pointer: coarse` block.
